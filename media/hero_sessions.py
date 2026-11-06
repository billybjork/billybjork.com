"""
In-memory state of the hero video workflow: a source video being previewed,
and its HLS encode running in the background until the user picks a sprite range.
Anything left behind after an hour is cleaned up.
"""
from __future__ import annotations

import asyncio
import logging
import os
import secrets
import threading
import time
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from typing import Generic, TypeVar

from cms.assets import cleanup_hero_folders
from cms.projects import load_project
from media.keys import hero_hls_prefix, hero_root
from media.video import (
    encode_and_upload_hls,
    extract_thumbnail_frames,
    generate_sprite_and_poster,
    get_video_info,
)

logger = logging.getLogger(__name__)

_CLEANUP_INTERVAL_SECONDS = 900
_HLS_WAIT_SECONDS = 300
_SESSION_LIFETIME = timedelta(hours=1)
_TIMELINE_INITIAL_FRAME_COUNT = 6
_TIMELINE_TOTAL_FRAME_COUNT = 20
_TIMELINE_FRAME_WIDTH = 96
_TIMELINE_FRAME_HEIGHT = 54


@dataclass
class TempVideo:
    source: str
    frames: list[str]
    video_width: int
    video_height: int
    frames_complete: bool = False
    timestamp: datetime = field(default_factory=datetime.now)

    @property
    def is_remote(self) -> bool:
        return self.source.startswith(("http://", "https://"))


@dataclass
class HlsSession:
    slug: str
    version: str
    status: str = "processing"
    stage: str = "Starting HLS encoding..."
    progress: float = 0
    hls_url: str | None = None
    error: str | None = None
    timestamp: datetime = field(default_factory=datetime.now)


T = TypeVar("T")


class _SessionStore(Generic[T]):
    """Thread-safe sessions. Updates replace the stored item, so a read stays a consistent snapshot."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._items: dict[str, T] = {}

    def add(self, item: T) -> str:
        session_id = secrets.token_urlsafe(16)
        with self._lock:
            self._items[session_id] = item
        return session_id

    def update(self, session_id: str, **changes) -> None:
        with self._lock:
            if session_id in self._items:
                self._items[session_id] = replace(self._items[session_id], **changes)

    def get(self, session_id: str) -> T | None:
        with self._lock:
            return self._items.get(session_id)

    def pop(self, session_id: str) -> T | None:
        with self._lock:
            return self._items.pop(session_id, None)

    def items(self) -> list[tuple[str, T]]:
        with self._lock:
            return list(self._items.items())


temp_videos: _SessionStore[TempVideo] = _SessionStore()
hls_sessions: _SessionStore[HlsSession] = _SessionStore()


def _extract_remaining_frames(temp_id: str, source: str) -> None:
    try:
        frames = extract_thumbnail_frames(
            source,
            _TIMELINE_TOTAL_FRAME_COUNT,
            _TIMELINE_FRAME_WIDTH,
            _TIMELINE_FRAME_HEIGHT,
        )
        temp_videos.update(temp_id, frames=frames, frames_complete=True)
    except Exception as e:
        logger.warning("Background thumbnail extraction failed: %s", e)
        temp_videos.update(temp_id, frames_complete=True)


def open_temp_video(source: str) -> tuple[str, list[str], float]:
    """Probe a local file or remote URL and start preview frames. Returns (temp_id, frames, duration)."""
    info = get_video_info(source)
    first_frames = extract_thumbnail_frames(
        source,
        _TIMELINE_INITIAL_FRAME_COUNT,
        _TIMELINE_FRAME_WIDTH,
        _TIMELINE_FRAME_HEIGHT,
    )
    temp_id = temp_videos.add(
        TempVideo(
            source=source,
            frames=first_frames,
            video_width=info["width"],
            video_height=info["height"],
        )
    )
    threading.Thread(
        target=_extract_remaining_frames, args=(temp_id, source), daemon=True
    ).start()
    return temp_id, first_frames, info["duration"]


def discard_temp_video(temp_id: str) -> None:
    temp_video = temp_videos.pop(temp_id)
    if temp_video:
        _remove_local_source(temp_video)


def _remove_local_source(temp_video: TempVideo) -> None:
    if temp_video.is_remote:
        return
    try:
        os.unlink(temp_video.source)
    except FileNotFoundError:
        pass
    except OSError:
        logger.warning("Failed to delete temp file: %s", temp_video.source, exc_info=True)


def start_hls_encoding(source: str, slug: str) -> str:
    version = str(int(time.time()))
    session_id = hls_sessions.add(HlsSession(slug=slug, version=version))

    def encode() -> None:
        try:
            hls_url = encode_and_upload_hls(
                source,
                slug,
                version,
                lambda stage, progress: hls_sessions.update(session_id, stage=stage, progress=progress),
            )
            hls_sessions.update(
                session_id,
                status="complete",
                stage="HLS complete!",
                progress=100,
                hls_url=hls_url,
            )
        except Exception as e:
            logger.exception("HLS encoding failed")
            hls_sessions.update(session_id, status="error", stage="HLS encoding failed", error=str(e))

    threading.Thread(target=encode, daemon=True).start()
    return session_id


def live_hero_sets() -> set[str]:
    """Where encodes in progress or awaiting their sprite are writing; hero cleanup must leave these."""
    return {
        f"{hero_hls_prefix(session.slug, session.version)}/"
        for _, session in hls_sessions.items()
        if session.status != "error"
    }


class HeroVideoError(Exception):
    def __init__(self, message: str, status_code: int = 500) -> None:
        super().__init__(message)
        self.status_code = status_code


async def _wait_for_hls(session_id: str) -> str | None:
    """The finished encode's URL; None if the session is gone."""
    for _ in range(_HLS_WAIT_SECONDS):
        session = hls_sessions.get(session_id)
        if not session:
            return None
        if session.status == "complete":
            return session.hls_url
        if session.status == "error":
            raise HeroVideoError(f"HLS encoding failed: {session.error or 'Unknown error'}")
        await asyncio.sleep(1)
    raise HeroVideoError("HLS encoding timed out")


async def finish_hero_video(
    temp_id: str,
    hls_session_id: str | None,
    slug: str,
    sprite_start: float,
    sprite_duration: float,
) -> dict:
    """Once the sprite range is chosen: wait out the encode, then produce the sprite and poster.

    Returns the project's new `video` metadata. The sessions end on success; a failure keeps
    them, so the editor can retry, until they expire.
    """
    temp_video = temp_videos.get(temp_id)
    if not temp_video:
        raise HeroVideoError("Invalid or expired temp_id", 400)
    if not temp_video.is_remote and not os.path.exists(temp_video.source):
        raise HeroVideoError("Temp file not found", 400)

    hls_url = await _wait_for_hls(hls_session_id) if hls_session_id else None
    if not hls_url:
        project = await asyncio.to_thread(load_project, slug)
        hls_url = project.video.hls if project else None
    if not hls_url:
        raise HeroVideoError("HLS URL unavailable for sprite generation")

    assets = await asyncio.to_thread(
        generate_sprite_and_poster, temp_video.source, slug, sprite_start, sprite_duration
    )
    discard_temp_video(temp_id)
    if hls_session_id:
        hls_sessions.pop(hls_session_id)
    return {
        "hls": hls_url,
        "thumbnail": assets["thumbnail"],
        "spriteSheet": assets["spriteSheet"],
        **assets["spriteMeta"],
        "video_width": temp_video.video_width,
        "video_height": temp_video.video_height,
    }


def _cleanup_expired() -> None:
    """Remove expired sessions. An encode that finished but was never used leaves an orphan version."""
    now = datetime.now()

    for temp_id, temp_video in temp_videos.items():
        if now - temp_video.timestamp > _SESSION_LIFETIME:
            _remove_local_source(temp_video)
            temp_videos.pop(temp_id)

    for session_id, session in hls_sessions.items():
        if now - session.timestamp > _SESSION_LIFETIME:
            hls_sessions.pop(session_id)
            if session.status == "complete":
                cleanup_hero_folders({f"{hero_root(session.slug)}/"}, live_hero_sets())


async def run_cleanup_loop() -> None:
    while True:
        await asyncio.to_thread(_cleanup_expired)
        await asyncio.sleep(_CLEANUP_INTERVAL_SECONDS)

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
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from typing import Generic, TypeVar

from cms.assets import cleanup_old_hero_versions
from cms.projects import load_project
from media.video import encode_and_upload_hls, extract_thumbnail_frames, get_video_info

logger = logging.getLogger(__name__)

_CLEANUP_INTERVAL_SECONDS = 900
_SESSION_LIFETIME = timedelta(hours=1)
_TIMELINE_INITIAL_FRAME_COUNT = 6
_TIMELINE_TOTAL_FRAME_COUNT = 20
_TIMELINE_FRAME_WIDTH = 96
_TIMELINE_FRAME_HEIGHT = 54


@dataclass
class TempVideo:
    source: str
    frames: list[str]
    frames_complete: bool = False
    video_width: int | None = None
    video_height: int | None = None
    timestamp: datetime = field(default_factory=datetime.now)

    @property
    def is_remote(self) -> bool:
        return self.source.startswith(("http://", "https://"))


@dataclass
class HlsSession:
    slug: str
    status: str = "processing"
    stage: str = "Starting HLS encoding..."
    progress: float = 0
    hls_url: str | None = None
    error: str | None = None
    timestamp: datetime = field(default_factory=datetime.now)


T = TypeVar("T")


class _SessionStore(Generic[T]):
    """Thread-safe sessions, read as copies because background threads update them."""

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
            video_width=info["width"] or None,
            video_height=info["height"] or None,
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
    if temp_video.is_remote or not os.path.exists(temp_video.source):
        return
    try:
        os.unlink(temp_video.source)
    except OSError:
        logger.warning("Failed to delete temp file: %s", temp_video.source, exc_info=True)


def start_hls_encoding(source: str, slug: str) -> str:
    session_id = hls_sessions.add(HlsSession(slug=slug))

    def encode() -> None:
        try:
            hls_url = encode_and_upload_hls(
                source,
                slug,
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


def _cleanup_expired() -> None:
    """Remove expired sessions. An encode that finished but was never used leaves an orphan version."""
    now = datetime.now()

    for temp_id, temp_video in temp_videos.items():
        if now - temp_video.timestamp > _SESSION_LIFETIME:
            _remove_local_source(temp_video)
            temp_videos.pop(temp_id)

    for session_id, session in hls_sessions.items():
        if now - session.timestamp > _SESSION_LIFETIME:
            if session.status == "complete":
                project = load_project(session.slug)
                cleanup_old_hero_versions(session.slug, project.video.hls if project else None)
            hls_sessions.pop(session_id)


async def run_cleanup_loop() -> None:
    while True:
        await asyncio.to_thread(_cleanup_expired)
        await asyncio.sleep(_CLEANUP_INTERVAL_SECONDS)

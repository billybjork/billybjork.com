"""Editor APIs for media: image uploads, content videos, and the hero video workflow."""
import asyncio
import io
import logging
import os
import tempfile
from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request

from cms.projects import load_project, validate_slug
from edit_auth import require_edit_mode
from media.hero_sessions import (
    discard_temp_video,
    hls_sessions,
    open_temp_video,
    start_hls_encoding,
    temp_videos,
)
from media.image import process_image
from media.keys import new_content_image_key, new_misc_image_key
from media.sprite_format import DEFAULT_SPRITE_DURATION_SECONDS
from media.uploads import store_webp
from media.video import (
    compress_and_upload_content_video,
    generate_sprite_and_poster,
    generate_thumbnail,
)
from object_storage import is_managed_public_url

logger = logging.getLogger(__name__)

_UPLOAD_CHUNK_BYTES = 1024 * 1024
_HLS_WAIT_SECONDS = 300
_MAX_POSTER_FRAME_TIME = 6 * 60 * 60
_POSTER_SIZE = 1600

router = APIRouter(prefix="/api", tags=["admin"], dependencies=[Depends(require_edit_mode)])


def _require_valid_slug(slug) -> None:
    if not validate_slug(slug):
        raise HTTPException(status_code=400, detail="Invalid slug format")


async def _save_upload_to_temp_file(upload) -> str:
    """Stream to disk so large videos never sit in memory. The caller owns the file."""
    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as temp_file:
        while chunk := await upload.read(_UPLOAD_CHUNK_BYTES):
            temp_file.write(chunk)
        return temp_file.name


def _remove_file(path: str) -> None:
    if os.path.exists(path):
        os.unlink(path)


@router.post("/upload-media")
async def upload_media(request: Request):
    """Process and store an image, deduplicated by content."""
    form = await request.form()
    file = form.get("file")
    media_type = form.get("type", "image")
    scope = form.get("scope", "project")

    if not file:
        raise HTTPException(status_code=400, detail="No file provided")
    if media_type == "video":
        raise HTTPException(status_code=400, detail="Use /api/process-content-video for video uploads")
    if media_type != "image":
        raise HTTPException(status_code=400, detail="Invalid media type")
    if scope not in {"project", "misc"}:
        raise HTTPException(status_code=400, detail="Invalid media scope")

    data = await file.read()
    new_key = new_misc_image_key if scope == "misc" else new_content_image_key

    def process_and_store() -> tuple[str, bool]:
        return store_webp(process_image(io.BytesIO(data)), new_key)

    try:
        url, deduplicated = await asyncio.to_thread(process_and_store)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("Image upload failed")
        raise HTTPException(status_code=500, detail="Image upload failed")
    return {"success": True, "url": url, "deduplicated": deduplicated}


@router.post("/video-thumbnails")
async def video_thumbnails(request: Request):
    """Open an uploaded hero video: first frames now, the rest in the background.

    With a project_slug, HLS encoding starts immediately too; old files stay
    until save, so cancelling mid-upload loses nothing.
    """
    form = await request.form()
    file = form.get("file")
    project_slug = form.get("project_slug")

    if not file:
        raise HTTPException(status_code=400, detail="File is required")
    if project_slug:
        _require_valid_slug(project_slug)

    try:
        temp_path = await _save_upload_to_temp_file(file)
    except Exception:
        logger.exception("Video thumbnail upload failed")
        raise HTTPException(status_code=500, detail="Video upload failed")

    try:
        temp_id, frames, duration = await asyncio.to_thread(open_temp_video, temp_path)
    except Exception as e:
        _remove_file(temp_path)
        logger.exception("Video thumbnail extraction failed")
        raise HTTPException(status_code=500, detail=f"Thumbnail extraction failed: {e}")

    response = {"success": True, "frames": frames, "duration": duration, "temp_id": temp_id}
    if project_slug:
        response["hls_session_id"] = start_hls_encoding(temp_path, project_slug)
    return response


@router.post("/video-thumbnails-existing")
async def video_thumbnails_existing(request: Request):
    """Open the project's current hero video for choosing a new sprite range."""
    form = await request.form()
    project_slug = form.get("project_slug")

    if not project_slug:
        raise HTTPException(status_code=400, detail="project_slug is required")
    _require_valid_slug(project_slug)

    project = await asyncio.to_thread(load_project, project_slug)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    hls_url = project.video.hls
    if not hls_url:
        raise HTTPException(status_code=400, detail="Project has no hero HLS video")

    try:
        temp_id, frames, duration = await asyncio.to_thread(open_temp_video, hls_url)
    except Exception as e:
        logger.exception("Existing video thumbnail extraction failed")
        raise HTTPException(status_code=500, detail=f"Thumbnail extraction failed: {e}")
    return {
        "success": True,
        "frames": frames,
        "duration": duration,
        "temp_id": temp_id,
        "hls_url": hls_url,
    }


@router.get("/video-thumbnails/more/{temp_id}")
async def get_more_thumbnails(temp_id: str):
    temp_video = temp_videos.get(temp_id)
    if not temp_video:
        raise HTTPException(status_code=404, detail="Invalid or expired temp_id")
    return {"frames": temp_video.frames, "complete": temp_video.frames_complete}


@router.get("/hls-progress/{session_id}")
async def get_hls_progress(session_id: str):
    session = hls_sessions.get(session_id)
    if not session:
        return {"status": "unknown", "stage": "Session not found", "progress": 0}

    response = {"status": session.status, "stage": session.stage, "progress": session.progress}
    if session.status == "complete" and session.hls_url:
        response["hls_url"] = session.hls_url
    if session.status == "error":
        response["error"] = session.error or "Unknown error"
    return response


async def _wait_for_hls(session_id: str) -> str | None:
    """The finished encode's URL; None if the session is gone."""
    for _ in range(_HLS_WAIT_SECONDS):
        session = hls_sessions.get(session_id)
        if not session:
            return None
        if session.status == "complete":
            return session.hls_url
        if session.status == "error":
            raise HTTPException(
                status_code=500,
                detail=f"HLS encoding failed: {session.error or 'Unknown error'}",
            )
        await asyncio.sleep(1)
    raise HTTPException(status_code=500, detail="HLS encoding timed out")


@router.post("/generate-sprite-sheet")
async def generate_sprite_sheet_endpoint(request: Request):
    """Finish the hero workflow once the sprite range is chosen, waiting for a running encode."""
    form = await request.form()
    temp_id = form.get("temp_id")
    hls_session_id = form.get("hls_session_id")
    project_slug = form.get("project_slug")
    sprite_start = float(form.get("sprite_start", 0))
    sprite_duration = float(form.get("sprite_duration", DEFAULT_SPRITE_DURATION_SECONDS))

    if not temp_id:
        raise HTTPException(status_code=400, detail="temp_id is required")
    if not project_slug:
        raise HTTPException(status_code=400, detail="project_slug is required")
    _require_valid_slug(project_slug)

    temp_video = temp_videos.get(temp_id)
    if not temp_video:
        raise HTTPException(status_code=400, detail="Invalid or expired temp_id")
    if not temp_video.is_remote and not os.path.exists(temp_video.source):
        raise HTTPException(status_code=400, detail="Temp file not found")

    try:
        result = await asyncio.to_thread(
            generate_sprite_and_poster,
            temp_video.source,
            project_slug,
            sprite_start,
            sprite_duration,
        )

        hls_url = await _wait_for_hls(hls_session_id) if hls_session_id else None
        if not hls_url:
            project = await asyncio.to_thread(load_project, project_slug)
            hls_url = project.video.hls if project else None
        if not hls_url:
            raise HTTPException(status_code=500, detail="HLS URL unavailable after sprite generation")

        video: dict[str, Any] = {
            "hls": hls_url,
            "thumbnail": result["thumbnail"],
            "spriteSheet": result["spriteSheet"],
            **result["spriteMeta"],
        }
        if temp_video.video_width:
            video["video_width"] = temp_video.video_width
        if temp_video.video_height:
            video["video_height"] = temp_video.video_height
        return {"success": True, "video": video}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Sprite sheet generation failed")
        raise HTTPException(status_code=500, detail=f"Sprite sheet generation failed: {e}")
    finally:
        discard_temp_video(temp_id)
        if hls_session_id:
            hls_sessions.pop(hls_session_id)


@router.post("/process-content-video")
async def process_content_video(request: Request):
    form = await request.form()
    file = form.get("file")
    if not file:
        raise HTTPException(status_code=400, detail="File is required")

    temp_path = None
    try:
        temp_path = await _save_upload_to_temp_file(file)
        url = await asyncio.to_thread(compress_and_upload_content_video, temp_path)
        return {"success": True, "url": url}
    except Exception:
        logger.exception("Content video processing failed")
        raise HTTPException(status_code=500, detail="Video processing failed")
    finally:
        if temp_path:
            _remove_file(temp_path)


def _extract_and_store_poster(source_url: str, frame_time: float) -> tuple[str, bool]:
    with tempfile.TemporaryDirectory() as temp_dir:
        poster_path = os.path.join(temp_dir, "poster.webp")
        generate_thumbnail(source_url, poster_path, time=frame_time, width=_POSTER_SIZE, height=_POSTER_SIZE)
        with open(poster_path, "rb") as poster_file:
            data = poster_file.read()
    return store_webp(data, new_content_image_key)


@router.post("/content-video-poster")
async def extract_content_video_poster(request: Request):
    """Store a poster frame from a content video that's already uploaded."""
    data = await request.json()
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Invalid request body")

    source_url = data.get("source_url")
    if not isinstance(source_url, str) or not source_url.strip():
        raise HTTPException(status_code=400, detail="source_url is required")
    source_url = source_url.strip()

    parsed = urlparse(source_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail="source_url must be an absolute http(s) URL")
    if not is_managed_public_url(source_url):
        raise HTTPException(status_code=400, detail="source_url must use a configured managed asset base URL")

    try:
        frame_time = max(float(data.get("frame_time", 0)), 0.0)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="frame_time must be a number")
    if frame_time > _MAX_POSTER_FRAME_TIME:
        raise HTTPException(status_code=400, detail="frame_time exceeds maximum allowed range")

    try:
        url, deduplicated = await asyncio.to_thread(_extract_and_store_poster, source_url, frame_time)
    except Exception:
        logger.exception("Content video poster extraction failed")
        raise HTTPException(status_code=500, detail="Poster extraction failed")
    return {"success": True, "url": url, "deduplicated": deduplicated}

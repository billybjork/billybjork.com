import io
import logging
import os
import tempfile
import threading
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta
from typing import Any, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from dependencies import require_edit_mode
from utils.assets import (
    cleanup_old_hls_versions,
    cleanup_orphans,
    compute_hash,
    delete_video_prefix,
    extract_cloudfront_urls,
    extract_s3_key,
    find_by_hash,
    register_asset,
)
from utils.media_paths import content_image_key, misc_image_key
from utils.content import (
    ABOUT_FILE,
    PROJECTS_DIR,
    content_revision,
    delete_project,
    load_about,
    load_project,
    save_about,
    save_project,
    validate_slug,
)
from utils.s3 import CLOUDFRONT_DOMAIN

logger = logging.getLogger(__name__)

@dataclass
class TempVideoState:
    path: str
    frames: list[str]
    frames_complete: bool = False
    is_remote: bool = False
    timestamp: datetime = field(default_factory=datetime.now)


@dataclass
class HlsSessionState:
    status: str = "processing"
    stage: str = "Starting HLS encoding..."
    progress: float = 0
    hls_url: Optional[str] = None
    temp_id: Optional[str] = None
    slug: str = ""
    error: Optional[str] = None
    timestamp: datetime = field(default_factory=datetime.now)


class TempVideoStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._items: dict[str, TempVideoState] = {}

    def create(self, temp_id: str, **kwargs: Any) -> None:
        with self._lock:
            self._items[temp_id] = TempVideoState(**kwargs)

    def update(self, temp_id: str, **kwargs: Any) -> bool:
        with self._lock:
            state = self._items.get(temp_id)
            if not state:
                return False
            for key, value in kwargs.items():
                setattr(state, key, value)
            return True

    def get(self, temp_id: str) -> Optional[dict[str, Any]]:
        with self._lock:
            state = self._items.get(temp_id)
            return asdict(state) if state else None

    def pop(self, temp_id: str) -> Optional[dict[str, Any]]:
        with self._lock:
            state = self._items.pop(temp_id, None)
            return asdict(state) if state else None

    def delete(self, temp_id: str) -> bool:
        with self._lock:
            return self._items.pop(temp_id, None) is not None

    def exists(self, temp_id: str) -> bool:
        with self._lock:
            return temp_id in self._items

    def snapshot(self) -> list[tuple[str, dict[str, Any]]]:
        with self._lock:
            return [(temp_id, asdict(state)) for temp_id, state in self._items.items()]


class HlsSessionStore:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._items: dict[str, HlsSessionState] = {}

    def create(self, session_id: str, **kwargs: Any) -> None:
        with self._lock:
            self._items[session_id] = HlsSessionState(**kwargs)

    def update(self, session_id: str, **kwargs: Any) -> bool:
        with self._lock:
            state = self._items.get(session_id)
            if not state:
                return False
            for key, value in kwargs.items():
                setattr(state, key, value)
            return True

    def get(self, session_id: str) -> Optional[dict[str, Any]]:
        with self._lock:
            state = self._items.get(session_id)
            return asdict(state) if state else None

    def delete(self, session_id: str) -> bool:
        with self._lock:
            return self._items.pop(session_id, None) is not None

    def snapshot(self) -> list[tuple[str, dict[str, Any]]]:
        with self._lock:
            return [(session_id, asdict(state)) for session_id, state in self._items.items()]


# Thread-safe process state stores
_temp_video_files = TempVideoStore()
_hls_sessions = HlsSessionStore()

TIMELINE_INITIAL_FRAME_COUNT = 6
TIMELINE_TOTAL_FRAME_COUNT = 20
TIMELINE_FRAME_WIDTH = 96
TIMELINE_FRAME_HEIGHT = 54


def _is_remote_video_source(path: str) -> bool:
    return isinstance(path, str) and (
        path.startswith("http://") or path.startswith("https://")
    )


def _validate_save_project_input(data: dict[str, Any]) -> tuple[str, str]:
    """Pure input validation for project save payload."""
    slug_raw = data.get("slug")
    original_slug_raw = data.get("original_slug") or slug_raw

    if not isinstance(slug_raw, str) or not slug_raw:
        raise HTTPException(status_code=400, detail="Slug is required")
    if not isinstance(original_slug_raw, str) or not original_slug_raw:
        raise HTTPException(status_code=400, detail="Original slug is required")

    slug = slug_raw.strip()
    original_slug = original_slug_raw.strip()
    if not validate_slug(slug):
        raise HTTPException(status_code=400, detail="Invalid slug format")
    if not validate_slug(original_slug):
        raise HTTPException(status_code=400, detail="Invalid original slug format")

    return slug, original_slug


def _build_project_frontmatter(
    data: dict[str, Any], slug: str
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Pure transformation from request data to frontmatter + normalized video payload."""
    frontmatter: dict[str, Any] = {
        "name": data.get("name", slug),
        "slug": slug,
        "date": data.get("date"),
        "pinned": data.get("pinned", False),
        "draft": data.get("draft", False),
    }

    raw_video = data.get("video", {})
    video = raw_video if isinstance(raw_video, dict) else {}
    normalized_video: dict[str, Any] = {}
    for key in ("hls", "thumbnail", "spriteSheet"):
        value = video.get(key)
        if isinstance(value, str) and value.strip():
            normalized_video[key] = value.strip()

    for key in ("frames", "columns", "rows", "frame_width", "frame_height", "fps"):
        value = video.get(key)
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)) and value > 0:
            normalized_video[key] = int(value)
            continue
        if isinstance(value, str):
            try:
                parsed = int(float(value.strip()))
            except ValueError:
                continue
            if parsed > 0:
                normalized_video[key] = parsed

    if normalized_video:
        frontmatter["video"] = normalized_video

    youtube = data.get("youtube")
    if youtube:
        frontmatter["youtube"] = youtube

    return frontmatter, normalized_video


def _collect_asset_refs(markdown_content: str, video: Optional[dict[str, Any]] = None) -> set[str]:
    """Pure extraction of referenced asset URLs from markdown and video metadata."""
    refs = extract_cloudfront_urls(markdown_content or "")
    if isinstance(video, dict):
        for key in ("hls", "thumbnail", "spriteSheet"):
            value = video.get(key)
            if isinstance(value, str) and value:
                refs.add(value)
    return refs


def _collect_cleanup_candidates(data: dict[str, Any], limit: int = 200) -> set[str]:
    """Extract optional client-provided URLs that should be checked for orphan cleanup."""
    raw_candidates = data.get("cleanup_candidates")
    if not isinstance(raw_candidates, list):
        return set()

    candidates: set[str] = set()
    for item in raw_candidates[:limit]:
        if isinstance(item, str):
            value = item.strip()
            if value:
                candidates.add(value)
    return candidates


def _extract_s3_keys(urls: set[str]) -> set[str]:
    """Pure conversion from URL set to S3 key set."""
    keys = set()
    for url in urls:
        key = extract_s3_key(url)
        if key:
            keys.add(key)
    return keys


def _start_background_thumbnail_extraction(source_path: str, temp_id: str):
    from utils.video import extract_thumbnail_frames

    def extract_remaining_frames():
        try:
            all_frames, _ = extract_thumbnail_frames(
                source_path,
                num_frames=TIMELINE_TOTAL_FRAME_COUNT,
                width=TIMELINE_FRAME_WIDTH,
                height=TIMELINE_FRAME_HEIGHT,
            )
            _temp_video_files.update(
                temp_id, frames=all_frames, frames_complete=True
            )
        except Exception as e:
            logger.warning(f"Background thumbnail extraction failed: {e}")
            _temp_video_files.update(temp_id, frames_complete=True)

    thread = threading.Thread(target=extract_remaining_frames, daemon=True)
    thread.start()


router = APIRouter(
    prefix="/api",
    tags=["admin"],
    dependencies=[Depends(require_edit_mode)],
)


@router.get("/project/{slug}")
async def get_project(slug: str):
    """Get project data for editing."""
    project_data = load_project(slug)
    if not project_data:
        raise HTTPException(status_code=404, detail="Project not found")

    return {
        "slug": project_data.get("slug"),
        "name": project_data.get("name"),
        "date": project_data.get("creation_date"),
        "pinned": project_data.get("pinned", False),
        "draft": project_data.get("is_draft", False),
        "youtube": project_data.get("youtube_link"),
        "video": {
            "hls": project_data.get("video_link"),
            "thumbnail": project_data.get("thumbnail_link"),
            "spriteSheet": project_data.get("sprite_sheet_link"),
            "frames": project_data.get("frames"),
            "columns": project_data.get("columns"),
            "rows": project_data.get("rows"),
            "frame_width": project_data.get("frame_width"),
            "frame_height": project_data.get("frame_height"),
            "fps": project_data.get("fps"),
        },
        "markdown": project_data.get("markdown_content", ""),
        "html": project_data.get("html_content", ""),
        "revision": project_data.get("revision"),
    }


@router.post("/save-project")
async def save_project_endpoint(request: Request):
    """Save project content with optimistic conflict detection."""
    data = await request.json()
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Invalid request body")

    slug, original_slug = _validate_save_project_input(data)
    base_revision = data.get("base_revision")

    if original_slug != slug and load_project(slug):
        raise HTTPException(
            status_code=400,
            detail="Project with this slug already exists",
        )

    # Conflict check: if client sent a base_revision, verify it still matches
    if base_revision and not data.get("force"):
        filepath = PROJECTS_DIR / f"{original_slug}.md"
        current_revision = content_revision(filepath)
        if current_revision and base_revision != current_revision:
            current_project = load_project(original_slug)
            return JSONResponse(
                status_code=409,
                content={
                    "conflict": True,
                    "server_revision": current_revision,
                    "server_markdown": current_project.get("markdown_content", "") if current_project else "",
                    "your_markdown": data.get("markdown", ""),
                    "message": "Content was modified by another session",
                },
            )

    # Load old project to track removed references
    old_project = load_project(original_slug)
    if not old_project:
        raise HTTPException(
            status_code=404,
            detail="Project not found. Use create-project for new projects.",
        )

    old_video = {
        "hls": old_project.get("video_link"),
        "thumbnail": old_project.get("thumbnail_link"),
        "spriteSheet": old_project.get("sprite_sheet_link"),
    }
    old_refs = _collect_asset_refs(old_project.get("markdown_content", ""), old_video)

    frontmatter, video = _build_project_frontmatter(data, slug)

    markdown_content = data.get("markdown", "")
    if not isinstance(markdown_content, str):
        raise HTTPException(status_code=400, detail="Markdown must be a string")

    save_project(slug, frontmatter, markdown_content)

    # If slug changed, remove the previous file after successful write.
    if original_slug != slug:
        delete_project(original_slug)

    # Cleanup orphaned assets
    new_refs = _collect_asset_refs(markdown_content, video)
    removed_urls = old_refs - new_refs
    cleanup_candidates = _collect_cleanup_candidates(data) - new_refs
    cleanup_urls = removed_urls | cleanup_candidates
    keys_to_check = _extract_s3_keys(cleanup_urls)
    if keys_to_check:
        cleanup_orphans(keys_to_check)

    # Clean up old HLS versions (keeps only the current version).
    # On slug rename, clean up under the original slug namespace.
    cleanup_slug = slug
    cleanup_hls = video.get("hls")
    if original_slug != slug:
        cleanup_slug = original_slug
        if not isinstance(cleanup_hls, str) or f"/videos/{original_slug}/" not in cleanup_hls:
            cleanup_hls = None
    cleanup_old_hls_versions(cleanup_slug, cleanup_hls)

    # Return new revision for the client to use in subsequent saves
    filepath = PROJECTS_DIR / f"{slug}.md"
    new_revision = content_revision(filepath)
    return {"success": True, "slug": slug, "revision": new_revision}


@router.post("/create-project")
async def create_project(request: Request):
    """Create a new project."""
    data = await request.json()
    slug = data.get("slug")
    logger.info(f"create-project request: slug={slug!r}, name={data.get('name')!r}")

    if not slug:
        raise HTTPException(status_code=400, detail="Slug is required")
    if not validate_slug(slug):
        raise HTTPException(status_code=400, detail="Invalid slug format")

    if load_project(slug):
        raise HTTPException(status_code=400, detail="Project with this slug already exists")

    frontmatter = {
        "name": data.get("name", slug),
        "slug": slug,
        "date": data.get("date", datetime.now().strftime("%Y-%m-%d")),
        "pinned": data.get("pinned", False),
        "draft": data.get("draft", False),
    }

    markdown_content = data.get("markdown", "")
    save_project(slug, frontmatter, markdown_content)

    return {"success": True, "slug": slug}


@router.delete("/project/{slug}")
async def delete_project_endpoint(slug: str):
    """Delete a project and cleanup orphaned assets."""
    project = load_project(slug)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    project_video = {
        "hls": project.get("video_link"),
        "thumbnail": project.get("thumbnail_link"),
        "spriteSheet": project.get("sprite_sheet_link"),
    }
    project_refs = _collect_asset_refs(project.get("markdown_content", ""), project_video)

    # Delete the project file first
    delete_project(slug)

    # Cleanup orphaned assets (assets not referenced elsewhere)
    keys_to_check = _extract_s3_keys(project_refs)
    if keys_to_check:
        cleanup_orphans(keys_to_check)

    # Delete hero video prefix (HLS files, etc.)
    delete_video_prefix(slug)

    return {"success": True}


@router.get("/about")
async def get_about():
    """Get about page content for editing."""
    html_content, markdown_content, revision = load_about()
    return {"html": html_content, "markdown": markdown_content, "revision": revision}


@router.post("/save-about")
async def save_about_endpoint(request: Request):
    """Save about page content with conflict detection and cleanup orphaned assets."""
    data = await request.json()
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Invalid request body")

    markdown_content = data.get("markdown", "")
    if not isinstance(markdown_content, str):
        raise HTTPException(status_code=400, detail="Markdown must be a string")
    base_revision = data.get("base_revision")

    # Conflict check
    if base_revision and not data.get("force"):
        current_revision = content_revision(ABOUT_FILE)
        if current_revision and base_revision != current_revision:
            _, current_markdown, _ = load_about()
            return JSONResponse(
                status_code=409,
                content={
                    "conflict": True,
                    "server_revision": current_revision,
                    "server_markdown": current_markdown,
                    "your_markdown": markdown_content,
                    "message": "About page was modified by another session",
                },
            )

    # Load old about content to track removed references
    _, old_markdown, _ = load_about()
    old_refs = _collect_asset_refs(old_markdown)

    save_about(markdown_content)

    # Cleanup orphaned assets
    new_refs = _collect_asset_refs(markdown_content)
    removed_urls = old_refs - new_refs
    keys_to_check = _extract_s3_keys(removed_urls)
    if keys_to_check:
        cleanup_orphans(keys_to_check)

    new_revision = content_revision(ABOUT_FILE)
    return {"success": True, "revision": new_revision}


@router.post("/cleanup-assets")
async def cleanup_assets_endpoint(request: Request):
    """Run orphan cleanup checks for a caller-provided list of asset URLs."""
    data = await request.json()
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Invalid request body")

    candidates = _collect_cleanup_candidates({"cleanup_candidates": data.get("urls")})
    keys_to_check = _extract_s3_keys(candidates)
    if keys_to_check:
        cleanup_orphans(keys_to_check)

    return {"success": True, "checked": len(keys_to_check)}


@router.post("/upload-media")
async def upload_media(request: Request):
    """Upload and process media file (image only) with deduplication."""
    form = await request.form()
    file = form.get("file")
    media_type = form.get("type", "image")
    scope = form.get("scope", "project")

    if not file:
        raise HTTPException(status_code=400, detail="No file provided")

    if media_type == "video":
        raise HTTPException(
            status_code=400, detail="Use /api/process-content-video for video uploads"
        )

    if media_type != "image":
        raise HTTPException(status_code=400, detail="Invalid media type")
    if scope not in {"project", "misc"}:
        raise HTTPException(status_code=400, detail="Invalid media scope")

    try:
        from utils.image import process_image
        from utils.s3 import upload_file

        file_content = await file.read()
        file_like = io.BytesIO(file_content)

        processed_data, content_type = process_image(file_like)

        # Get processed bytes for hashing
        processed_bytes = processed_data.getvalue()
        content_hash = compute_hash(processed_bytes)

        # Check for existing asset with same content
        existing_key = find_by_hash(content_hash)
        if existing_key:
            # Return existing URL (deduplication)
            url = f"https://{CLOUDFRONT_DOMAIN}/{existing_key}"
            return {"success": True, "url": url, "deduplicated": True}

        # Upload new asset
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        filename = f"{timestamp}.webp"
        if scope == "misc":
            key = misc_image_key(filename)
        else:
            key = content_image_key(filename)

        # Reset buffer position for upload
        processed_data.seek(0)
        url = upload_file(processed_data, key, content_type)

        # Register in asset registry
        register_asset(key, content_hash, len(processed_bytes))

        return {"success": True, "url": url, "deduplicated": False}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Image upload failed")
        raise HTTPException(status_code=500, detail="Image upload failed")


@router.post("/video-thumbnails")
async def video_thumbnails(request: Request):
    """Extract thumbnail frames from uploaded video for preview.

    Uses server-side ffmpeg to support any codec (ProRes, HEVC, etc.).
    Streams the upload in 1 MB chunks to avoid loading the entire file into RAM.

    Returns first frame immediately for fast UI feedback, then extracts remaining
    frames in background. If project_slug is provided, auto-starts HLS encoding.

    Returns: { success, frames (first frame only), duration, temp_id, hls_session_id? }
    """
    import secrets
    from utils.video import extract_thumbnail_frames, get_video_info

    form = await request.form()
    file = form.get("file")
    project_slug = form.get("project_slug")

    if not file:
        raise HTTPException(status_code=400, detail="File is required")

    if project_slug and not validate_slug(project_slug):
        raise HTTPException(status_code=400, detail="Invalid slug format")

    try:
        # Stream upload to temp file in 1 MB chunks
        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as temp_file:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                temp_file.write(chunk)
            temp_path = temp_file.name
    except Exception as e:
        logger.exception("Video thumbnail upload failed")
        raise HTTPException(status_code=500, detail="Video upload failed")

    try:
        # Get video duration first (fast operation)
        info = get_video_info(temp_path)
        duration = info["duration"]

        # Extract a small initial frame set for immediate timeline feedback
        first_frames, _ = extract_thumbnail_frames(
            temp_path,
            num_frames=TIMELINE_INITIAL_FRAME_COUNT,
            width=TIMELINE_FRAME_WIDTH,
            height=TIMELINE_FRAME_HEIGHT,
        )

        # Generate unique temp_id and store the temp file path
        temp_id = secrets.token_urlsafe(16)
        _temp_video_files.create(
            temp_id,
            path=temp_path,
            frames=first_frames,  # Will be extended with more frames
            frames_complete=False,
            is_remote=False,
        )

        if TIMELINE_TOTAL_FRAME_COUNT > TIMELINE_INITIAL_FRAME_COUNT:
            _start_background_thumbnail_extraction(temp_path, temp_id)
        else:
            _temp_video_files.update(temp_id, frames_complete=True)

        response = {
            "success": True,
            "frames": first_frames,
            "duration": duration,
            "temp_id": temp_id,
        }

        # Auto-start HLS encoding if project_slug provided
        if project_slug:
            hls_session_id = secrets.token_urlsafe(16)
            _hls_sessions.create(
                hls_session_id,
                status="processing",
                stage="Starting HLS encoding...",
                progress=0,
                hls_url=None,
                temp_id=temp_id,
                slug=project_slug,
                error=None,
            )

            def run_hls_encoding():
                from utils.video import generate_hls_only

                def progress_callback(stage, progress):
                    _hls_sessions.update(
                        hls_session_id,
                        stage=stage,
                        progress=progress,
                    )

                try:
                    # Note: Don't delete old files here - they're cleaned up after save
                    # to prevent data loss if user cancels mid-upload
                    hls_url = generate_hls_only(
                        temp_path,
                        project_slug,
                        trim_start=0,
                        progress_callback=progress_callback,
                    )
                    _hls_sessions.update(
                        hls_session_id,
                        status="complete",
                        stage="HLS complete!",
                        progress=100,
                        hls_url=hls_url,
                    )
                except Exception as e:
                    logger.exception("HLS encoding failed")
                    _hls_sessions.update(
                        hls_session_id,
                        status="error",
                        stage="HLS encoding failed",
                        error=str(e),
                    )

            hls_thread = threading.Thread(target=run_hls_encoding, daemon=True)
            hls_thread.start()

            response["hls_session_id"] = hls_session_id

        return response

    except Exception as e:
        # Clean up temp file on error
        if os.path.exists(temp_path):
            os.unlink(temp_path)
        logger.exception("Video thumbnail extraction failed")
        raise HTTPException(status_code=500, detail=f"Thumbnail extraction failed: {str(e)}")


@router.post("/video-thumbnails-existing")
async def video_thumbnails_existing(request: Request):
    """Extract thumbnail frames from the project's current hero HLS URL."""
    import secrets

    from utils.video import extract_thumbnail_frames, get_video_info

    form = await request.form()
    project_slug = form.get("project_slug")

    if not project_slug:
        raise HTTPException(status_code=400, detail="project_slug is required")
    if not validate_slug(project_slug):
        raise HTTPException(status_code=400, detail="Invalid slug format")

    project = load_project(project_slug)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    hls_url = project.get("video_link")
    if not hls_url:
        raise HTTPException(status_code=400, detail="Project has no hero HLS video")

    try:
        info = get_video_info(hls_url)
        duration = info["duration"]
        first_frames, _ = extract_thumbnail_frames(
            hls_url,
            num_frames=TIMELINE_INITIAL_FRAME_COUNT,
            width=TIMELINE_FRAME_WIDTH,
            height=TIMELINE_FRAME_HEIGHT,
        )

        temp_id = secrets.token_urlsafe(16)
        _temp_video_files.create(
            temp_id,
            path=hls_url,
            frames=first_frames,
            frames_complete=False,
            is_remote=True,
        )

        if TIMELINE_TOTAL_FRAME_COUNT > TIMELINE_INITIAL_FRAME_COUNT:
            _start_background_thumbnail_extraction(hls_url, temp_id)
        else:
            _temp_video_files.update(temp_id, frames_complete=True)

        return {
            "success": True,
            "frames": first_frames,
            "duration": duration,
            "temp_id": temp_id,
            "hls_url": hls_url,
        }
    except Exception as e:
        logger.exception("Existing video thumbnail extraction failed")
        raise HTTPException(status_code=500, detail=f"Thumbnail extraction failed: {str(e)}")


@router.get("/video-thumbnails/more/{temp_id}")
async def get_more_thumbnails(temp_id: str):
    """Get additional thumbnail frames that were extracted in background.

    Returns frames extracted beyond the first frame, used for progressive loading.
    Client polls this endpoint until complete=true.
    """
    temp_info = _temp_video_files.get(temp_id)
    if not temp_info:
        raise HTTPException(status_code=404, detail="Invalid or expired temp_id")

    return {
        "frames": temp_info.get("frames", []),
        "complete": temp_info.get("frames_complete", False),
    }


@router.get("/hls-progress/{session_id}")
async def get_hls_progress(session_id: str):
    """Get HLS encoding progress for a session.

    Returns current status, stage, progress percentage, and hls_url when complete.
    """
    session = _hls_sessions.get(session_id)
    if not session:
        return JSONResponse({
            "status": "unknown",
            "stage": "Session not found",
            "progress": 0,
        })

    response = {
        "status": session["status"],
        "stage": session["stage"],
        "progress": session["progress"],
    }

    if session["status"] == "complete" and session.get("hls_url"):
        response["hls_url"] = session["hls_url"]

    if session["status"] == "error":
        response["error"] = session.get("error", "Unknown error")

    return response


@router.post("/generate-sprite-sheet")
async def generate_sprite_sheet_endpoint(request: Request):
    """Generate sprite sheet and thumbnail after user confirms selection.

    Called after user has selected their sprite range. HLS encoding should
    already be complete or in progress from the initial thumbnail extraction.

    If HLS is still processing, this endpoint waits for it to complete
    before returning the combined result.
    """
    import time

    form = await request.form()
    temp_id = form.get("temp_id")
    hls_session_id = form.get("hls_session_id")
    project_slug = form.get("project_slug")
    sprite_start = float(form.get("sprite_start", 0))
    sprite_duration = float(form.get("sprite_duration", 3))

    if not temp_id:
        raise HTTPException(status_code=400, detail="temp_id is required")
    if not project_slug:
        raise HTTPException(status_code=400, detail="project_slug is required")
    if not validate_slug(project_slug):
        raise HTTPException(status_code=400, detail="Invalid slug format")

    # Get the temp video file
    temp_info = _temp_video_files.get(temp_id)
    if not temp_info:
        raise HTTPException(status_code=400, detail="Invalid or expired temp_id")

    temp_path = temp_info["path"]
    is_remote = temp_info.get("is_remote", False) or _is_remote_video_source(temp_path)
    if not is_remote and not os.path.exists(temp_path):
        raise HTTPException(status_code=400, detail="Temp file not found")

    try:
        from utils.video import generate_sprite_and_thumbnail

        # Generate sprite sheet and thumbnail
        result = generate_sprite_and_thumbnail(
            temp_path,
            project_slug,
            sprite_start=sprite_start,
            sprite_duration=sprite_duration,
        )

        # Wait for HLS to complete if session ID provided
        hls_url = None
        if hls_session_id:
            # Poll for HLS completion (max 5 minutes)
            max_wait = 300
            waited = 0
            while waited < max_wait:
                session = _hls_sessions.get(hls_session_id)
                if not session:
                    break
                if session["status"] == "complete":
                    hls_url = session.get("hls_url")
                    break
                if session["status"] == "error":
                    raise HTTPException(
                        status_code=500,
                        detail=f"HLS encoding failed: {session.get('error', 'Unknown error')}"
                    )
                time.sleep(1)
                waited += 1

            if waited >= max_wait:
                raise HTTPException(status_code=500, detail="HLS encoding timed out")

        if not hls_url:
            project = load_project(project_slug)
            hls_url = project.get("video_link") if project else None
        if not hls_url:
            raise HTTPException(
                status_code=500,
                detail="HLS URL unavailable after sprite generation",
            )

        # Combine results
        video_payload: dict[str, Any] = {
            "hls": hls_url,
            "thumbnail": result["thumbnail"],
            "spriteSheet": result["spriteSheet"],
        }
        sprite_meta = result.get("spriteMeta")
        if isinstance(sprite_meta, dict):
            for key in ("frames", "columns", "rows", "frame_width", "frame_height", "fps"):
                value = sprite_meta.get(key)
                if isinstance(value, bool):
                    continue
                if isinstance(value, (int, float)) and value > 0:
                    video_payload[key] = int(value)

        response = {
            "success": True,
            "video": video_payload,
        }

        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Sprite sheet generation failed")
        raise HTTPException(status_code=500, detail=f"Sprite sheet generation failed: {str(e)}")
    finally:
        # Clean up temp file and sessions
        removed_temp = _temp_video_files.pop(temp_id)
        if removed_temp:
            removed_path = removed_temp["path"]
            removed_is_remote = removed_temp.get("is_remote", False) or _is_remote_video_source(removed_path)
            if not removed_is_remote and os.path.exists(removed_path):
                try:
                    os.unlink(removed_path)
                except Exception:
                    pass
        if hls_session_id:
            _hls_sessions.delete(hls_session_id)


@router.post("/process-content-video")
async def process_content_video(request: Request):
    """Process a content video: compress and upload.

    Streams the upload in 1 MB chunks to avoid loading the entire file into RAM.
    """
    form = await request.form()
    file = form.get("file")

    if not file:
        raise HTTPException(status_code=400, detail="File is required")

    try:
        from utils.video import process_content_video as process_video

        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as temp_file:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                temp_file.write(chunk)
            temp_path = temp_file.name

        try:
            url = process_video(temp_path)
            return {"success": True, "url": url}
        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)

    except Exception as e:
        logger.exception("Content video processing failed")
        raise HTTPException(status_code=500, detail="Video processing failed")


@router.post("/content-video-poster")
async def extract_content_video_poster(request: Request):
    """Extract and upload a poster frame from an existing content video URL."""
    data = await request.json()
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Invalid request body")

    source_url = data.get("source_url")
    frame_time_raw = data.get("frame_time", 0)

    if not isinstance(source_url, str) or not source_url.strip():
        raise HTTPException(status_code=400, detail="source_url is required")

    source_url = source_url.strip()
    parsed = urlparse(source_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail="source_url must be an absolute http(s) URL")
    if parsed.netloc != CLOUDFRONT_DOMAIN:
        raise HTTPException(status_code=400, detail="source_url must use configured CloudFront domain")

    try:
        frame_time = float(frame_time_raw)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="frame_time must be a number")
    if frame_time < 0:
        frame_time = 0.0
    if frame_time > 6 * 60 * 60:
        raise HTTPException(status_code=400, detail="frame_time exceeds maximum allowed range")

    try:
        from utils.s3 import upload_file
        from utils.video import generate_thumbnail

        with tempfile.TemporaryDirectory() as temp_dir:
            poster_path = os.path.join(temp_dir, "poster.webp")
            generate_thumbnail(
                source_url,
                poster_path,
                time=frame_time,
                width=1600,
                height=1600,
            )

            with open(poster_path, "rb") as poster_file:
                poster_bytes = poster_file.read()

        content_hash = compute_hash(poster_bytes)
        existing_key = find_by_hash(content_hash)
        if existing_key:
            return {
                "success": True,
                "url": f"https://{CLOUDFRONT_DOMAIN}/{existing_key}",
                "deduplicated": True,
            }

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        key = content_image_key(f"{timestamp}.webp")
        url = upload_file(io.BytesIO(poster_bytes), key, "image/webp")
        register_asset(key, content_hash, len(poster_bytes))

        return {"success": True, "url": url, "deduplicated": False}
    except HTTPException:
        raise
    except Exception:
        logger.exception("Content video poster extraction failed")
        raise HTTPException(status_code=500, detail="Poster extraction failed")


def cleanup_old_temp_videos():
    """
    Clean up temp video files and orphaned HLS sessions older than 1 hour.
    Called on server startup and can be called periodically if needed.

    For HLS sessions that completed but sprite sheet was never requested,
    this also deletes the orphaned HLS files from S3.
    """
    now = datetime.now()
    expiry = timedelta(hours=1)
    expired_ids = []

    for temp_id, temp_info in _temp_video_files.snapshot():
        age = now - temp_info["timestamp"]
        if age > expiry:
            temp_path = temp_info["path"]
            if not (temp_info.get("is_remote", False) or _is_remote_video_source(temp_path)) and os.path.exists(temp_path):
                try:
                    os.unlink(temp_path)
                    logger.info(f"Cleaned up expired temp video file: {temp_path}")
                except Exception as e:
                    logger.warning(f"Failed to delete temp file {temp_path}: {e}")
            expired_ids.append(temp_id)

    # Remove expired entries from the dict
    for temp_id in expired_ids:
        _temp_video_files.delete(temp_id)

    if expired_ids:
        logger.info(f"Cleaned up {len(expired_ids)} expired temp video file(s)")

    # Clean up orphaned HLS sessions
    expired_hls_ids = []
    for session_id, session in _hls_sessions.snapshot():
        age = now - session["timestamp"]
        if age > expiry:
            # If HLS completed but sprite was never requested, clean up orphaned version
            # We use cleanup_old_hls_versions to preserve any currently-saved video
            if session["status"] == "complete" and session.get("slug"):
                try:
                    # Load project to get currently saved HLS URL
                    project = load_project(session["slug"])
                    current_hls = project.get("video_link") if project else None
                    cleanup_old_hls_versions(session["slug"], current_hls)
                    logger.info(f"Cleaned up orphaned HLS versions for slug: {session['slug']}")
                except Exception as e:
                    logger.warning(f"Failed to clean up HLS files for {session['slug']}: {e}")
            expired_hls_ids.append(session_id)

    for session_id in expired_hls_ids:
        _hls_sessions.delete(session_id)

    if expired_hls_ids:
        logger.info(f"Cleaned up {len(expired_hls_ids)} expired HLS session(s)")


# Clean up any leftover temp files on startup
cleanup_old_temp_videos()

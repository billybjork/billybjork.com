import io
import logging
import os
import tempfile
import threading
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from dependencies import require_dev_mode
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
    delete_project,
    load_about,
    load_project,
    load_settings,
    save_about,
    save_project,
    save_settings,
    validate_slug,
)
from utils.s3 import CLOUDFRONT_DOMAIN

logger = logging.getLogger(__name__)

# Processing progress tracker: { slug: { status, stage, progress, video, error } }
_processing_progress = {}

# Temp video sources for thumbnail preview:
# { temp_id: { path, timestamp, frames, frames_complete, is_remote } }
_temp_video_files = {}

# HLS encoding sessions: { session_id: { status, stage, progress, hls_url, temp_id, slug, timestamp, error } }
_hls_sessions = {}

TIMELINE_INITIAL_FRAME_COUNT = 6
TIMELINE_TOTAL_FRAME_COUNT = 20
TIMELINE_FRAME_WIDTH = 96
TIMELINE_FRAME_HEIGHT = 54


def _is_remote_video_source(path: str) -> bool:
    return isinstance(path, str) and (
        path.startswith("http://") or path.startswith("https://")
    )


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
            if temp_id in _temp_video_files:
                _temp_video_files[temp_id]["frames"] = all_frames
                _temp_video_files[temp_id]["frames_complete"] = True
        except Exception as e:
            logger.warning(f"Background thumbnail extraction failed: {e}")
            if temp_id in _temp_video_files:
                _temp_video_files[temp_id]["frames_complete"] = True

    thread = threading.Thread(target=extract_remaining_frames, daemon=True)
    thread.start()


router = APIRouter(
    prefix="/api",
    tags=["admin"],
    dependencies=[Depends(require_dev_mode)],
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
        },
        "markdown": project_data.get("markdown_content", ""),
        "html": project_data.get("html_content", ""),
    }


@router.post("/save-project")
async def save_project_endpoint(request: Request):
    """Save project content."""
    data = await request.json()
    slug = data.get("slug")

    if not slug:
        raise HTTPException(status_code=400, detail="Slug is required")
    if not validate_slug(slug):
        raise HTTPException(status_code=400, detail="Invalid slug format")

    # Load old project to track removed references
    old_project = load_project(slug)
    if not old_project:
        raise HTTPException(status_code=404, detail="Project not found. Use create-project for new projects.")

    old_refs = extract_cloudfront_urls(old_project.get("markdown_content", ""))
        # Include video frontmatter URLs
        if old_project.get("video_link"):
            old_refs.add(old_project["video_link"])
        if old_project.get("thumbnail_link"):
            old_refs.add(old_project["thumbnail_link"])
        if old_project.get("sprite_sheet_link"):
            old_refs.add(old_project["sprite_sheet_link"])

    frontmatter = {
        "name": data.get("name", slug),
        "slug": slug,
        "date": data.get("date"),
        "pinned": data.get("pinned", False),
        "draft": data.get("draft", False),
    }

    video = data.get("video", {})
    if not isinstance(video, dict):
        video = {}
    if video.get("hls") or video.get("thumbnail") or video.get("spriteSheet"):
        frontmatter["video"] = {
            "hls": video.get("hls"),
            "thumbnail": video.get("thumbnail"),
            "spriteSheet": video.get("spriteSheet"),
        }

    if data.get("youtube"):
        frontmatter["youtube"] = data.get("youtube")

    markdown_content = data.get("markdown", "")
    save_project(slug, frontmatter, markdown_content)

    # Cleanup orphaned assets
    new_refs = extract_cloudfront_urls(markdown_content)
    if video.get("hls"):
        new_refs.add(video["hls"])
    if video.get("thumbnail"):
        new_refs.add(video["thumbnail"])
    if video.get("spriteSheet"):
        new_refs.add(video["spriteSheet"])

    removed_urls = old_refs - new_refs
    keys_to_check = {extract_s3_key(url) for url in removed_urls if extract_s3_key(url)}
    if keys_to_check:
        cleanup_orphans(keys_to_check)

    # Clean up old HLS versions (keeps only the current version)
    cleanup_old_hls_versions(slug, video.get("hls"))

    return {"success": True, "slug": slug}


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

    # Collect all CloudFront URLs from this project
    project_refs = extract_cloudfront_urls(project.get("markdown_content", ""))
    if project.get("video_link"):
        project_refs.add(project["video_link"])
    if project.get("thumbnail_link"):
        project_refs.add(project["thumbnail_link"])
    if project.get("sprite_sheet_link"):
        project_refs.add(project["sprite_sheet_link"])

    # Delete the project file first
    delete_project(slug)

    # Cleanup orphaned assets (assets not referenced elsewhere)
    keys_to_check = {extract_s3_key(url) for url in project_refs if extract_s3_key(url)}
    if keys_to_check:
        cleanup_orphans(keys_to_check)

    # Delete hero video prefix (HLS files, etc.)
    delete_video_prefix(slug)

    return {"success": True}


@router.get("/about")
async def get_about():
    """Get about page content for editing."""
    html_content, markdown_content = load_about()
    return {"html": html_content, "markdown": markdown_content}


@router.post("/save-about")
async def save_about_endpoint(request: Request):
    """Save about page content and cleanup orphaned assets."""
    data = await request.json()
    markdown_content = data.get("markdown", "")

    # Load old about content to track removed references
    _, old_markdown = load_about()
    old_refs = extract_cloudfront_urls(old_markdown)

    save_about(markdown_content)

    # Cleanup orphaned assets
    new_refs = extract_cloudfront_urls(markdown_content)
    removed_urls = old_refs - new_refs
    keys_to_check = {extract_s3_key(url) for url in removed_urls if extract_s3_key(url)}
    if keys_to_check:
        cleanup_orphans(keys_to_check)

    return {"success": True}


@router.get("/settings")
async def get_settings():
    """Get site settings for editing."""
    return load_settings()


@router.post("/save-settings")
async def save_settings_endpoint(request: Request):
    """Save site settings."""
    data = await request.json()
    save_settings(data)
    return {"success": True}


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
        _temp_video_files[temp_id] = {
            "path": temp_path,
            "timestamp": datetime.now(),
            "frames": first_frames,  # Will be extended with more frames
            "frames_complete": False,
            "is_remote": False,
        }

        if TIMELINE_TOTAL_FRAME_COUNT > TIMELINE_INITIAL_FRAME_COUNT:
            _start_background_thumbnail_extraction(temp_path, temp_id)
        else:
            _temp_video_files[temp_id]["frames_complete"] = True

        response = {
            "success": True,
            "frames": first_frames,
            "duration": duration,
            "temp_id": temp_id,
        }

        # Auto-start HLS encoding if project_slug provided
        if project_slug:
            hls_session_id = secrets.token_urlsafe(16)
            _hls_sessions[hls_session_id] = {
                "status": "processing",
                "stage": "Starting HLS encoding...",
                "progress": 0,
                "hls_url": None,
                "temp_id": temp_id,
                "slug": project_slug,
                "timestamp": datetime.now(),
                "error": None,
            }

            def run_hls_encoding():
                from utils.video import generate_hls_only

                def progress_callback(stage, progress):
                    if hls_session_id in _hls_sessions:
                        _hls_sessions[hls_session_id]["stage"] = stage
                        _hls_sessions[hls_session_id]["progress"] = progress

                try:
                    # Note: Don't delete old files here - they're cleaned up after save
                    # to prevent data loss if user cancels mid-upload
                    hls_url = generate_hls_only(
                        temp_path,
                        project_slug,
                        trim_start=0,
                        progress_callback=progress_callback,
                    )
                    if hls_session_id in _hls_sessions:
                        _hls_sessions[hls_session_id].update({
                            "status": "complete",
                            "stage": "HLS complete!",
                            "progress": 100,
                            "hls_url": hls_url,
                        })
                except Exception as e:
                    logger.exception("HLS encoding failed")
                    if hls_session_id in _hls_sessions:
                        _hls_sessions[hls_session_id].update({
                            "status": "error",
                            "stage": "HLS encoding failed",
                            "error": str(e),
                        })

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
        _temp_video_files[temp_id] = {
            "path": hls_url,
            "timestamp": datetime.now(),
            "frames": first_frames,
            "frames_complete": False,
            "is_remote": True,
        }

        if TIMELINE_TOTAL_FRAME_COUNT > TIMELINE_INITIAL_FRAME_COUNT:
            _start_background_thumbnail_extraction(hls_url, temp_id)
        else:
            _temp_video_files[temp_id]["frames_complete"] = True

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
        response = {
            "success": True,
            "video": {
                "hls": hls_url,
                "thumbnail": result["thumbnail"],
                "spriteSheet": result["spriteSheet"],
            },
        }

        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Sprite sheet generation failed")
        raise HTTPException(status_code=500, detail=f"Sprite sheet generation failed: {str(e)}")
    finally:
        # Clean up temp file and sessions
        if temp_id in _temp_video_files:
            if not is_remote and os.path.exists(temp_path):
                try:
                    os.unlink(temp_path)
                except Exception:
                    pass
            del _temp_video_files[temp_id]
        if hls_session_id and hls_session_id in _hls_sessions:
            del _hls_sessions[hls_session_id]


@router.post("/process-hero-video")
async def process_hero_video(request: Request):
    """Process a hero video: generate HLS, sprite sheet, and thumbnail.

    Streams the upload in 1 MB chunks to avoid loading the entire file into RAM.
    Processing runs in a background thread with progress tracking.

    Accepts either a file upload OR a temp_id from a previous thumbnail extraction.
    """
    form = await request.form()
    file = form.get("file")
    temp_id = form.get("temp_id")
    project_slug = form.get("project_slug")
    sprite_start = float(form.get("sprite_start", 0))
    sprite_duration = float(form.get("sprite_duration", 3))

    if not project_slug:
        raise HTTPException(status_code=400, detail="project_slug is required")
    if not validate_slug(project_slug):
        raise HTTPException(status_code=400, detail="Invalid slug format")

    # Use existing temp file if temp_id provided, otherwise expect file upload
    temp_path = None
    use_existing_temp = False

    if temp_id:
        # Use existing temp file from thumbnail extraction
        temp_info = _temp_video_files.get(temp_id)
        if not temp_info:
            raise HTTPException(status_code=400, detail="Invalid or expired temp_id")
        temp_path = temp_info["path"]
        if not os.path.exists(temp_path):
            raise HTTPException(status_code=400, detail="Temp file not found")
        use_existing_temp = True
    else:
        # Backwards compatible: accept file upload
        if not file:
            raise HTTPException(status_code=400, detail="Either file or temp_id is required")
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
            logger.exception("Hero video upload failed")
            raise HTTPException(status_code=500, detail="Video upload failed")

    # Initialize progress tracking
    _processing_progress[project_slug] = {
        "status": "processing",
        "stage": "Starting...",
        "progress": 0,
        "video": None,
        "error": None,
    }

    def progress_callback(stage: str, progress: float):
        _processing_progress[project_slug]["stage"] = stage
        _processing_progress[project_slug]["progress"] = progress

    def run_processing():
        from utils.video import process_hero_video as process_video

        try:
            # Note: Don't delete old files here - they're cleaned up after save
            # to prevent data loss if user cancels mid-upload
            result = process_video(
                temp_path,
                project_slug,
                trim_start=0,
                sprite_start=sprite_start,
                sprite_duration=sprite_duration,
                progress_callback=progress_callback,
            )

            _processing_progress[project_slug].update({
                "status": "complete",
                "stage": "Complete!",
                "progress": 100,
                "video": {
                    "hls": result["hls"],
                    "thumbnail": result["thumbnail"],
                    "spriteSheet": result["spriteSheet"],
                },
            })
        except Exception as e:
            logger.exception("Hero video processing failed")
            _processing_progress[project_slug].update({
                "status": "error",
                "stage": "Failed",
                "error": str(e),
            })
        finally:
            # Clean up temp file
            if os.path.exists(temp_path):
                os.unlink(temp_path)
            # Remove from temp files dict if it was using a temp_id
            if temp_id and temp_id in _temp_video_files:
                del _temp_video_files[temp_id]

    # Start processing in background thread
    thread = threading.Thread(target=run_processing, daemon=True)
    thread.start()

    return {"success": True, "message": "Upload received, processing started"}


@router.get("/process-hero-video/progress/{slug}")
async def get_hero_video_progress(slug: str):
    """Get processing progress for a hero video."""
    progress = _processing_progress.get(slug)
    if not progress:
        return JSONResponse({"status": "unknown", "stage": "No processing in progress", "progress": 0})

    response = {
        "status": progress["status"],
        "stage": progress["stage"],
        "progress": progress["progress"],
    }

    if progress["status"] == "complete" and progress.get("video"):
        response["video"] = progress["video"]
        # Clean up progress entry after delivering result
        del _processing_progress[slug]

    if progress["status"] == "error":
        response["error"] = progress.get("error", "Unknown error")
        del _processing_progress[slug]

    return response


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


def cleanup_old_temp_videos():
    """
    Clean up temp video files and orphaned HLS sessions older than 1 hour.
    Called on server startup and can be called periodically if needed.

    For HLS sessions that completed but sprite sheet was never requested,
    this also deletes the orphaned HLS files from S3.
    """
    from datetime import timedelta

    now = datetime.now()
    expired_ids = []

    for temp_id, temp_info in _temp_video_files.items():
        age = now - temp_info["timestamp"]
        if age > timedelta(hours=1):
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
        del _temp_video_files[temp_id]

    if expired_ids:
        logger.info(f"Cleaned up {len(expired_ids)} expired temp video file(s)")

    # Clean up orphaned HLS sessions
    expired_hls_ids = []
    for session_id, session in _hls_sessions.items():
        age = now - session["timestamp"]
        if age > timedelta(hours=1):
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
        del _hls_sessions[session_id]

    if expired_hls_ids:
        logger.info(f"Cleaned up {len(expired_hls_ids)} expired HLS session(s)")


# Clean up any leftover temp files on startup
cleanup_old_temp_videos()

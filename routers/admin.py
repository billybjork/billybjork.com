import io
import logging
import os
import tempfile
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request

logger = logging.getLogger(__name__)

from dependencies import require_dev_mode
from utils.assets import (
    cleanup_orphans,
    compute_hash,
    delete_video_prefix,
    extract_cloudfront_urls,
    extract_s3_key,
    find_by_hash,
    register_asset,
)
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
    old_refs = set()
    if old_project:
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

    return {"success": True, "slug": slug}


@router.post("/create-project")
async def create_project(request: Request):
    """Create a new project."""
    data = await request.json()
    slug = data.get("slug")

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

    if not file:
        raise HTTPException(status_code=400, detail="No file provided")

    if media_type == "video":
        raise HTTPException(
            status_code=400, detail="Use /api/process-content-video for video uploads"
        )

    if media_type != "image":
        raise HTTPException(status_code=400, detail="Invalid media type")

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
        key = f"images/{timestamp}.webp"

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


@router.post("/process-hero-video")
async def process_hero_video(request: Request):
    """Process a hero video: generate HLS, sprite sheet, and thumbnail."""
    form = await request.form()
    file = form.get("file")
    project_slug = form.get("project_slug")
    sprite_start = float(form.get("sprite_start", 0))
    sprite_duration = float(form.get("sprite_duration", 3))

    if not file or not project_slug:
        raise HTTPException(status_code=400, detail="File and project_slug are required")
    if not validate_slug(project_slug):
        raise HTTPException(status_code=400, detail="Invalid slug format")

    try:
        from utils.video import process_hero_video as process_video

        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as temp_file:
            content = await file.read()
            temp_file.write(content)
            temp_path = temp_file.name

        try:
            result = process_video(
                temp_path,
                project_slug,
                trim_start=0,
                sprite_start=sprite_start,
                sprite_duration=sprite_duration,
            )

            return {
                "success": True,
                "video": {
                    "hls": result["hls"],
                    "thumbnail": result["thumbnail"],
                    "spriteSheet": result["spriteSheet"],
                },
                "spriteMeta": result.get("spriteMeta", {}),
            }
        finally:
            if os.path.exists(temp_path):
                os.unlink(temp_path)

    except Exception as e:
        logger.exception("Hero video processing failed")
        raise HTTPException(status_code=500, detail="Video processing failed")


@router.post("/process-content-video")
async def process_content_video(request: Request):
    """Process a content video: compress and upload."""
    form = await request.form()
    file = form.get("file")

    if not file:
        raise HTTPException(status_code=400, detail="File is required")

    try:
        from utils.video import process_content_video as process_video

        with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as temp_file:
            content = await file.read()
            temp_file.write(content)
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

"""Editor APIs for project and about content, with optimistic locking and orphan cleanup."""
import asyncio
import logging
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from cms.about import load_about, save_about
from cms.assets import cleanup_old_hero_versions, cleanup_orphans, delete_hero_videos
from cms.projects import (
    ProjectVideo,
    delete_project,
    load_project,
    referenced_asset_urls,
    save_project,
    validate_slug,
)
from edit_auth import require_edit_mode
from media.keys import hero_root
from object_storage import extract_public_asset_urls, object_keys

logger = logging.getLogger(__name__)

_MAX_CLEANUP_CANDIDATES = 200

router = APIRouter(prefix="/api", tags=["admin"], dependencies=[Depends(require_edit_mode)])


async def _json_object(request: Request) -> dict[str, Any]:
    data = await request.json()
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Invalid request body")
    return data


def _markdown_field(data: dict[str, Any]) -> str:
    markdown_content = data.get("markdown", "")
    if not isinstance(markdown_content, str):
        raise HTTPException(status_code=400, detail="Markdown must be a string")
    return markdown_content


def _conflict(data: dict[str, Any], revision: str | None, markdown_content: str, message: str):
    """The 409 for a save based on a stale revision, or None when the save may proceed."""
    base_revision = data.get("base_revision")
    if not base_revision or data.get("force") or not revision or base_revision == revision:
        return None
    return JSONResponse(
        status_code=409,
        content={
            "conflict": True,
            "server_revision": revision,
            "server_markdown": markdown_content,
            "your_markdown": data.get("markdown", ""),
            "message": message,
        },
    )


def _cleanup_candidates(urls: Any) -> set[str]:
    if not isinstance(urls, list):
        return set()
    return {
        item.strip()
        for item in urls[:_MAX_CLEANUP_CANDIDATES]
        if isinstance(item, str) and item.strip()
    }


def _save_slugs(data: dict[str, Any]) -> tuple[str, str]:
    slug_raw = data.get("slug")
    original_raw = data.get("original_slug") or slug_raw
    if not isinstance(slug_raw, str) or not slug_raw:
        raise HTTPException(status_code=400, detail="Slug is required")
    if not isinstance(original_raw, str):
        raise HTTPException(status_code=400, detail="Original slug is required")

    slug, original_slug = slug_raw.strip(), original_raw.strip()
    if not validate_slug(slug):
        raise HTTPException(status_code=400, detail="Invalid slug format")
    if not validate_slug(original_slug):
        raise HTTPException(status_code=400, detail="Invalid original slug format")
    return slug, original_slug


def _project_frontmatter(data: dict[str, Any], slug: str, video: ProjectVideo) -> dict[str, Any]:
    frontmatter: dict[str, Any] = {
        "name": data.get("name", slug),
        "slug": slug,
        "date": data.get("date"),
        "pinned": data.get("pinned", False),
        "draft": data.get("draft", False),
    }
    if stored_video := video.to_stored():
        frontmatter["video"] = stored_video
    og_image = data.get("og_image")
    if isinstance(og_image, str) and og_image.strip():
        frontmatter["og_image"] = og_image.strip()
    if data.get("youtube"):
        frontmatter["youtube"] = data["youtube"]
    return frontmatter


def _apply_project_save(data: dict[str, Any]):
    slug, original_slug = _save_slugs(data)
    renamed = original_slug != slug

    if renamed and load_project(slug):
        raise HTTPException(status_code=400, detail="Project with this slug already exists")

    old_project = load_project(original_slug)
    if not old_project:
        raise HTTPException(
            status_code=404,
            detail="Project not found. Use create-project for new projects.",
        )

    conflict = _conflict(
        data,
        old_project.revision,
        old_project.markdown_content,
        "Content was modified by another session",
    )
    if conflict:
        return conflict

    video = ProjectVideo.from_stored(data.get("video"))
    frontmatter = _project_frontmatter(data, slug, video)
    markdown_content = _markdown_field(data)

    save_project(slug, frontmatter, markdown_content)
    if renamed:
        delete_project(original_slug)

    new_refs = referenced_asset_urls(markdown_content, video, frontmatter.get("og_image"))
    removed = old_project.asset_urls | _cleanup_candidates(data.get("cleanup_candidates"))
    cleanup_orphans(object_keys(removed - new_refs))

    # A rename leaves the hero video files under the original slug's prefix.
    hls = video.hls
    if renamed and f"/{hero_root(original_slug)}/" not in (hls or ""):
        hls = None
    cleanup_old_hero_versions(original_slug, hls)

    return {"success": True, "slug": slug, "revision": load_project(slug).revision}


@router.get("/project/{slug}")
async def get_project(slug: str):
    project = await asyncio.to_thread(load_project, slug)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return await asyncio.to_thread(project.to_edit_payload)


@router.post("/save-project")
async def save_project_endpoint(request: Request):
    return await asyncio.to_thread(_apply_project_save, await _json_object(request))


@router.post("/create-project")
async def create_project(request: Request):
    data = await request.json()
    slug = data.get("slug")

    if not slug:
        raise HTTPException(status_code=400, detail="Slug is required")
    if not validate_slug(slug):
        raise HTTPException(status_code=400, detail="Invalid slug format")
    if await asyncio.to_thread(load_project, slug):
        raise HTTPException(status_code=400, detail="Project with this slug already exists")

    frontmatter = _project_frontmatter(
        {"date": datetime.now().strftime("%Y-%m-%d"), **data}, slug, ProjectVideo()
    )
    await asyncio.to_thread(save_project, slug, frontmatter, data.get("markdown", ""))
    return {"success": True, "slug": slug}


def _apply_project_delete(slug: str) -> None:
    project = load_project(slug)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    delete_project(slug)
    cleanup_orphans(object_keys(project.asset_urls))
    delete_hero_videos(slug)


@router.delete("/project/{slug}")
async def delete_project_endpoint(slug: str):
    await asyncio.to_thread(_apply_project_delete, slug)
    return {"success": True}


@router.get("/about")
async def get_about():
    about = await asyncio.to_thread(load_about)
    return {"html": about.html, "markdown": about.markdown, "revision": about.revision}


def _apply_about_save(data: dict[str, Any]):
    markdown_content = _markdown_field(data)
    old = load_about()

    conflict = _conflict(data, old.revision, old.markdown, "About page was modified by another session")
    if conflict:
        return conflict

    save_about(markdown_content)
    removed = extract_public_asset_urls(old.markdown) - extract_public_asset_urls(markdown_content)
    cleanup_orphans(object_keys(removed))
    return {"success": True, "revision": load_about().revision}


@router.post("/save-about")
async def save_about_endpoint(request: Request):
    return await asyncio.to_thread(_apply_about_save, await _json_object(request))


@router.post("/cleanup-assets")
async def cleanup_assets_endpoint(request: Request):
    """Run orphan cleanup for asset URLs the editor stopped using before they were ever saved."""
    data = await _json_object(request)
    keys = object_keys(_cleanup_candidates(data.get("urls")))
    await asyncio.to_thread(cleanup_orphans, keys)
    return {"success": True, "checked": len(keys)}

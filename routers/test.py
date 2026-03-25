"""Test route for exploring point cloud rendering from RGBD sprite sheets."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import HTMLResponse

from config import templates
from utils.content import ProjectCardInfo, get_content_paths, load_project_info

logger = logging.getLogger(__name__)

DEFAULT_TEST_SPRITE_SLUG_MAP = [
    ("somewhere-in-space", "somewhere-in-space"),
    ("gravity", "secretmap-x-gravity"),
    ("lead-me-home", "lead-me-home"),
    ("surf", "surf"),
]
TEST_RGBD_SPRITES_DIR = Path(__file__).resolve().parent.parent / "static" / "test" / "rgbd-sprites"
DEFAULT_TEST_RESOLUTION_WIDTH = 640
DEFAULT_TEST_RESOLUTION_HEIGHT = 360

router = APIRouter()


def _is_localhost(request: Request) -> bool:
    """Check if request is from localhost by TCP peer address."""
    client_host = request.client.host if request.client else None
    return client_host in ("127.0.0.1", "::1")


def _load_test_project_entries() -> list[tuple[str, str]]:
    """Load ordered sprite/slug pairs for /test from content config."""
    test_projects_file = get_content_paths().test_projects_file
    if not test_projects_file.exists():
        return list(DEFAULT_TEST_SPRITE_SLUG_MAP)

    try:
        with open(test_projects_file, "r", encoding="utf-8") as file_obj:
            payload = json.load(file_obj)
    except (OSError, json.JSONDecodeError) as err:
        logger.warning("Failed to read %s: %s", test_projects_file, err)
        return list(DEFAULT_TEST_SPRITE_SLUG_MAP)

    raw_entries = payload.get("projects") if isinstance(payload, dict) else payload
    if not isinstance(raw_entries, list):
        logger.warning("Invalid /test project config format in %s", test_projects_file)
        return list(DEFAULT_TEST_SPRITE_SLUG_MAP)

    parsed_entries: list[tuple[str, str]] = []
    for entry in raw_entries:
        if not isinstance(entry, dict):
            continue
        sprite_id = str(entry.get("sprite_id", "")).strip()
        project_slug = str(entry.get("slug", "")).strip()
        if not sprite_id or not project_slug:
            continue
        parsed_entries.append((sprite_id, project_slug))

    if parsed_entries:
        return parsed_entries
    return list(DEFAULT_TEST_SPRITE_SLUG_MAP)


def _load_rgbd_sprite_metadata(sprite_id: str) -> dict:
    """Load RGBD sprite metadata for a test project, if available."""
    metadata_path = TEST_RGBD_SPRITES_DIR / sprite_id / "metadata.json"
    if not metadata_path.exists():
        return {}

    try:
        with open(metadata_path, "r", encoding="utf-8") as file_obj:
            metadata = json.load(file_obj)
    except (OSError, json.JSONDecodeError) as err:
        logger.warning("Failed to read sprite metadata for %s: %s", sprite_id, err)
        return {}

    resolutions = metadata.get("resolutions")
    if not isinstance(resolutions, dict) or not resolutions:
        return {}

    resolution = _select_rgbd_resolution(resolutions)
    if not resolution:
        return {}

    _, resolution_payload = resolution

    frame_width = resolution_payload.get("frame_width")
    frame_height = resolution_payload.get("frame_height")
    aspect_ratio = metadata.get("aspect_ratio")
    if isinstance(frame_width, (int, float)) and isinstance(frame_height, (int, float)) and frame_height:
        if not isinstance(aspect_ratio, (int, float)) or aspect_ratio <= 0:
            aspect_ratio = frame_width / frame_height

    rgb_file = resolution_payload.get("rgb_file")
    sprite_sheet_url = None
    if isinstance(rgb_file, str) and rgb_file.strip():
        sprite_sheet_url = f"/static/test/rgbd-sprites/{sprite_id}/{rgb_file.strip()}"

    return {
        "frames": metadata.get("frames"),
        "columns": metadata.get("columns"),
        "rows": metadata.get("rows"),
        "frame_width": frame_width,
        "frame_height": frame_height,
        "sprite_sheet_link": sprite_sheet_url,
        "sprite_aspect_ratio": aspect_ratio,
    }


def _select_rgbd_resolution(resolutions: dict) -> tuple[str, dict] | None:
    """Pick the best available atlas resolution for the current test runtime."""
    candidates: list[tuple[tuple[int, int, int, int, int], str, dict]] = []
    for key, value in resolutions.items():
        if not isinstance(key, str) or not isinstance(value, dict):
            continue
        frame_width = value.get("frame_width")
        frame_height = value.get("frame_height")
        if not isinstance(frame_width, int) or not isinstance(frame_height, int):
            continue
        if frame_width <= 0 or frame_height <= 0:
            continue
        candidates.append(
            (
                (
                    0 if frame_width == DEFAULT_TEST_RESOLUTION_WIDTH else 1,
                    abs(frame_width - DEFAULT_TEST_RESOLUTION_WIDTH),
                    abs(frame_height - DEFAULT_TEST_RESOLUTION_HEIGHT),
                    -frame_width,
                    -frame_height,
                ),
                key,
                value,
            )
        )

    if not candidates:
        return None

    candidates.sort(key=lambda item: item[0])
    _, key, value = candidates[0]
    return key, value


def _load_test_projects() -> list[ProjectCardInfo]:
    """Load projects that currently have RGBD sprite assets for /test."""
    projects = []
    for sprite_id, project_slug in _load_test_project_entries():
        project = load_project_info(project_slug)
        if not project:
            continue
        sprite_metadata = _load_rgbd_sprite_metadata(sprite_id)
        projects.append(
            project.to_card(
                media_overrides=sprite_metadata,
                sprite_id=sprite_id,
            )
        )
    return projects


def _test_template_context(
    request: Request,
    initial_project_slug: str | None = None,
    initial_project_direct_entry: bool = False,
) -> dict:
    projects = _load_test_projects()
    slug_set = {project.slug for project in projects}
    if initial_project_slug and initial_project_slug not in slug_set:
        raise HTTPException(status_code=404, detail="Project not found in /test")

    return {
        "request": request,
        "projects": projects,
        "page_title": "Point Cloud Shared Renderer Test",
        "page_meta_description": "Testing shared-canvas point cloud rendering from RGBD sprite sheets",
        "project_url_sync": False,
        "is_dev_mode": _is_localhost(request),
        "initial_project_slug": initial_project_slug,
        "initial_project_direct_entry": initial_project_direct_entry,
        "test_base_path": "/test",
    }


@router.get("/test", response_class=HTMLResponse)
async def test_page(request: Request, project: str | None = Query(None)):
    """Render the shared-canvas point cloud depth test page."""
    initial_project_slug = project.strip() if isinstance(project, str) else None
    if initial_project_slug == "":
        initial_project_slug = None

    return templates.TemplateResponse(
        request,
        "test.html",
        _test_template_context(
            request,
            initial_project_slug=initial_project_slug,
            initial_project_direct_entry=bool(initial_project_slug),
        ),
    )


@router.get("/test/{project_slug}", response_class=HTMLResponse)
async def test_project_page(request: Request, project_slug: str):
    """Render /test with a project opened directly from URL."""
    return templates.TemplateResponse(
        request,
        "test.html",
        _test_template_context(
            request,
            initial_project_slug=project_slug,
            initial_project_direct_entry=True,
        ),
    )

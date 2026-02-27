"""Test route for exploring point cloud rendering from RGBD sprite sheets."""

import json
import logging

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse

from config import templates
from utils.content import CONTENT_DIR, ProjectInfo, load_project

logger = logging.getLogger(__name__)

DEFAULT_TEST_SPRITE_SLUG_MAP = [
    ("somewhere-in-space", "somewhere-in-space"),
    ("gravity", "secretmap-x-gravity"),
    ("lead-me-home", "lead-me-home"),
    ("surf", "surf"),
]
TEST_PROJECTS_FILE = CONTENT_DIR / "test_projects.json"

router = APIRouter()


def _is_localhost(request: Request) -> bool:
    """Check if request is from localhost by TCP peer address."""
    client_host = request.client.host if request.client else None
    return client_host in ("127.0.0.1", "::1")


def _load_test_project_entries() -> list[tuple[str, str]]:
    """Load ordered sprite/slug pairs for /test from content config."""
    if not TEST_PROJECTS_FILE.exists():
        return list(DEFAULT_TEST_SPRITE_SLUG_MAP)

    try:
        with open(TEST_PROJECTS_FILE, "r", encoding="utf-8") as file_obj:
            payload = json.load(file_obj)
    except (OSError, json.JSONDecodeError) as err:
        logger.warning("Failed to read %s: %s", TEST_PROJECTS_FILE, err)
        return list(DEFAULT_TEST_SPRITE_SLUG_MAP)

    raw_entries = payload.get("projects") if isinstance(payload, dict) else payload
    if not isinstance(raw_entries, list):
        logger.warning("Invalid /test project config format in %s", TEST_PROJECTS_FILE)
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


def _load_test_projects() -> list[dict]:
    """Load projects that currently have RGBD sprite assets for /test."""
    projects = []
    for sprite_id, project_slug in _load_test_project_entries():
        project_data = load_project(project_slug)
        if not project_data:
            continue
        project = ProjectInfo.from_dict(project_data)
        projects.append(
            {
                "name": project.name,
                "slug": project.slug,
                "sprite_id": sprite_id,
                "video_link": project.video_link,
                "thumbnail_link": project.thumbnail_link,
                "formatted_date": project.formatted_date,
            }
        )
    return projects


def _test_template_context(
    request: Request,
    initial_project_slug: str | None = None,
    initial_project_direct_entry: bool = False,
) -> dict:
    projects = _load_test_projects()
    slug_set = {project["slug"] for project in projects}
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
async def test_page(request: Request):
    """Render the shared-canvas point cloud depth test page."""
    return templates.TemplateResponse(
        "test.html",
        _test_template_context(request),
    )


@router.get("/test/{project_slug}", response_class=HTMLResponse)
async def test_project_page(request: Request, project_slug: str):
    """Render /test with a project opened directly from URL."""
    return templates.TemplateResponse(
        "test.html",
        _test_template_context(
            request,
            initial_project_slug=project_slug,
            initial_project_direct_entry=True,
        ),
    )

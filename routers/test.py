"""Test route for exploring point cloud rendering from RGBD sprite sheets."""

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from config import templates
from utils.content import ProjectInfo, load_project

TEST_SPRITE_SLUG_MAP = [
    ("somewhere-in-space", "somewhere-in-space"),
    ("gravity", "secretmap-x-gravity"),
    ("lead-me-home", "lead-me-home"),
    ("surf", "surf"),
]

router = APIRouter()


def _is_localhost(request: Request) -> bool:
    """Check if request is from localhost by TCP peer address."""
    client_host = request.client.host if request.client else None
    return client_host in ("127.0.0.1", "::1")


def _load_test_projects() -> list[dict]:
    """Load projects that currently have RGBD sprite assets for /test."""
    projects = []
    for sprite_id, project_slug in TEST_SPRITE_SLUG_MAP:
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


@router.get("/test", response_class=HTMLResponse)
async def test_page(request: Request):
    """Render the shared-canvas point cloud depth test page."""
    return templates.TemplateResponse(
        "test.html",
        {
            "request": request,
            "projects": _load_test_projects(),
            "page_title": "Point Cloud Shared Renderer Test",
            "page_meta_description": "Testing shared-canvas point cloud rendering from RGBD sprite sheets",
            "project_url_sync": False,
            "is_dev_mode": _is_localhost(request),
        },
    )

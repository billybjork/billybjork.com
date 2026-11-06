from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import HTMLResponse

from client_address import peer_is_loopback
from cms.projects import ProjectInfo, load_project
from templating import build_templates

_HERE = Path(__file__).parent
_PROJECTS_FILE = _HERE / "projects.json"
_SPRITES_DIR = _HERE / "static" / "rgbd-sprites"

_templates = build_templates(_HERE / "templates")

router = APIRouter()


@dataclass(frozen=True)
class _PointCloudProject:
    project: ProjectInfo
    sprite_id: str
    stage_aspect_ratio: float


def _load_projects() -> list[_PointCloudProject]:
    projects = []
    for entry in json.loads(_PROJECTS_FILE.read_text(encoding="utf-8"))["projects"]:
        project = load_project(entry["slug"])
        if not project:
            continue
        sprite_id = entry["sprite_id"]
        metadata = json.loads((_SPRITES_DIR / sprite_id / "metadata.json").read_text(encoding="utf-8"))
        projects.append(
            _PointCloudProject(
                project=project,
                sprite_id=sprite_id,
                stage_aspect_ratio=project.video.aspect_ratio or metadata["aspect_ratio"],
            )
        )
    return projects


def _render(request: Request, initial_slug: str | None) -> HTMLResponse:
    projects = _load_projects()
    if initial_slug and initial_slug not in {entry.project.slug for entry in projects}:
        raise HTTPException(status_code=404, detail="Project not found in /test")

    return _templates.TemplateResponse(
        request,
        "test.html",
        {
            "projects": projects,
            "page_title": "Point Cloud Shared Renderer Test",
            "page_meta_description": "Testing shared-canvas point cloud rendering from RGBD sprite sheets",
            "is_dev_mode": peer_is_loopback(request),
            "initial_project_slug": initial_slug,
        },
    )


@router.get("/test", response_class=HTMLResponse)
async def test_page(request: Request, project: str | None = Query(None)):
    return _render(request, (project or "").strip() or None)


@router.get("/test/{project_slug}", response_class=HTMLResponse)
async def test_project_page(request: Request, project_slug: str):
    return _render(request, project_slug)

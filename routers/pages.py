from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from analytics import get_project_stats, record_view
from client_address import client_ip
from cms.about import load_about
from cms.projects import ProjectCard, load_all_projects, load_project
from cms.site_settings import load_site_settings
from edit_auth import is_edit_mode
from templating import templates

logger = logging.getLogger(__name__)

router = APIRouter()


def _is_partial_request(request: Request) -> bool:
    """The homepage fetches project details as fragments with `_partial`; /test uses the header."""
    return request.query_params.get("_partial") == "1" or (
        request.headers.get("X-Requested-With") == "XMLHttpRequest"
    )


def _homepage_cards(drafts_only: bool) -> list[ProjectCard]:
    projects = load_all_projects(include_drafts=drafts_only)
    if drafts_only:
        projects = [project for project in projects if project.is_draft]
    return [project.to_card() for project in projects]


def _page_context(request: Request) -> dict:
    site = load_site_settings()
    return {
        "site": site,
        "is_dev_mode": is_edit_mode(request),
        "og_image_link": site.about_photo_link,
    }


def _render_homepage(request: Request, show_drafts: bool, **context) -> HTMLResponse:
    page = _page_context(request)
    page.update((key, value) for key, value in context.items() if value)
    page["projects"] = _homepage_cards(show_drafts and page["is_dev_mode"])
    return templates.TemplateResponse(request, "index.html", page)


@router.get("/", response_class=HTMLResponse)
async def read_root(request: Request, show_drafts: bool = Query(False)):
    return _render_homepage(request, show_drafts)


@router.get("/home", include_in_schema=False)
async def redirect_home():
    return RedirectResponse(url="/")


@router.get("/about", include_in_schema=False)
async def redirect_about():
    return RedirectResponse(url="/me", status_code=301)


@router.get("/me", response_class=HTMLResponse)
async def read_about(request: Request):
    return templates.TemplateResponse(
        request,
        "about.html",
        {
            **_page_context(request),
            "about_content": load_about().html,
            "page_title": "About",
            "page_meta_description": "Learn more about Billy Bjork and his work.",
        },
    )


@router.get("/{project_slug}", response_class=HTMLResponse)
async def read_project(
    request: Request,
    background_tasks: BackgroundTasks,
    project_slug: str,
    show_drafts: bool = Query(False),
):
    project = load_project(project_slug)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not _is_partial_request(request):
        return _render_homepage(
            request,
            show_drafts,
            page_title=project.name,
            page_meta_description=project.meta_description,
            og_image_link=project.og_image_link,
        )

    # Views count on the fragment only: opening a project, including by direct
    # entry, always fetches it, so counting full pages too would double-count.
    background_tasks.add_task(
        record_view,
        project_slug,
        client_ip(request),
        request.headers.get("user-agent"),
        request.headers.get("referer"),
    )

    stats = None
    if is_edit_mode(request):
        try:
            stats = await asyncio.to_thread(get_project_stats, project_slug)
        except Exception:
            logger.warning("Failed to load analytics for %s", project_slug, exc_info=True)

    return templates.TemplateResponse(
        request, "project_details.html", {"project": project, "analytics": stats}
    )

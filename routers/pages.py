from __future__ import annotations

import asyncio
import logging
from datetime import datetime

from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response

from config import templates
from dependencies import get_general_info, is_edit_mode
from utils.analytics import get_project_stats, record_view
from utils.content import (
    ProjectCardInfo,
    load_about,
    load_all_project_info,
    load_project_info,
)

router = APIRouter()


def is_partial_request(request: Request) -> bool:
    """Return True when the request is expected to receive HTML fragments only."""
    partial = request.query_params.get("_partial", "").strip().lower()
    if partial in {"1", "true", "yes", "on"}:
        return True
    return request.headers.get("X-Requested-With") == "XMLHttpRequest"


def extract_meta_description(html_content: str, word_limit: int = 25) -> str:
    """Extract the first `word_limit` words from HTML content for meta description."""
    if not html_content:
        return ""

    soup = BeautifulSoup(html_content, "lxml")
    text = soup.get_text(separator=" ", strip=True)
    words = text.split()
    snippet = " ".join(words[:word_limit])

    if len(words) > word_limit:
        snippet += "..."

    return snippet


def resolve_homepage_projects(show_drafts_only: bool) -> list[ProjectCardInfo]:
    if show_drafts_only:
        projects = [
            project
            for project in load_all_project_info(
                include_drafts=True,
                include_html=False,
                include_revision=False,
            )
            if project.is_draft
        ]
    else:
        projects = load_all_project_info(
            include_drafts=False,
            include_html=False,
            include_revision=False,
        )

    return [project.to_card() for project in projects]


def build_homepage_context(
    request: Request,
    *,
    projects: list[ProjectCardInfo],
    is_dev_mode: bool,
    general_info,
    page_title: str | None = None,
    page_meta_description: str | None = None,
    og_image_link: str | None = None,
) -> dict:
    return {
        "request": request,
        "projects": projects,
        "current_year": datetime.now().year,
        "general_info": general_info,
        "is_dev_mode": is_dev_mode,
        "page_title": page_title,
        "page_meta_description": page_meta_description,
        "og_image_link": og_image_link or general_info.about_photo_link,
    }


@router.get("/", response_class=HTMLResponse)
async def read_root(
    request: Request,
    show_drafts: bool = Query(False),
):
    try:
        is_dev_mode = is_edit_mode(request)
        show_drafts_only = show_drafts and is_dev_mode
        formatted_projects = resolve_homepage_projects(show_drafts_only)
        general_info = get_general_info()

        return templates.TemplateResponse(
            request,
            "index.html",
            build_homepage_context(
                request,
                projects=formatted_projects,
                is_dev_mode=is_dev_mode,
                general_info=general_info,
                og_image_link=general_info.about_photo_link,
            ),
        )
    except Exception:
        logger.exception("Error in read_root")
        raise HTTPException(status_code=500, detail="Internal Server Error")


@router.get("/home", include_in_schema=False)
async def redirect_home():
    return RedirectResponse(url="/")


@router.get("/about", include_in_schema=False)
async def redirect_about():
    return RedirectResponse(url="/me", status_code=301)


@router.get("/me", response_class=HTMLResponse)
async def read_about(request: Request):
    general_info = get_general_info()
    about_html, _, _ = load_about()
    is_dev_mode = is_edit_mode(request)

    return templates.TemplateResponse(
        request,
        "about.html",
        {
            "current_year": datetime.now().year,
            "about_content": about_html,
            "about_photo_link": general_info.about_photo_link,
            "about_photo_srcset": general_info.about_photo_srcset,
            "about_photo_sizes": general_info.about_photo_sizes,
            "general_info": general_info,
            "is_dev_mode": is_dev_mode,
            "page_title": "About",
            "page_meta_description": "Learn more about Billy Bjork and his work.",
            "og_image_link": general_info.about_photo_link,
            "load_project_bundle": False,
        },
    )


@router.get("/{project_slug}", response_class=HTMLResponse)
async def read_project(
    request: Request,
    background_tasks: BackgroundTasks,
    project_slug: str,
    close: bool = False,
    show_drafts: bool = Query(False),
):
    try:
        project = load_project_info(project_slug, include_revision=False)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        general_info = get_general_info()
        is_open = not close
        is_dev_mode = is_edit_mode(request)
        meta_description = extract_meta_description(project.html_content)
        show_drafts_only = show_drafts and is_dev_mode
        is_partial = is_partial_request(request)

        if is_partial and not is_open:
            return Response(content="", status_code=200)

        # Record page view (analytics never breaks the site).
        # The new shared-element homepage fetches project details via partials,
        # so we only record views on the partial/detail response path to avoid
        # double-counting direct-entry page loads.
        if is_open and is_partial:
            try:
                forwarded = request.headers.get("x-forwarded-for", "")
                client_ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "unknown")
                ua = request.headers.get("user-agent")
                ref = request.headers.get("referer")
                background_tasks.add_task(record_view, project_slug, client_ip, ua, ref)
            except Exception:
                logger.warning("Failed to enqueue analytics page view for %s", project_slug, exc_info=True)

        # Fetch stats only on localhost
        analytics = None
        if is_open and is_partial and is_dev_mode:
            try:
                analytics = await asyncio.to_thread(get_project_stats, project_slug)
            except Exception:
                logger.warning("Failed to load local analytics for %s", project_slug, exc_info=True)

        if is_partial:
            return templates.TemplateResponse(
                request,
                "project_details.html",
                {
                    "project": project,
                    "is_open": is_open,
                    "meta_description": meta_description,
                    "analytics": analytics,
                },
            )

        homepage_projects = resolve_homepage_projects(show_drafts_only)
        return templates.TemplateResponse(
            request,
            "index.html",
            build_homepage_context(
                request,
                projects=homepage_projects,
                is_dev_mode=is_dev_mode,
                general_info=general_info,
                page_title=project.name,
                page_meta_description=meta_description,
                og_image_link=project.og_image_link,
            ),
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Unexpected error in read_project")
        raise HTTPException(status_code=500, detail="Internal Server Error")

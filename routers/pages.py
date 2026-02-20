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
from utils.content import load_about, load_all_projects, load_project, ProjectInfo

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


def format_project_for_template(project: ProjectInfo, is_open: bool = False) -> dict:
    """Format a ProjectInfo object for template rendering."""
    return {
        "id": project.id,
        "name": project.name,
        "slug": project.slug,
        "sprite_sheet_link": project.sprite_sheet_link,
        "video_link": project.video_link,
        "thumbnail_link": project.thumbnail_link,
        "youtube_link": project.youtube_link,
        "formatted_date": project.formatted_date,
        "pinned": project.pinned,
        "is_open": is_open,
        "is_draft": project.is_draft,
    }


@router.get("/", response_class=HTMLResponse)
async def read_root(
    request: Request,
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=100),
    show_drafts: bool = Query(False),
):
    try:
        is_dev_mode = is_edit_mode(request)
        show_drafts_only = show_drafts and is_dev_mode
        if show_drafts_only:
            all_projects = [
                project
                for project in load_all_projects(include_drafts=True)
                if project.get("is_draft", False)
            ]
        else:
            all_projects = load_all_projects(include_drafts=False)

        start_idx = (page - 1) * limit
        end_idx = start_idx + limit
        projects = all_projects[start_idx:end_idx]

        formatted_projects = [
            format_project_for_template(ProjectInfo.from_dict(proj_data))
            for proj_data in projects
        ]

        has_more = end_idx < len(all_projects)
        general_info = get_general_info()

        if is_partial_request(request):
            return templates.TemplateResponse(
                "projects_infinite_scroll.html",
                {
                    "request": request,
                    "projects": formatted_projects,
                    "page": page,
                    "has_more": has_more,
                    "show_drafts": show_drafts_only,
                },
            )

        return templates.TemplateResponse(
            "index.html",
            {
                "request": request,
                "projects": formatted_projects,
                "current_year": datetime.now().year,
                "general_info": general_info,
                "is_dev_mode": is_dev_mode,
                "page": page,
                "has_more": has_more,
                "limit": limit,
                "show_drafts": show_drafts_only,
            },
        )
    except Exception as e:
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
        "about.html",
        {
            "request": request,
            "current_year": datetime.now().year,
            "about_content": about_html,
            "about_photo_link": general_info.about_photo_link,
            "general_info": general_info,
            "is_dev_mode": is_dev_mode,
            "page_title": "About",
            "page_meta_description": "Learn more about Billy Bjork and his work.",
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
        project_data = load_project(project_slug)
        if not project_data:
            raise HTTPException(status_code=404, detail="Project not found")

        project = ProjectInfo.from_dict(project_data)
        general_info = get_general_info()
        is_open = not close
        is_dev_mode = is_edit_mode(request)
        meta_description = extract_meta_description(project.html_content)
        show_drafts_only = show_drafts and is_dev_mode
        is_partial = is_partial_request(request)

        if is_partial and not is_open:
            return Response(content="", status_code=200)

        # Record page view (analytics never breaks the site)
        if is_open:
            try:
                forwarded = request.headers.get("x-forwarded-for", "")
                client_ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "unknown")
                ua = request.headers.get("user-agent")
                ref = request.headers.get("referer")
                background_tasks.add_task(record_view, project_slug, client_ip, ua, ref)
            except Exception:
                pass

        # Fetch stats only on localhost
        analytics = None
        if is_open and is_dev_mode:
            try:
                analytics = await asyncio.to_thread(get_project_stats, project_slug)
            except Exception:
                pass

        if is_partial:
            return templates.TemplateResponse(
                "project_details.html",
                {
                    "request": request,
                    "project": project,
                    "is_open": is_open,
                    "meta_description": meta_description,
                    "analytics": analytics,
                },
            )

        formatted_project = format_project_for_template(project)
        formatted_project["html_content"] = project.html_content

        return templates.TemplateResponse(
            "index.html",
            {
                "request": request,
                "projects": [formatted_project],
                "open_project": project,
                "current_year": datetime.now().year,
                "general_info": general_info,
                "isolation_mode": True,
                "is_dev_mode": is_dev_mode,
                "page_title": project.name,
                "page_meta_description": meta_description,
                "analytics": analytics,
                "show_drafts": show_drafts_only,
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unexpected error in read_project")
        raise HTTPException(status_code=500, detail="Internal Server Error")

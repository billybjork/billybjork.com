from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from pathlib import PurePosixPath

from bs4 import BeautifulSoup
from botocore.exceptions import ClientError

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
from utils.object_storage import (
    get_bucket_name,
    get_object_storage_client,
    is_object_storage_configured,
)

router = APIRouter()
PUBLIC_MEDIA_PREFIXES = ("images/", "videos/", "videos_mp4/")


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


def _is_public_media_key(object_key: str) -> bool:
    if not object_key:
        return False

    normalized = object_key.strip().lstrip("/")
    if not normalized:
        return False

    pure = PurePosixPath(normalized)
    if pure.is_absolute() or any(part in {"", ".", ".."} for part in pure.parts):
        return False

    return normalized.startswith(PUBLIC_MEDIA_PREFIXES)


def _fetch_media_object(object_key: str, range_header: str | None) -> tuple[bytes, dict[str, str], int]:
    client = get_object_storage_client()
    params: dict[str, str] = {
        "Bucket": get_bucket_name(),
        "Key": object_key,
    }
    if range_header:
        params["Range"] = range_header

    response = client.get_object(**params)
    body = response["Body"].read()

    headers = {
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
    }

    content_type = response.get("ContentType")
    if content_type:
        headers["Content-Type"] = content_type

    cache_control = response.get("CacheControl")
    if cache_control:
        headers["Cache-Control"] = cache_control

    etag = response.get("ETag")
    if etag:
        headers["ETag"] = etag

    last_modified = response.get("LastModified")
    if last_modified:
        headers["Last-Modified"] = last_modified.strftime("%a, %d %b %Y %H:%M:%S GMT")

    content_range = response.get("ContentRange")
    if content_range:
        headers["Content-Range"] = content_range

    content_length = response.get("ContentLength")
    if content_length is not None:
        headers["Content-Length"] = str(content_length)

    status_code = 206 if content_range else 200
    return body, headers, status_code


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


@router.get("/media/{object_key:path}", include_in_schema=False)
async def get_media_asset(request: Request, object_key: str):
    normalized_key = object_key.strip().lstrip("/")
    if not _is_public_media_key(normalized_key):
        raise HTTPException(status_code=404, detail="Asset not found")

    if not is_object_storage_configured():
        raise HTTPException(status_code=503, detail="Object storage is not configured")

    range_header = request.headers.get("range")

    try:
        body, headers, status_code = await asyncio.to_thread(
            _fetch_media_object,
            normalized_key,
            range_header,
        )
    except ClientError as exc:
        error_code = str(exc.response.get("Error", {}).get("Code", ""))
        if error_code in {"404", "NoSuchKey", "NotFound"}:
            raise HTTPException(status_code=404, detail="Asset not found") from exc
        if error_code in {"InvalidRange", "416"}:
            raise HTTPException(status_code=416, detail="Invalid range") from exc
        logger.warning("Failed to fetch object-storage asset %s", normalized_key, exc_info=True)
        raise HTTPException(status_code=502, detail="Asset fetch failed") from exc
    except Exception as exc:
        logger.warning("Unexpected media fetch error for %s", normalized_key, exc_info=True)
        raise HTTPException(status_code=502, detail="Asset fetch failed") from exc

    return Response(content=body, status_code=status_code, headers=headers)


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

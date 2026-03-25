from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.gzip import GZipMiddleware
from starlette.status import HTTP_404_NOT_FOUND, HTTP_500_INTERNAL_SERVER_ERROR

from config import AppSettings, get_app_settings, templates
from middleware.cache_control import CacheControlMiddleware
from middleware.forwarded_proto import ForwardedProtoMiddleware
from middleware.security_headers import SecurityHeadersMiddleware
from routers import admin, auth, feed, pages, test, valentine
from utils.analytics import init_db, reset_db_path, set_db_path
from utils.content import reset_content_paths, set_content_paths

logger = logging.getLogger(__name__)


def _run_startup_content_sync(settings: AppSettings) -> None:
    from utils.content_sync import sync_from_s3

    policy = settings.resolved_startup_content_sync_policy()

    if policy in {"off", "disabled", "none"}:
        logger.info(
            "Startup: content sync from S3 disabled by CONTENT_STARTUP_SYNC_POLICY=%s",
            policy,
        )
        return

    if policy == "legacy":
        logger.warning(
            "CONTENT_STARTUP_SYNC_POLICY=legacy is deprecated; use 'always' or 'guarded'."
        )

    require_marker = policy not in {"always", "legacy"}
    count = sync_from_s3(require_marker=require_marker)
    if count:
        logger.info("Startup: synced %d content file(s) from S3", count)


async def _run_temp_video_cleanup_loop(interval_seconds: int) -> None:
    while True:
        await asyncio.to_thread(admin.cleanup_old_temp_videos)
        await asyncio.sleep(interval_seconds)


@asynccontextmanager
async def app_lifespan(app: FastAPI):
    settings = get_app_settings(app=app)
    cleanup_task: asyncio.Task[None] | None = None

    if settings.load_dotenv_on_startup:
        load_dotenv()

    set_content_paths(settings.content_paths)
    set_db_path(settings.analytics_db_path)

    try:
        if settings.init_analytics_db_on_startup:
            init_db()

        if settings.run_startup_content_sync_on_startup:
            try:
                _run_startup_content_sync(settings)
            except Exception:
                logger.exception("Startup S3 content sync failed (using local files)")

        if settings.run_temp_video_cleanup_on_startup:
            await asyncio.to_thread(admin.cleanup_old_temp_videos)

        if settings.start_temp_video_cleanup_loop_on_startup:
            cleanup_task = asyncio.create_task(
                _run_temp_video_cleanup_loop(
                    settings.resolved_temp_video_cleanup_interval_seconds()
                )
            )
            app.state.temp_cleanup_task = cleanup_task

        yield
    finally:
        cleanup_task = cleanup_task or getattr(app.state, "temp_cleanup_task", None)
        if cleanup_task is not None:
            cleanup_task.cancel()
            with suppress(asyncio.CancelledError):
                await cleanup_task
        reset_db_path()
        reset_content_paths()


async def http_exception_handler(
    request: Request,
    exc: StarletteHTTPException,
):
    if exc.status_code == HTTP_404_NOT_FOUND:
        return templates.TemplateResponse(
            request,
            "404.html",
            {"load_project_bundle": False},
            status_code=HTTP_404_NOT_FOUND,
        )
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


async def server_error_handler(request: Request, exc: Exception):
    return templates.TemplateResponse(
        request,
        "500.html",
        {"load_project_bundle": False},
        status_code=HTTP_500_INTERNAL_SERVER_ERROR,
    )


def create_app(settings: AppSettings | None = None) -> FastAPI:
    app_settings = settings or AppSettings()
    app = FastAPI(lifespan=app_lifespan)
    app.state.settings = app_settings

    app.add_middleware(ForwardedProtoMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(GZipMiddleware, minimum_size=500)
    app.add_middleware(
        CacheControlMiddleware,
        static_cache_control="public, max-age=31536000, immutable",
        page_cache_control="public, max-age=300, stale-while-revalidate=60",
    )
    app.mount("/static", StaticFiles(directory=str(app_settings.static_dir)), name="static")

    app.include_router(auth.router)
    app.include_router(admin.router)
    app.include_router(feed.router)
    app.include_router(test.router)
    app.include_router(valentine.router)
    app.include_router(pages.router)

    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(500, server_error_handler)
    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    load_dotenv()
    settings = AppSettings()
    uvicorn.run(
        "main:create_app",
        factory=True,
        host="0.0.0.0",
        port=settings.resolved_app_port(),
    )

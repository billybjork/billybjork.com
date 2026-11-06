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

import analytics
from cms import sync as content_sync
from cms.paths import set_content_paths
from config import SRC_DIR, AppSettings
from experiments import point_cloud
from media import hero_sessions
from middleware.cache_control import CacheControlMiddleware
from middleware.forwarded_proto import ForwardedProtoMiddleware
from middleware.security_headers import SecurityHeadersMiddleware
from routers import admin, admin_media, auth, feed, media as media_router, pages, valentine
from templating import templates

logger = logging.getLogger(__name__)


@asynccontextmanager
async def app_lifespan(app: FastAPI):
    settings: AppSettings = app.state.settings
    set_content_paths(settings.content_paths)
    analytics.set_db_path(settings.analytics_db_path)
    analytics.init_db()

    try:
        content_sync.run_startup_sync(settings.startup_content_sync_policy)
    except Exception:
        logger.exception("Startup object-storage content sync failed (using local files)")

    cleanup_task = asyncio.create_task(hero_sessions.run_cleanup_loop())
    try:
        yield
    finally:
        cleanup_task.cancel()
        with suppress(asyncio.CancelledError):
            await cleanup_task


async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    if exc.status_code == HTTP_404_NOT_FOUND:
        return templates.TemplateResponse(request, "404.html", status_code=HTTP_404_NOT_FOUND)
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


async def server_error_handler(request: Request, exc: Exception):
    return templates.TemplateResponse(
        request, "500.html", status_code=HTTP_500_INTERNAL_SERVER_ERROR
    )


def create_app(settings: AppSettings | None = None) -> FastAPI:
    if settings is None:
        load_dotenv()
        settings = AppSettings.from_env()

    app = FastAPI(lifespan=app_lifespan)
    app.state.settings = settings

    app.add_middleware(ForwardedProtoMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(GZipMiddleware, minimum_size=500)
    app.add_middleware(CacheControlMiddleware)

    point_cloud.install(app)
    app.mount("/static", StaticFiles(directory=SRC_DIR / "static"), name="static")

    app.include_router(auth.router)
    app.include_router(admin.router)
    app.include_router(admin_media.router)
    app.include_router(media_router.router)
    app.include_router(feed.router)
    app.include_router(valentine.router)
    app.include_router(pages.router)

    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(500, server_error_handler)
    return app

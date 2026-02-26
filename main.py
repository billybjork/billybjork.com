import asyncio
import logging
import os
from contextlib import suppress

from dotenv import load_dotenv
from fastapi import Request
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.status import HTTP_404_NOT_FOUND, HTTP_500_INTERNAL_SERVER_ERROR

from config import templates
from middleware.cache_control import CacheControlMiddleware
from middleware.forwarded_proto import ForwardedProtoMiddleware
from middleware.security_headers import SecurityHeadersMiddleware
from routers import admin, auth, feed, pages, test, valentine
from utils.analytics import init_db

logger = logging.getLogger(__name__)
TEMP_VIDEO_CLEANUP_INTERVAL_SECONDS = int(
    os.environ.get("TEMP_VIDEO_CLEANUP_INTERVAL_SECONDS", "900")
)

load_dotenv()

init_db()

# Sync content from S3 on startup (remote edits survive redeployments)
if os.environ.get("EDIT_TOKEN"):
    try:
        from utils.content_sync import sync_from_s3
        policy = os.environ.get("CONTENT_STARTUP_SYNC_POLICY", "guarded").strip().lower()

        if policy in {"off", "disabled", "none"}:
            logger.info("Startup: content sync from S3 disabled by CONTENT_STARTUP_SYNC_POLICY=%s", policy)
        else:
            if policy == "legacy":
                logger.warning(
                    "CONTENT_STARTUP_SYNC_POLICY=legacy is deprecated; use 'always' or 'guarded'."
                )
            require_marker = policy not in {"always", "legacy"}
            count = sync_from_s3(require_marker=require_marker)
            if count:
                logger.info("Startup: synced %d content file(s) from S3", count)
    except Exception:
        logger.exception("Startup S3 content sync failed (using local files)")

app = FastAPI()
app.add_middleware(ForwardedProtoMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=500)
app.add_middleware(
    CacheControlMiddleware,
    static_cache_control="public, max-age=31536000, immutable",
    page_cache_control="public, max-age=300, stale-while-revalidate=60",
)
app.mount("/static", StaticFiles(directory="static"), name="static")

# Include routers
app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(feed.router)
app.include_router(test.router)
app.include_router(valentine.router)
app.include_router(pages.router)


@app.on_event("startup")
async def start_background_cleanup_loop() -> None:
    async def cleanup_loop() -> None:
        while True:
            await asyncio.to_thread(admin.cleanup_old_temp_videos)
            await asyncio.sleep(TEMP_VIDEO_CLEANUP_INTERVAL_SECONDS)

    app.state.temp_cleanup_task = asyncio.create_task(cleanup_loop())


@app.on_event("shutdown")
async def stop_background_cleanup_loop() -> None:
    cleanup_task = getattr(app.state, "temp_cleanup_task", None)
    if cleanup_task is None:
        return
    cleanup_task.cancel()
    with suppress(asyncio.CancelledError):
        await cleanup_task


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    if exc.status_code == HTTP_404_NOT_FOUND:
        return templates.TemplateResponse(
            "404.html",
            {"request": request, "load_project_bundle": False},
            status_code=HTTP_404_NOT_FOUND,
        )
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(500)
async def server_error_handler(request: Request, exc: Exception):
    return templates.TemplateResponse(
        "500.html",
        {"request": request, "load_project_bundle": False},
        status_code=HTTP_500_INTERNAL_SERVER_ERROR,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)

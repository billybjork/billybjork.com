import logging
import os

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
from routers import admin, api, auth, feed, pages, test, valentine
from utils.analytics import init_db

logger = logging.getLogger(__name__)

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
app.include_router(api.router)
app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(feed.router)
app.include_router(test.router)
app.include_router(valentine.router)
app.include_router(pages.router)


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    if exc.status_code == HTTP_404_NOT_FOUND:
        return templates.TemplateResponse(
            "404.html", {"request": request}, status_code=HTTP_404_NOT_FOUND
        )
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(500)
async def server_error_handler(request: Request, exc: Exception):
    return templates.TemplateResponse(
        "500.html", {"request": request}, status_code=HTTP_500_INTERNAL_SERVER_ERROR
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)

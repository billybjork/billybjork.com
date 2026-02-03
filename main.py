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
from routers import admin, api, feed, pages
from utils.analytics import init_db

load_dotenv()

init_db()

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
app.include_router(admin.router)
app.include_router(feed.router)
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

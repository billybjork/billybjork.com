from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware

from client_address import peer_is_loopback

STATIC_CACHE_CONTROL = "public, max-age=31536000, immutable"
PAGE_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=60"


class CacheControlMiddleware(BaseHTTPMiddleware):
    """Cache headers for static assets and pages; localhost and the API are never cached."""

    async def dispatch(self, request, call_next):
        response = await call_next(request)

        if (
            request.method not in {"GET", "HEAD"}
            or response.status_code not in {200, 304}
            or response.headers.get("Cache-Control")
            or peer_is_loopback(request)
            or request.url.path.startswith("/api/")
        ):
            return response

        if request.url.path.startswith("/static/"):
            response.headers["Cache-Control"] = STATIC_CACHE_CONTROL
            return response

        content_type = response.headers.get("content-type", "")
        if content_type.startswith(("text/html", "application/rss+xml")):
            response.headers["Cache-Control"] = PAGE_CACHE_CONTROL
        return response

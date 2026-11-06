from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware

from client_address import peer_is_loopback
from edit_auth import is_edit_mode

STATIC_CACHE_CONTROL = "public, max-age=31536000, immutable"
PAGE_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=60"
EDITOR_PAGE_CACHE_CONTROL = "private, no-store"


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
            if is_edit_mode(request):
                response.headers["Cache-Control"] = EDITOR_PAGE_CACHE_CONTROL
            else:
                # Logging in must not reuse the logged-out copy of a page.
                response.headers["Cache-Control"] = PAGE_CACHE_CONTROL
                response.headers.add_vary_header("Cookie")
        return response

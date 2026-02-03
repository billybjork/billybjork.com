from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware


class CacheControlMiddleware(BaseHTTPMiddleware):
    """Add cache headers for static assets and page responses."""

    def __init__(
        self,
        app,
        *,
        static_cache_control: str,
        page_cache_control: str,
    ) -> None:
        super().__init__(app)
        self.static_cache_control = static_cache_control
        self.page_cache_control = page_cache_control

    @staticmethod
    def _is_localhost(request) -> bool:
        client_host = request.client.host if request.client else None
        return client_host in ("127.0.0.1", "::1")

    async def dispatch(self, request, call_next):
        response = await call_next(request)

        if request.method not in {"GET", "HEAD"}:
            return response

        if response.status_code not in {200, 304}:
            return response

        if response.headers.get("Cache-Control"):
            return response

        if self._is_localhost(request):
            return response

        path = request.url.path
        if path.startswith("/api/"):
            return response

        if path.startswith("/static/"):
            response.headers["Cache-Control"] = self.static_cache_control
            return response

        content_type = response.headers.get("content-type", "")
        if content_type.startswith("text/html") or content_type.startswith(
            "application/rss+xml"
        ):
            response.headers["Cache-Control"] = self.page_cache_control

        return response

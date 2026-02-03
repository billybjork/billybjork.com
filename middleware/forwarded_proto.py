from starlette.middleware.base import BaseHTTPMiddleware


class ForwardedProtoMiddleware(BaseHTTPMiddleware):
    """Handle X-Forwarded-Proto header for proper scheme detection behind proxies."""

    async def dispatch(self, request, call_next):
        x_forwarded_proto = request.headers.get("x-forwarded-proto")
        if x_forwarded_proto in ("http", "https"):
            request.scope["scheme"] = x_forwarded_proto
        response = await call_next(request)
        return response

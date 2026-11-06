"""What a request says about the client on the other end of the connection."""
from __future__ import annotations

import ipaddress

from starlette.requests import Request


def _is_loopback(value: str | None) -> bool:
    if not value:
        return False
    candidate = value.strip().strip('"').strip("[]")
    if candidate.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(candidate).is_loopback
    except ValueError:
        return False


def _forwarded_for(request: Request) -> str:
    return request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()


def peer_is_loopback(request: Request) -> bool:
    """The TCP peer is this machine. A proxy on this machine also counts."""
    return _is_loopback(request.client.host if request.client else None)


def is_local_client(request: Request) -> bool:
    """The original client is this machine: proxied remote traffic never qualifies."""
    if not peer_is_loopback(request):
        return False
    forwarded = _forwarded_for(request)
    if forwarded and not _is_loopback(forwarded):
        return False
    real_ip = request.headers.get("x-real-ip")
    return not (real_ip and not _is_loopback(real_ip))


def client_ip(request: Request) -> str:
    return _forwarded_for(request) or (request.client.host if request.client else "unknown")

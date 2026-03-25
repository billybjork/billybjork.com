"""
Authentication and dependency injection for the CMS.

Edit mode access is granted to:
  1. Localhost requests (when localhost bypass is enabled)
  2. Remote requests with a valid signed session cookie (when EDIT_TOKEN is set)

When EDIT_TOKEN is not set, remote edit mode is completely disabled
and the system behaves exactly as before (localhost-only).
"""
import hashlib
import hmac
import ipaddress
from typing import Optional

from fastapi import HTTPException, Request

from config import AuthSettings, get_app_settings, load_auth_settings
from utils.content import GeneralInfo, load_site_settings


def get_auth_settings(request: Request | None = None) -> AuthSettings:
    if request is not None:
        settings = get_app_settings(request=request)
        return settings.resolved_auth()
    return load_auth_settings()


def sign_cookie(payload: str, auth_settings: AuthSettings | None = None) -> str:
    """HMAC-SHA256 sign a payload string."""
    auth = auth_settings or load_auth_settings()
    sig = hmac.new(
        auth.cookie_secret.encode(),
        payload.encode(),
        hashlib.sha256,
    ).hexdigest()
    return f"{payload}.{sig}"


def verify_cookie(
    signed: str,
    auth_settings: AuthSettings | None = None,
) -> Optional[str]:
    """Verify an HMAC-signed cookie. Returns payload or None."""
    auth = auth_settings or load_auth_settings()
    if "." not in signed or not auth.cookie_secret:
        return None
    payload, sig = signed.rsplit(".", 1)
    expected = hmac.new(
        auth.cookie_secret.encode(),
        payload.encode(),
        hashlib.sha256,
    ).hexdigest()
    if hmac.compare_digest(sig, expected):
        return payload
    return None


def _is_localhost(request: Request) -> bool:
    """Check whether request should be treated as localhost."""

    def _is_loopback(value: Optional[str]) -> bool:
        if not value:
            return False

        candidate = value.strip().strip('"').strip("[]")
        if candidate.lower() == "localhost":
            return True

        try:
            return ipaddress.ip_address(candidate).is_loopback
        except ValueError:
            return False

    client_host = request.client.host if request.client else None
    if not _is_loopback(client_host):
        return False

    # If proxy headers are present, trust the original client IP over loopback
    # so proxied remote traffic is never granted localhost bypass.
    xff = request.headers.get("x-forwarded-for")
    if xff:
        original_ip = xff.split(",", 1)[0].strip()
        if not _is_loopback(original_ip):
            return False

    x_real_ip = request.headers.get("x-real-ip")
    if x_real_ip and not _is_loopback(x_real_ip):
        return False

    return True


def is_edit_mode(request: Request) -> bool:
    """Return True if the request is from an authenticated editor."""
    auth = get_auth_settings(request)

    if auth.localhost_bypass_enabled and _is_localhost(request):
        return True

    if not auth.edit_token or not auth.cookie_secret:
        return False

    cookie = request.cookies.get(auth.cookie_name)
    if not cookie:
        return False

    return verify_cookie(cookie, auth) == "editor"


def require_edit_mode(request: Request) -> None:
    """FastAPI dependency that gates admin/edit endpoints."""
    if not is_edit_mode(request):
        raise HTTPException(status_code=403, detail="Not authorized")


def get_general_info() -> GeneralInfo:
    """Load general info as a compatibility object."""
    settings = load_site_settings()
    return GeneralInfo.from_site_settings(settings)

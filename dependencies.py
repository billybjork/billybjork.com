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
import os
from typing import Optional

from fastapi import HTTPException, Request

from utils.content import GeneralInfo, load_settings

# ── configuration ──────────────────────────────────────────────────
EDIT_TOKEN: Optional[str] = os.environ.get("EDIT_TOKEN")
COOKIE_SECRET: str = os.environ.get("COOKIE_SECRET", EDIT_TOKEN or "")
COOKIE_NAME = "bb_edit"
COOKIE_MAX_AGE = 60 * 60 * 24 * 30  # 30 days
LOCALHOST_BYPASS_ENV = os.environ.get("LOCALHOST_EDIT_BYPASS")


def _env_flag(value: Optional[str], default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


# Security default:
# - Local-only mode (no EDIT_TOKEN): localhost bypass enabled
# - Remote edit mode (EDIT_TOKEN set): bypass disabled unless explicitly enabled
LOCALHOST_BYPASS_ENABLED = _env_flag(
    LOCALHOST_BYPASS_ENV, default=not bool(EDIT_TOKEN)
)


# ── cookie signing ─────────────────────────────────────────────────
def sign_cookie(payload: str) -> str:
    """HMAC-SHA256 sign a payload string."""
    sig = hmac.new(
        COOKIE_SECRET.encode(), payload.encode(), hashlib.sha256
    ).hexdigest()
    return f"{payload}.{sig}"


def verify_cookie(signed: str) -> Optional[str]:
    """Verify an HMAC-signed cookie. Returns payload or None."""
    if "." not in signed:
        return None
    payload, sig = signed.rsplit(".", 1)
    expected = hmac.new(
        COOKIE_SECRET.encode(), payload.encode(), hashlib.sha256
    ).hexdigest()
    if hmac.compare_digest(sig, expected):
        return payload
    return None


# ── auth helpers ───────────────────────────────────────────────────
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
    """Return True if the request is from an authenticated editor.

    Localhost can have edit access when localhost bypass is enabled.
    Remote access requires a valid signed cookie, which
    is only issued when the user logs in with EDIT_TOKEN.
    """
    if LOCALHOST_BYPASS_ENABLED and _is_localhost(request):
        return True

    if not EDIT_TOKEN or not COOKIE_SECRET:
        return False

    cookie = request.cookies.get(COOKIE_NAME)
    if not cookie:
        return False

    return verify_cookie(cookie) == "editor"


def require_edit_mode(request: Request) -> None:
    """FastAPI dependency that gates admin/edit endpoints."""
    if not is_edit_mode(request):
        raise HTTPException(status_code=403, detail="Not authorized")


def get_general_info() -> GeneralInfo:
    """Load general info as a compatibility object."""
    settings = load_settings()
    return GeneralInfo.from_settings(settings)

"""
Authentication and dependency injection for the CMS.

Edit mode access is granted to:
  1. Localhost requests (TCP peer == 127.0.0.1 / ::1)  — always, no token needed
  2. Remote requests with a valid signed session cookie   — when EDIT_TOKEN is set

When EDIT_TOKEN is not set, remote edit mode is completely disabled
and the system behaves exactly as before (localhost-only).
"""
import hashlib
import hmac
import os
from typing import Optional

from fastapi import HTTPException, Request

from utils.content import GeneralInfo, load_settings

# ── configuration ──────────────────────────────────────────────────
EDIT_TOKEN: Optional[str] = os.environ.get("EDIT_TOKEN")
COOKIE_SECRET: str = os.environ.get("COOKIE_SECRET", EDIT_TOKEN or "")
COOKIE_NAME = "bb_edit"
COOKIE_MAX_AGE = 60 * 60 * 24 * 30  # 30 days


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
    """Check if the request originates from localhost (TCP peer address)."""
    client_host = request.client.host if request.client else None
    return client_host in ("127.0.0.1", "::1")


def is_edit_mode(request: Request) -> bool:
    """Return True if the request is from an authenticated editor.

    Localhost always has edit access (backwards compatible with existing
    dev workflow).  Remote access requires a valid signed cookie, which
    is only issued when the user logs in with EDIT_TOKEN.
    """
    if _is_localhost(request):
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


# ── kept for backwards compat (old name used in existing imports) ──
def require_dev_mode(request: Request) -> None:
    """Alias for require_edit_mode — kept so existing imports don't break."""
    require_edit_mode(request)


def get_general_info() -> GeneralInfo:
    """Load general info as a compatibility object."""
    settings = load_settings()
    return GeneralInfo.from_settings(settings)

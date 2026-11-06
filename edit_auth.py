"""
Who may edit. Access goes to localhost requests (when the bypass is enabled)
and to requests carrying the signed session cookie set by /edit/login. Without
EDIT_TOKEN, remote editing is off entirely.
"""
import hashlib
import hmac

from fastapi import HTTPException, Request

from client_address import is_local_client
from config import AuthSettings

COOKIE_NAME = "bb_edit"
COOKIE_MAX_AGE = 60 * 60 * 24 * 30
_EDITOR_PAYLOAD = "editor"


def auth_settings(request: Request) -> AuthSettings:
    return request.app.state.settings.auth


def _signature(payload: str, secret: str) -> str:
    return hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()


def editor_cookie_value(auth: AuthSettings) -> str:
    return f"{_EDITOR_PAYLOAD}.{_signature(_EDITOR_PAYLOAD, auth.cookie_secret)}"


def _has_editor_cookie(request: Request, auth: AuthSettings) -> bool:
    cookie = request.cookies.get(COOKIE_NAME)
    if not auth.edit_token or not auth.cookie_secret or not cookie or "." not in cookie:
        return False
    payload, signature = cookie.rsplit(".", 1)
    return payload == _EDITOR_PAYLOAD and hmac.compare_digest(
        signature, _signature(payload, auth.cookie_secret)
    )


def is_edit_mode(request: Request) -> bool:
    auth = auth_settings(request)
    if auth.localhost_bypass_enabled and is_local_client(request):
        return True
    return _has_editor_cookie(request, auth)


def require_edit_mode(request: Request) -> None:
    if not is_edit_mode(request):
        raise HTTPException(status_code=403, detail="Not authorized")

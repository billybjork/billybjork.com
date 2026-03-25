"""
Auth Router — minimal login/logout for remote edit mode.

GET  /edit/login   → renders a simple login form
POST /edit/login   → validates token, sets signed cookie, redirects
GET  /edit/logout  → clears cookie, redirects
"""
import logging

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from dependencies import (
    get_auth_settings,
    is_edit_mode,
    sign_cookie,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/edit", tags=["auth"])

LOGIN_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Edit Mode</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #111;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      color: #fff;
    }
    form {
      width: 100%;
      max-width: 320px;
      padding: 0 20px;
    }
    input {
      width: 100%;
      padding: 12px 16px;
      margin-bottom: 12px;
      border: 1px solid #333;
      border-radius: 8px;
      background: #1a1a1a;
      color: #fff;
      font-size: 16px;
      outline: none;
      transition: border-color 0.2s;
    }
    input:focus { border-color: #555; }
    button {
      width: 100%;
      padding: 12px;
      border: none;
      border-radius: 8px;
      background: #fff;
      color: #111;
      font-size: 16px;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    button:hover { opacity: 0.85; }
    .error {
      color: #ef4444;
      font-size: 14px;
      margin-bottom: 12px;
      text-align: center;
    }
  </style>
</head>
<body>
  <form method="POST" action="/edit/login">
    {error}
    <input type="password" name="token" placeholder="Edit token" autofocus autocomplete="current-password">
    <button type="submit">Enter</button>
  </form>
</body>
</html>"""


@router.get("/login", response_class=HTMLResponse)
async def login_page(request: Request, error: int = 0):
    """Render the login form. If already authenticated, redirect home."""
    auth_settings = get_auth_settings(request)
    if not auth_settings.edit_token:
        raise HTTPException(status_code=404)

    if is_edit_mode(request):
        return RedirectResponse("/", status_code=303)

    error_html = '<p class="error">Invalid token</p>' if error else ""
    return HTMLResponse(LOGIN_HTML.replace("{error}", error_html))


@router.post("/login")
async def login(request: Request):
    """Validate the edit token and set a signed session cookie."""
    auth_settings = get_auth_settings(request)
    if not auth_settings.edit_token:
        raise HTTPException(status_code=404)

    form = await request.form()
    token = form.get("token", "")

    if token != auth_settings.edit_token:
        return RedirectResponse("/edit/login?error=1", status_code=303)

    response = RedirectResponse("/", status_code=303)
    response.set_cookie(
        auth_settings.cookie_name,
        sign_cookie("editor", auth_settings),
        max_age=auth_settings.cookie_max_age,
        httponly=True,
        secure=(request.url.scheme == "https"),
        samesite="strict",
    )
    logger.info("Edit mode login successful")
    return response


@router.get("/logout")
async def logout(request: Request):
    """Clear the edit cookie and redirect home."""
    response = RedirectResponse("/", status_code=303)
    response.delete_cookie(get_auth_settings(request).cookie_name)
    return response

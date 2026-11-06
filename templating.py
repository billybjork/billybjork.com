from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path

from fastapi.templating import Jinja2Templates

from config import SRC_DIR

_STATIC_ROOT = SRC_DIR / "static"


def versioned_url(url: str, file: Path) -> str:
    """The URL with a `?v=` cache-buster, since /static is served immutable."""
    version = os.getenv("STATIC_VERSION", "").strip()
    if not version:
        try:
            version = str(int(file.stat().st_mtime))
        except FileNotFoundError:
            return url
    return f"{url}?v={version}"


def static_url(request, path: str) -> str:
    normalized = path.lstrip("/")
    return versioned_url(str(request.url_for("static", path=normalized)), _STATIC_ROOT / normalized)


def build_templates(*extra_dirs: Path) -> Jinja2Templates:
    """Jinja environment over templates/; `extra_dirs` take precedence, for self-contained features."""
    templates = Jinja2Templates(directory=[*extra_dirs, SRC_DIR / "templates"])
    templates.env.globals["static_url"] = static_url
    templates.env.globals["current_year"] = lambda: datetime.now().year
    return templates


templates = build_templates()

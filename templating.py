from __future__ import annotations

import os
import re
from pathlib import Path

from fastapi.templating import Jinja2Templates
from markupsafe import Markup

from config import SRC_DIR

_STATIC_ROOT = SRC_DIR / "static"


def static_url(request, path: str) -> str:
    """URL for a file under static/ with a `?v=` cache-buster, since /static is served immutable."""
    normalized = path.lstrip("/")
    url = str(request.url_for("static", path=normalized))
    version = os.getenv("STATIC_VERSION", "").strip()
    if not version:
        try:
            version = str(int((_STATIC_ROOT / normalized).stat().st_mtime))
        except FileNotFoundError:
            return url
    return f"{url}?v={version}"


def _escape_jinja2_in_code_snippets(content) -> Markup:
    if not content:
        return Markup("")
    return Markup(
        re.sub(
            r"(<pre.*?>.*?</pre>)",
            lambda match: match.group(1).replace("{", "&#123;").replace("}", "&#125;"),
            content,
            flags=re.DOTALL,
        )
    )


def build_templates(*extra_dirs: Path) -> Jinja2Templates:
    """Jinja environment over templates/; `extra_dirs` take precedence, for self-contained features."""
    templates = Jinja2Templates(directory=[*extra_dirs, SRC_DIR / "templates"])
    templates.env.filters["escape_jinja2_in_code_snippets"] = _escape_jinja2_in_code_snippets
    templates.env.globals["static_url"] = static_url
    return templates


templates = build_templates()

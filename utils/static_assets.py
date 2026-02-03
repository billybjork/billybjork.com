from __future__ import annotations

from functools import lru_cache
import os
from pathlib import Path

STATIC_ROOT = Path(__file__).resolve().parents[1] / "static"
STATIC_VERSION = os.getenv("STATIC_VERSION", "").strip()


@lru_cache(maxsize=512)
def _file_mtime_version(path: str) -> str:
    try:
        mtime = (STATIC_ROOT / path).stat().st_mtime
    except FileNotFoundError:
        return ""
    return str(int(mtime))


def static_url(request, path: str) -> str:
    normalized = path.lstrip("/")
    url = request.url_for("static", path=normalized)
    version = STATIC_VERSION or _file_mtime_version(normalized)
    if not version:
        return str(url)
    separator = "&" if "?" in str(url) else "?"
    return f"{url}{separator}v={version}"

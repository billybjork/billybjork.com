from __future__ import annotations

import os
from pathlib import Path

STATIC_ROOT = Path(__file__).resolve().parents[1] / "static"
STATIC_VERSION = os.getenv("STATIC_VERSION", "").strip()

# Cache mtimes in memory but track actual mtime to detect changes
_mtime_cache: dict[str, tuple[float, str]] = {}


def _file_mtime_version(path: str) -> str:
    """Get version string based on file mtime, with auto-invalidating cache."""
    try:
        mtime = (STATIC_ROOT / path).stat().st_mtime
    except FileNotFoundError:
        return ""

    cached = _mtime_cache.get(path)
    if cached and cached[0] == mtime:
        return cached[1]

    version = str(int(mtime))
    _mtime_cache[path] = (mtime, version)
    return version


def static_url(request, path: str) -> str:
    normalized = path.lstrip("/")
    url = request.url_for("static", path=normalized)
    version = STATIC_VERSION or _file_mtime_version(normalized)
    if not version:
        return str(url)
    separator = "&" if "?" in str(url) else "?"
    return f"{url}{separator}v={version}"

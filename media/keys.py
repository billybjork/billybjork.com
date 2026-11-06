"""Object keys for every kind of media. One place that knows the bucket layout."""
from __future__ import annotations

import re
from datetime import datetime

PUBLIC_MEDIA_PREFIXES = ("images/", "videos/", "videos_mp4/")


def _timestamped(extension: str) -> str:
    return f"{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}.{extension}"


def hero_root(project_slug: str) -> str:
    return f"videos/{project_slug}"


def hero_hls_prefix(project_slug: str, version: str) -> str:
    """Versioned so a replaced video busts the CDN cache; the same goes for the keys below."""
    return f"{hero_root(project_slug)}/{version}"


def hero_version(project_slug: str, key_or_url: str) -> str | None:
    """The version in a hero HLS key or URL; None for files directly under the root."""
    match = re.search(rf"(?:^|/){re.escape(hero_root(project_slug))}/(\d+)/", key_or_url)
    return match.group(1) if match else None


def hero_sprite_key(project_slug: str, version: str) -> str:
    return f"images/sprite-sheets/{project_slug}_{version}_sprite_sheet.jpg"


def hero_thumbnail_key(project_slug: str, version: str) -> str:
    return f"images/thumbnails/{project_slug}_{version}.webp"


def new_content_image_key() -> str:
    return f"images/project-content/{_timestamped('webp')}"


def new_content_video_key() -> str:
    return f"videos_mp4/{_timestamped('mp4')}"

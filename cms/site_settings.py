"""Site-wide profile fields: content/settings.json."""
from __future__ import annotations

import json
from dataclasses import dataclass

from cms.paths import get_content_paths
from object_storage import public_asset_url, rewrite_managed_public_url, rewrite_public_urls_in_text


@dataclass(frozen=True)
class SiteSettings:
    youtube_link: str | None = None
    instagram_link: str | None = None
    linkedin_link: str | None = None
    github_link: str | None = None
    about_photo_link: str | None = None
    about_photo_srcset: str | None = None
    about_photo_sizes: str | None = None


def _photo_url(value: str | None) -> str | None:
    if not value:
        return None
    if value.startswith(("http://", "https://")):
        return rewrite_managed_public_url(value)
    return public_asset_url(value.lstrip("/"))


def load_site_settings() -> SiteSettings:
    settings_file = get_content_paths().settings_file
    if not settings_file.exists():
        return SiteSettings()

    settings = json.loads(settings_file.read_text(encoding="utf-8"))
    social = settings.get("social_links", {})
    about = settings.get("about", {})
    return SiteSettings(
        youtube_link=social.get("youtube"),
        instagram_link=social.get("instagram"),
        linkedin_link=social.get("linkedin"),
        github_link=social.get("github"),
        about_photo_link=_photo_url(about.get("photo_url")),
        about_photo_srcset=rewrite_public_urls_in_text(about.get("photo_srcset")),
        about_photo_sizes=about.get("photo_sizes"),
    )

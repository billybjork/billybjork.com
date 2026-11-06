"""Site-wide profile fields: content/settings.json."""
from __future__ import annotations

import json
from dataclasses import dataclass

from cms.paths import get_content_paths
from object_storage import rewrite_managed_public_url


@dataclass(frozen=True)
class SiteSettings:
    youtube_link: str | None = None
    instagram_link: str | None = None
    linkedin_link: str | None = None
    github_link: str | None = None
    about_photo_link: str | None = None


def load_site_settings() -> SiteSettings:
    settings_file = get_content_paths().settings_file
    if not settings_file.exists():
        return SiteSettings()

    settings = json.loads(settings_file.read_text(encoding="utf-8"))
    social = settings.get("social_links", {})
    return SiteSettings(
        youtube_link=social.get("youtube"),
        instagram_link=social.get("instagram"),
        linkedin_link=social.get("linkedin"),
        github_link=social.get("github"),
        about_photo_link=rewrite_managed_public_url(settings.get("about", {}).get("photo_url")),
    )

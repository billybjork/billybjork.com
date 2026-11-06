from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

SRC_DIR = Path(__file__).resolve().parent
DEFAULT_ANALYTICS_DB = SRC_DIR / "data" / "analytics.db"


@dataclass(frozen=True)
class ContentPaths:
    content_dir: Path
    projects_dir: Path
    settings_file: Path
    about_file: Path
    assets_file: Path

    @classmethod
    def from_root(cls, content_dir: Path | str) -> "ContentPaths":
        root = Path(content_dir).resolve()
        return cls(
            content_dir=root,
            projects_dir=root / "projects",
            settings_file=root / "settings.json",
            about_file=root / "about.md",
            assets_file=root / "assets.json",
        )


DEFAULT_CONTENT_PATHS = ContentPaths.from_root(SRC_DIR / "content")


@dataclass(frozen=True)
class AuthSettings:
    edit_token: str | None = None
    cookie_secret: str = ""
    localhost_bypass_enabled: bool = True

    @classmethod
    def from_env(cls) -> "AuthSettings":
        edit_token = os.environ.get("EDIT_TOKEN")
        bypass = os.environ.get("LOCALHOST_EDIT_BYPASS")
        return cls(
            edit_token=edit_token,
            cookie_secret=os.environ.get("COOKIE_SECRET", edit_token or ""),
            localhost_bypass_enabled=(
                not edit_token
                if bypass is None
                else bypass.strip().lower() in {"1", "true", "yes", "on"}
            ),
        )


@dataclass(frozen=True)
class AppSettings:
    content_paths: ContentPaths = DEFAULT_CONTENT_PATHS
    analytics_db_path: Path = DEFAULT_ANALYTICS_DB
    auth: AuthSettings = field(default_factory=AuthSettings)
    startup_content_sync_policy: str = "off"

    @classmethod
    def from_env(cls) -> "AppSettings":
        return cls(
            auth=AuthSettings.from_env(),
            startup_content_sync_policy=os.environ.get(
                "CONTENT_STARTUP_SYNC_POLICY", "always"
            ).strip().lower(),
        )

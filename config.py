from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.templating import Jinja2Templates

from filters import escape_jinja2_in_code_snippets
from utils.static_assets import static_url

SRC_DIR = Path(__file__).resolve().parent


def _env_flag(value: Optional[str], default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class ContentPaths:
    content_dir: Path
    projects_dir: Path
    settings_file: Path
    about_file: Path
    assets_file: Path
    test_projects_file: Path

    @classmethod
    def from_root(cls, content_dir: Path | str) -> "ContentPaths":
        root = Path(content_dir).resolve()
        return cls(
            content_dir=root,
            projects_dir=root / "projects",
            settings_file=root / "settings.json",
            about_file=root / "about.md",
            assets_file=root / "assets.json",
            test_projects_file=root / "test_projects.json",
        )


@dataclass(frozen=True)
class AuthSettings:
    edit_token: Optional[str] = None
    cookie_secret: str = ""
    cookie_name: str = "bb_edit"
    cookie_max_age: int = 60 * 60 * 24 * 30
    localhost_bypass_enabled: bool = True


def load_auth_settings() -> AuthSettings:
    edit_token = os.environ.get("EDIT_TOKEN")
    cookie_secret = os.environ.get("COOKIE_SECRET", edit_token or "")
    localhost_bypass_env = os.environ.get("LOCALHOST_EDIT_BYPASS")
    localhost_bypass_enabled = _env_flag(
        localhost_bypass_env,
        default=not bool(edit_token),
    )
    return AuthSettings(
        edit_token=edit_token,
        cookie_secret=cookie_secret,
        localhost_bypass_enabled=localhost_bypass_enabled,
    )


@dataclass(frozen=True)
class AppSettings:
    content_paths: ContentPaths = field(
        default_factory=lambda: ContentPaths.from_root(SRC_DIR / "content")
    )
    static_dir: Path = field(default_factory=lambda: (SRC_DIR / "static").resolve())
    analytics_db_path: Path = field(
        default_factory=lambda: (SRC_DIR / "data" / "analytics.db").resolve()
    )
    auth: Optional[AuthSettings] = None
    startup_content_sync_policy: Optional[str] = None
    temp_video_cleanup_interval_seconds: Optional[int] = None
    app_port: Optional[int] = None
    load_dotenv_on_startup: bool = True
    init_analytics_db_on_startup: bool = True
    run_startup_content_sync_on_startup: bool = True
    run_temp_video_cleanup_on_startup: bool = True
    start_temp_video_cleanup_loop_on_startup: bool = True

    def resolved_auth(self) -> AuthSettings:
        return self.auth if self.auth is not None else load_auth_settings()

    def resolved_startup_content_sync_policy(self) -> str:
        value = self.startup_content_sync_policy
        if value is None:
            value = os.environ.get("CONTENT_STARTUP_SYNC_POLICY", "always")
        return value.strip().lower()

    def resolved_temp_video_cleanup_interval_seconds(self) -> int:
        value = self.temp_video_cleanup_interval_seconds
        if value is None:
            raw = os.environ.get("TEMP_VIDEO_CLEANUP_INTERVAL_SECONDS", "900")
            value = int(raw)
        return max(1, int(value))

    def resolved_app_port(self) -> int:
        value = self.app_port
        if value is None:
            value = os.environ.get("PORT", os.environ.get("APP_PORT", "8001"))
        return int(value)


def get_app_settings(
    *,
    request: Request | None = None,
    app: FastAPI | None = None,
) -> AppSettings:
    target_app = app or (request.app if request is not None else None)
    if target_app is not None:
        settings = getattr(target_app.state, "settings", None)
        if isinstance(settings, AppSettings):
            return settings
    return AppSettings()


def build_templates(directory: Path | str | None = None) -> Jinja2Templates:
    templates = Jinja2Templates(directory=str(directory or (SRC_DIR / "templates")))
    templates.env.filters["escape_jinja2_in_code_snippets"] = (
        escape_jinja2_in_code_snippets
    )
    templates.env.globals["static_url"] = static_url
    return templates


templates = build_templates()

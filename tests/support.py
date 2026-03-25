from __future__ import annotations

import json
from contextlib import ExitStack, contextmanager
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Iterator
from unittest.mock import patch

from fastapi.testclient import TestClient

from config import AppSettings, AuthSettings, ContentPaths
from main import create_app

TEST_AUTH_SETTINGS = AuthSettings(
    edit_token="secret-token",
    cookie_secret="cookie-secret",
    localhost_bypass_enabled=False,
)


@dataclass
class TestAppHarness:
    client: TestClient
    content_root: Path

    @property
    def projects_dir(self) -> Path:
        return self.content_root / "projects"

    @property
    def project_file(self) -> Path:
        return self.projects_dir / "sample-project.md"

    def login(self) -> None:
        response = self.client.post(
            "/edit/login",
            data={"token": TEST_AUTH_SETTINGS.edit_token},
            follow_redirects=False,
        )
        assert response.status_code == 303


def _seed_content_root(content_root: Path) -> None:
    projects_dir = content_root / "projects"
    projects_dir.mkdir(parents=True, exist_ok=True)

    (projects_dir / "sample-project.md").write_text(
        "\n".join(
            [
                "---",
                "name: Sample Project",
                "slug: sample-project",
                "date: 2024-01-15",
                "draft: false",
                "pinned: false",
                "---",
                "",
                "Seed project body",
                "",
            ]
        ),
        encoding="utf-8",
    )

    (content_root / "about.md").write_text(
        "---\ntitle: About\n---\n\nAbout integration body\n",
        encoding="utf-8",
    )

    (content_root / "settings.json").write_text(
        json.dumps(
            {
                "social_links": {
                    "youtube": "",
                    "vimeo": "",
                    "instagram": "",
                    "linkedin": "",
                    "github": "",
                },
                "about": {
                    "photo_url": "",
                    "photo_srcset": "",
                    "photo_sizes": "",
                },
            },
            indent=2,
        ),
        encoding="utf-8",
    )


@contextmanager
def managed_test_app() -> Iterator[TestAppHarness]:
    with TemporaryDirectory() as temp_dir, ExitStack() as stack:
        root = Path(temp_dir)
        content_root = root / "content"
        _seed_content_root(content_root)

        stack.enter_context(patch("utils.content._sync_to_s3", return_value=None))
        stack.enter_context(patch("utils.content._delete_from_s3", return_value=None))
        stack.enter_context(patch("utils.content._archive_to_s3", return_value=None))
        stack.enter_context(patch("routers.admin.cleanup_orphans", return_value=[]))
        stack.enter_context(
            patch("routers.admin.cleanup_old_hls_versions", return_value=[])
        )
        stack.enter_context(patch("routers.admin.delete_video_prefix", return_value=[]))

        app = create_app(
            AppSettings(
                content_paths=ContentPaths.from_root(content_root),
                analytics_db_path=root / "data" / "analytics.db",
                auth=TEST_AUTH_SETTINGS,
                load_dotenv_on_startup=False,
                init_analytics_db_on_startup=False,
                run_startup_content_sync_on_startup=False,
                run_temp_video_cleanup_on_startup=False,
                start_temp_video_cleanup_loop_on_startup=False,
            )
        )
        client = stack.enter_context(TestClient(app))
        yield TestAppHarness(client=client, content_root=content_root)

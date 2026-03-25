import asyncio
import unittest
from unittest.mock import Mock, patch

from routers.admin import create_project, save_project_endpoint


class DummyRequest:
    def __init__(self, payload):
        self._payload = payload

    async def json(self):
        return self._payload


class AdminRoutesTests(unittest.TestCase):
    @patch("routers.admin.cleanup_old_hls_versions")
    @patch("routers.admin.cleanup_orphans")
    @patch("routers.admin.delete_project")
    @patch("routers.admin.save_project")
    @patch("routers.admin.content_revision", return_value="sha256:test-revision")
    @patch("routers.admin.load_project_info")
    def test_save_project_rename_path_returns_success(
        self,
        mock_load_project_info,
        _mock_content_revision,
        _mock_save_project,
        _mock_delete_project,
        _mock_cleanup_orphans,
        _mock_cleanup_hls,
    ) -> None:
        old_project = Mock()
        old_project.markdown_content = "Existing markdown"
        old_project.og_image = None
        old_project.video_metadata.return_value = {}
        mock_load_project_info.return_value = old_project

        result = asyncio.run(
            save_project_endpoint(
                DummyRequest(
                    {
                        "slug": "zz-hardening-rename-target",
                        "original_slug": "airdrop",
                        "name": "Airdrop",
                        "date": "2024-01-01",
                        "pinned": False,
                        "draft": False,
                        "video": {},
                        "markdown": "Updated markdown",
                    }
                )
            )
        )

        self.assertEqual(result["slug"], "zz-hardening-rename-target")
        self.assertEqual(result["revision"], "sha256:test-revision")

    @patch("routers.admin.save_project")
    def test_create_project_path_uses_collision_check_without_crashing(
        self,
        _mock_save_project,
    ) -> None:
        result = asyncio.run(
            create_project(
                DummyRequest(
                    {
                        "slug": "zz-hardening-created-project",
                        "name": "Created Project",
                        "date": "2024-01-01",
                        "pinned": False,
                        "draft": False,
                    }
                )
            )
        )

        self.assertEqual(result["slug"], "zz-hardening-created-project")


if __name__ == "__main__":
    unittest.main()

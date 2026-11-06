import os
import unittest
from unittest.mock import patch

from cms.sync import run_startup_sync
from config import AppSettings

from tests.support import managed_test_app


class StartupSyncTests(unittest.TestCase):
    def test_always_pulls_content_but_skips_metadata_and_unsafe_keys(self) -> None:
        with managed_test_app() as app:
            app.storage.put("content/projects/pulled.md", b"---\nname: Pulled\n---\n\nbody")
            app.storage.put("content/.object-storage-canonical.json", b"{}")
            app.storage.put("content/../evil.md", b"x")

            run_startup_sync("always")

            self.assertTrue((app.projects_dir / "pulled.md").exists())
            self.assertFalse((app.content_root / ".object-storage-canonical.json").exists())
            self.assertFalse((app.content_root.parent / "evil.md").exists())

    def test_guarded_waits_for_the_canonical_marker(self) -> None:
        with managed_test_app() as app:
            app.storage.put("content/projects/pulled.md", b"body")
            run_startup_sync("guarded")
            self.assertFalse((app.projects_dir / "pulled.md").exists())

            app.storage.put("content/.object-storage-canonical.json", b"{}")
            run_startup_sync("guarded")
            self.assertTrue((app.projects_dir / "pulled.md").exists())

    def test_pull_removes_local_files_the_bucket_no_longer_has(self) -> None:
        with managed_test_app() as app:
            app.storage.put("content/about.md", b"---\ntitle: About\n---\n\nFrom the bucket\n")
            (app.content_root / ".dotfile").write_text("sync metadata stays", encoding="utf-8")

            run_startup_sync("always")

            self.assertFalse(app.project_file.exists())
            self.assertEqual(app.client.get("/sample-project").status_code, 404)
            self.assertTrue((app.content_root / "about.md").exists())
            self.assertTrue((app.content_root / ".dotfile").exists())

    def test_pull_removes_nothing_when_the_bucket_has_no_content(self) -> None:
        with managed_test_app() as app:
            run_startup_sync("always")
            self.assertTrue(app.project_file.exists())

            app.storage.put("content/.object-storage-canonical.json", b"{}")
            run_startup_sync("always")
            self.assertTrue(app.project_file.exists())

    def test_failed_pull_removes_nothing(self) -> None:
        with managed_test_app() as app:
            app.storage.put("content/about.md", b"body")
            with patch.object(app.storage, "download_file", side_effect=OSError("network")):
                with self.assertRaises(OSError):
                    run_startup_sync("always")
            self.assertTrue(app.project_file.exists())

    def test_unknown_policy_stops_startup(self) -> None:
        with patch.dict(os.environ, {"CONTENT_STARTUP_SYNC_POLICY": "legacy"}):
            with self.assertRaises(ValueError):
                AppSettings.from_env()


if __name__ == "__main__":
    unittest.main()

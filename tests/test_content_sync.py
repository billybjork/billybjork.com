import unittest

from tests.support import managed_test_app


class StartupSyncTests(unittest.TestCase):
    def test_always_pulls_content_but_skips_metadata_and_unsafe_keys(self) -> None:
        with managed_test_app() as app:
            app.storage.put("content/projects/pulled.md", b"---\nname: Pulled\n---\n\nbody")
            app.storage.put("content/.object-storage-canonical.json", b"{}")
            app.storage.put("content/../evil.md", b"x")

            from cms.sync import run_startup_sync

            run_startup_sync("always")

            self.assertTrue((app.projects_dir / "pulled.md").exists())
            self.assertFalse((app.content_root / ".object-storage-canonical.json").exists())
            self.assertFalse((app.content_root.parent / "evil.md").exists())

    def test_guarded_waits_for_the_canonical_marker(self) -> None:
        with managed_test_app() as app:
            from cms.sync import run_startup_sync

            app.storage.put("content/projects/pulled.md", b"body")
            run_startup_sync("guarded")
            self.assertFalse((app.projects_dir / "pulled.md").exists())

            app.storage.put("content/.object-storage-canonical.json", b"{}")
            run_startup_sync("guarded")
            self.assertTrue((app.projects_dir / "pulled.md").exists())

    def test_unknown_policy_is_an_error(self) -> None:
        from cms.sync import run_startup_sync

        with self.assertRaises(ValueError):
            run_startup_sync("legacy")


if __name__ == "__main__":
    unittest.main()

import io
import unittest

from PIL import Image

from tests.support import PUBLIC_BASE_URL, managed_test_app


def _save_payload(**overrides) -> dict:
    return {
        "slug": "sample-project",
        "name": "Sample Project",
        "date": "2024-01-15",
        "video": {},
        "markdown": "Body",
        **overrides,
    }


def _png_bytes() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (4, 4), (1, 2, 3)).save(buffer, "PNG")
    return buffer.getvalue()


class ProjectSaveTests(unittest.TestCase):
    def test_rename_moves_the_file_and_rejects_taken_slugs(self) -> None:
        with managed_test_app() as app:
            app.login()

            renamed = app.client.post(
                "/api/save-project",
                json=_save_payload(slug="renamed", original_slug="sample-project"),
            )
            self.assertEqual(renamed.status_code, 200)
            self.assertEqual(renamed.json()["slug"], "renamed")
            self.assertTrue((app.projects_dir / "renamed.md").exists())
            self.assertFalse(app.project_file.exists())

            app.client.post("/api/create-project", json={"slug": "taken"})
            collision = app.client.post(
                "/api/save-project", json=_save_payload(slug="taken", original_slug="renamed")
            )
            self.assertEqual(collision.status_code, 400)

    def test_saved_content_reaches_object_storage(self) -> None:
        with managed_test_app() as app:
            app.login()
            app.client.post("/api/save-project", json=_save_payload(markdown="Synced body"))
            self.assertIn(
                b"Synced body", app.storage.objects["content/projects/sample-project.md"]["Body"]
            )

    def test_asset_removed_from_markdown_is_deleted_unless_used_elsewhere(self) -> None:
        with managed_test_app() as app:
            app.login()
            app.storage.put("images/misc/gone.webp")
            app.storage.put("images/misc/shared.webp")
            gone, shared = (
                f"{PUBLIC_BASE_URL}/images/misc/gone.webp",
                f"{PUBLIC_BASE_URL}/images/misc/shared.webp",
            )
            app.client.post(
                "/api/create-project",
                json={"slug": "other", "markdown": f"![s]({shared})"},
            )
            app.client.post(
                "/api/save-project", json=_save_payload(markdown=f"![g]({gone})\n![s]({shared})")
            )

            app.client.post("/api/save-project", json=_save_payload(markdown="No images"))

            self.assertNotIn("images/misc/gone.webp", app.storage.objects)
            self.assertIn("images/misc/shared.webp", app.storage.objects)

    def test_save_keeps_only_the_current_hero_version(self) -> None:
        with managed_test_app() as app:
            app.login()
            app.storage.put("videos/sample-project/111/master.m3u8")
            app.storage.put("videos/sample-project/222/master.m3u8")

            app.client.post(
                "/api/save-project",
                json=_save_payload(
                    video={"hls": f"{PUBLIC_BASE_URL}/videos/sample-project/222/master.m3u8"}
                ),
            )

            self.assertNotIn("videos/sample-project/111/master.m3u8", app.storage.objects)
            self.assertIn("videos/sample-project/222/master.m3u8", app.storage.objects)

    def test_delete_archives_the_file_and_removes_hero_videos(self) -> None:
        with managed_test_app() as app:
            app.login()
            app.storage.put("content/projects/sample-project.md")
            app.storage.put("videos/sample-project/111/master.m3u8")

            response = app.client.delete("/api/project/sample-project")

            self.assertEqual(response.status_code, 200)
            self.assertFalse(app.project_file.exists())
            self.assertNotIn("content/projects/sample-project.md", app.storage.objects)
            self.assertNotIn("videos/sample-project/111/master.m3u8", app.storage.objects)
            self.assertTrue(
                any(key.startswith("content-archive/sample-project_") for key in app.storage.objects)
            )


class AboutSaveTests(unittest.TestCase):
    def test_conflict_then_success(self) -> None:
        with managed_test_app() as app:
            app.login()
            revision = app.client.get("/api/about").json()["revision"]

            conflict = app.client.post(
                "/api/save-about", json={"markdown": "x", "base_revision": "sha256:stale"}
            )
            self.assertEqual(conflict.status_code, 409)

            saved = app.client.post(
                "/api/save-about", json={"markdown": "New about", "base_revision": revision}
            )
            self.assertEqual(saved.status_code, 200)
            self.assertIn("New about", app.client.get("/me").text)


class ImageUploadTests(unittest.TestCase):
    def test_identical_images_are_stored_once(self) -> None:
        with managed_test_app() as app:
            app.login()
            files = {"file": ("a.png", _png_bytes())}

            first = app.client.post("/api/upload-media", files=files).json()
            second = app.client.post("/api/upload-media", files=files).json()

            self.assertFalse(first["deduplicated"])
            self.assertTrue(second["deduplicated"])
            self.assertEqual(first["url"], second["url"])
            key = first["url"].removeprefix(f"{PUBLIC_BASE_URL}/")
            self.assertEqual(app.storage.objects[key]["ContentType"], "image/webp")

    def test_non_image_is_rejected(self) -> None:
        with managed_test_app() as app:
            app.login()
            response = app.client.post("/api/upload-media", files={"file": ("a.png", b"nope")})
            self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()

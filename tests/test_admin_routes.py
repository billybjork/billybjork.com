import io
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from media.hero_sessions import HlsSession, TempVideo, hls_sessions, temp_videos
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

    def test_save_keeps_a_current_unversioned_hero_and_its_files(self) -> None:
        with managed_test_app() as app:
            app.login()
            app.storage.put("videos/sample-project/master.m3u8")
            app.storage.put("videos/sample-project/seg_0_000.ts")
            app.storage.put("videos/sample-project/111/master.m3u8")

            app.client.post(
                "/api/save-project",
                json=_save_payload(
                    video={"hls": f"{PUBLIC_BASE_URL}/videos/sample-project/master.m3u8"}
                ),
            )

            self.assertIn("videos/sample-project/master.m3u8", app.storage.objects)
            self.assertIn("videos/sample-project/seg_0_000.ts", app.storage.objects)
            self.assertNotIn("videos/sample-project/111/master.m3u8", app.storage.objects)

    def test_create_rejects_malformed_bodies(self) -> None:
        with managed_test_app() as app:
            app.login()
            self.assertEqual(app.client.post("/api/create-project", json=[1]).status_code, 400)
            self.assertEqual(app.client.post("/api/create-project", json={"slug": 5}).status_code, 400)

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


def _hero(folder: str) -> dict:
    return {"hls": f"{PUBLIC_BASE_URL}/videos/{folder}/master.m3u8"}


class HeroCleanupTests(unittest.TestCase):
    """Hero files go by what content references, never by whose slug their path looks like."""

    def test_a_new_project_cannot_delete_a_renamed_projects_video(self) -> None:
        with managed_test_app() as app:
            app.login()
            app.storage.put("videos/sample-project/111/master.m3u8")
            video = _hero("sample-project/111")
            app.client.post("/api/save-project", json=_save_payload(video=video))
            app.client.post(
                "/api/save-project",
                json=_save_payload(slug="moved", original_slug="sample-project", video=video),
            )

            app.client.post("/api/create-project", json={"slug": "sample-project"})
            app.client.post("/api/save-project", json=_save_payload(markdown="New project"))

            self.assertIn("videos/sample-project/111/master.m3u8", app.storage.objects)

    def test_deleting_a_project_removes_its_video_from_the_folder_it_really_uses(self) -> None:
        with managed_test_app() as app:
            app.login()
            app.storage.put("videos/old_folder/master.m3u8")
            app.storage.put("videos/old_folder/seg_0_000.ts")
            app.client.post("/api/save-project", json=_save_payload(video=_hero("old_folder")))

            app.client.delete("/api/project/sample-project")

            self.assertNotIn("videos/old_folder/master.m3u8", app.storage.objects)
            self.assertNotIn("videos/old_folder/seg_0_000.ts", app.storage.objects)

    def test_deleting_a_project_leaves_a_video_another_project_uses(self) -> None:
        with managed_test_app() as app:
            app.login()
            app.storage.put("videos/shared/master.m3u8")
            app.storage.put("videos/shared/seg_0_000.ts")
            app.client.post("/api/save-project", json=_save_payload(video=_hero("shared")))
            (app.projects_dir / "other.md").write_text(
                f"---\nname: Other\nvideo:\n  hls: {_hero('shared')['hls']}\n---\n\nBody\n", encoding="utf-8"
            )

            app.client.delete("/api/project/sample-project")

            self.assertIn("videos/shared/master.m3u8", app.storage.objects)
            self.assertIn("videos/shared/seg_0_000.ts", app.storage.objects)

    def test_replacing_a_video_removes_the_old_one_from_a_folder_unlike_the_slug(self) -> None:
        with managed_test_app() as app:
            app.login()
            app.storage.put("videos/old_folder/master.m3u8")
            app.storage.put("videos/old_folder/seg_0_000.ts")
            app.client.post("/api/save-project", json=_save_payload(video=_hero("old_folder")))
            app.storage.put("videos/sample-project/222/master.m3u8")

            app.client.post("/api/save-project", json=_save_payload(video=_hero("sample-project/222")))

            self.assertNotIn("videos/old_folder/master.m3u8", app.storage.objects)
            self.assertNotIn("videos/old_folder/seg_0_000.ts", app.storage.objects)
            self.assertIn("videos/sample-project/222/master.m3u8", app.storage.objects)

    def test_a_save_leaves_an_encode_still_running(self) -> None:
        with managed_test_app() as app:
            app.login()
            app.storage.put("videos/sample-project/333/seg_0_000.ts")
            app.storage.put("videos/sample-project/444/seg_0_000.ts")
            session_id = hls_sessions.add(HlsSession(slug="sample-project", version="333"))
            self.addCleanup(hls_sessions.pop, session_id)

            app.client.post("/api/save-project", json=_save_payload())

            self.assertIn("videos/sample-project/333/seg_0_000.ts", app.storage.objects)
            self.assertNotIn("videos/sample-project/444/seg_0_000.ts", app.storage.objects)

    def test_folder_names_with_commas_and_escapes_still_count_as_referenced(self) -> None:
        with managed_test_app() as app:
            app.login()
            comma = "videos/10,000_lakes/master.m3u8"
            app.storage.put(comma)
            app.storage.put("videos/mikaela_+_niko/seg_0_000.ts")
            app.client.post("/api/save-project", json=_save_payload(video=_hero("10,000_lakes")))
            (app.projects_dir / "other.md").write_text(
                f"---\nname: Other\nvideo:\n  hls: {_hero('mikaela_%2B_niko')['hls']}\n---\n\nBody\n",
                encoding="utf-8",
            )

            app.client.post(
                "/api/cleanup-assets",
                json={"urls": [f"{PUBLIC_BASE_URL}/{comma}", _hero("mikaela_%2B_niko")["hls"]]},
            )

            self.assertIn(comma, app.storage.objects)
            self.assertIn("videos/mikaela_+_niko/seg_0_000.ts", app.storage.objects)

    def test_discarding_an_unsaved_video_removes_all_its_files(self) -> None:
        with managed_test_app() as app:
            app.login()
            app.storage.put("videos/sample-project/111/master.m3u8")
            app.storage.put("videos/sample-project/222/master.m3u8")
            app.storage.put("videos/sample-project/222/seg_0_000.ts")
            app.storage.put("images/thumbnails/sample-project_222.webp")
            app.client.post("/api/save-project", json=_save_payload(video=_hero("sample-project/111")))

            app.client.post(
                "/api/cleanup-assets",
                json={
                    "urls": [
                        _hero("sample-project/222")["hls"],
                        f"{PUBLIC_BASE_URL}/images/thumbnails/sample-project_222.webp",
                    ]
                },
            )

            self.assertNotIn("videos/sample-project/222/master.m3u8", app.storage.objects)
            self.assertNotIn("videos/sample-project/222/seg_0_000.ts", app.storage.objects)
            self.assertNotIn("images/thumbnails/sample-project_222.webp", app.storage.objects)
            self.assertIn("videos/sample-project/111/master.m3u8", app.storage.objects)


class DurabilityTests(unittest.TestCase):
    def test_failed_archive_stops_the_delete(self) -> None:
        with managed_test_app() as app:
            app.login()
            app.storage.put("content/projects/sample-project.md")
            app.storage.put("videos/sample-project/111/master.m3u8")
            app.storage.failing_upload_prefixes = ("content-archive/",)

            response = app.client.delete("/api/project/sample-project")

            self.assertEqual(response.status_code, 502)
            self.assertTrue(app.project_file.exists())
            self.assertIn("content/projects/sample-project.md", app.storage.objects)
            self.assertIn("videos/sample-project/111/master.m3u8", app.storage.objects)

    def test_failed_archive_stops_a_rename_with_both_slugs_unchanged(self) -> None:
        with managed_test_app() as app:
            app.login()
            app.storage.failing_upload_prefixes = ("content-archive/",)

            response = app.client.post(
                "/api/save-project", json=_save_payload(slug="moved", original_slug="sample-project")
            )

            self.assertEqual(response.status_code, 502)
            self.assertTrue(app.project_file.exists())
            self.assertFalse((app.projects_dir / "moved.md").exists())

    def test_without_object_storage_deleting_and_saving_still_work_locally(self) -> None:
        with managed_test_app(storage_configured=False) as app:
            app.login()
            app.storage.failing_upload_prefixes = ("",)

            saved = app.client.post("/api/save-project", json=_save_payload())
            self.assertEqual(saved.status_code, 200)
            self.assertTrue(saved.json()["synced"])

            self.assertEqual(app.client.delete("/api/project/sample-project").status_code, 200)
            self.assertFalse(app.project_file.exists())

    def test_saves_report_whether_the_upload_landed(self) -> None:
        with managed_test_app() as app:
            app.login()
            self.assertTrue(app.client.post("/api/save-project", json=_save_payload()).json()["synced"])
            self.assertTrue(app.client.post("/api/save-about", json={"markdown": "x"}).json()["synced"])

            app.storage.failing_upload_prefixes = ("content/",)
            for response in (
                app.client.post("/api/save-project", json=_save_payload(markdown="Local only")),
                app.client.post("/api/save-about", json={"markdown": "y"}),
                app.client.post("/api/create-project", json={"slug": "fresh"}),
            ):
                self.assertEqual(response.status_code, 200)
                self.assertFalse(response.json()["synced"])
            self.assertIn("Local only", app.project_file.read_text(encoding="utf-8"))


@unittest.skipUnless(shutil.which("ffmpeg"), "needs ffmpeg")
class HeroSpriteRetryTests(unittest.TestCase):
    def test_a_failed_sprite_can_be_retried_with_the_same_temp_video(self) -> None:
        with managed_test_app() as app, tempfile.TemporaryDirectory() as temp_dir:
            app.login()
            source = Path(temp_dir) / "source.mp4"
            subprocess.run(
                ["ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=d=1:s=64x36:r=10", "-pix_fmt", "yuv420p", str(source)],
                check=True,
                capture_output=True,
            )
            temp_id = temp_videos.add(TempVideo(source=str(source), frames=[], video_width=64, video_height=36))
            self.addCleanup(temp_videos.pop, temp_id)
            session_id = hls_sessions.add(
                HlsSession(
                    slug="sample-project",
                    version="111",
                    status="complete",
                    hls_url=_hero("sample-project/111")["hls"],
                )
            )
            self.addCleanup(hls_sessions.pop, session_id)
            form = {
                "temp_id": temp_id,
                "hls_session_id": session_id,
                "project_slug": "sample-project",
                "sprite_start": "0",
                "sprite_duration": "1",
            }

            app.storage.failing_upload_prefixes = ("images/sprite-sheets/",)
            failed = app.client.post("/api/generate-sprite-sheet", data=form)
            self.assertEqual(failed.status_code, 500)
            self.assertTrue(source.exists())

            app.storage.failing_upload_prefixes = ()
            retried = app.client.post("/api/generate-sprite-sheet", data=form)
            self.assertEqual(retried.status_code, 200)
            self.assertEqual(retried.json()["video"]["hls"], _hero("sample-project/111")["hls"])
            self.assertFalse(source.exists())
            self.assertIsNone(temp_videos.get(temp_id))
            self.assertIsNone(hls_sessions.get(session_id))


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

    def test_camera_rotation_is_applied_before_the_metadata_is_dropped(self) -> None:
        with managed_test_app() as app:
            app.login()
            buffer = io.BytesIO()
            exif = Image.Exif()
            exif[0x0112] = 6  # Orientation: rotate 90 degrees to display.
            Image.new("RGB", (40, 20), (1, 2, 3)).save(buffer, "JPEG", exif=exif)

            url = app.client.post("/api/upload-media", files={"file": ("a.jpg", buffer.getvalue())}).json()["url"]

            stored = app.storage.objects[url.removeprefix(f"{PUBLIC_BASE_URL}/")]["Body"]
            self.assertEqual(Image.open(io.BytesIO(stored)).size, (20, 40))

    def test_a_large_original_is_resized_on_the_server(self) -> None:
        with managed_test_app() as app:
            app.login()
            buffer = io.BytesIO()
            Image.new("RGB", (3000, 1500), (1, 2, 3)).save(buffer, "PNG")

            url = app.client.post("/api/upload-media", files={"file": ("a.png", buffer.getvalue())}).json()["url"]

            stored = app.storage.objects[url.removeprefix(f"{PUBLIC_BASE_URL}/")]["Body"]
            self.assertEqual(Image.open(io.BytesIO(stored)).size, (2000, 1000))

    def test_transparency_flattens_onto_white_for_every_alpha_mode(self) -> None:
        with managed_test_app() as app:
            app.login()
            for mode, clear in (("RGBA", (0, 0, 0, 0)), ("LA", (0, 0))):
                buffer = io.BytesIO()
                Image.new(mode, (4, 4), clear).save(buffer, "PNG")

                url = app.client.post("/api/upload-media", files={"file": ("a.png", buffer.getvalue())}).json()["url"]

                stored = app.storage.objects[url.removeprefix(f"{PUBLIC_BASE_URL}/")]["Body"]
                self.assertGreater(Image.open(io.BytesIO(stored)).convert("RGB").getpixel((0, 0))[0], 250, mode)

    def test_non_image_is_rejected(self) -> None:
        with managed_test_app() as app:
            app.login()
            response = app.client.post("/api/upload-media", files={"file": ("a.png", b"nope")})
            self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()

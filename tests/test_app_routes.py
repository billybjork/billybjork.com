import unittest
from unittest.mock import patch

from tests.support import managed_test_app


class _FakeObjectBody:
    def __init__(self, data: bytes) -> None:
        self._data = data

    def read(self) -> bytes:
        return self._data


class _FakeObjectStorageClient:
    def get_object(self, **kwargs):
        key = kwargs["Key"]
        range_header = kwargs.get("Range")

        if key != "images/test.webp":
            raise AssertionError(f"Unexpected key requested: {key}")

        body = b"test-image-bytes"
        if range_header == "bytes=0-3":
            return {
                "Body": _FakeObjectBody(body[:4]),
                "ContentType": "image/webp",
                "CacheControl": "max-age=31536000",
                "ContentLength": 4,
                "ContentRange": "bytes 0-3/16",
                "ETag": '"etag-value"',
            }

        return {
            "Body": _FakeObjectBody(body),
            "ContentType": "image/webp",
            "CacheControl": "max-age=31536000",
            "ContentLength": len(body),
            "ETag": '"etag-value"',
        }


class AppRoutesIntegrationTests(unittest.TestCase):
    def test_auth_gating_requires_login_and_login_unlocks_admin_routes(self) -> None:
        with managed_test_app() as app:
            unauthorized = app.client.get("/api/project/sample-project")
            self.assertEqual(unauthorized.status_code, 403)

            login_page = app.client.get("/edit/login")
            self.assertEqual(login_page.status_code, 200)

            invalid_login = app.client.post(
                "/edit/login",
                data={"token": "wrong-token"},
                follow_redirects=False,
            )
            self.assertEqual(invalid_login.status_code, 303)
            self.assertEqual(invalid_login.headers["location"], "/edit/login?error=1")

            app.login()

            authorized = app.client.get("/api/project/sample-project")
            self.assertEqual(authorized.status_code, 200)
            self.assertEqual(authorized.json()["slug"], "sample-project")

    def test_create_project_and_duplicate_slug_handling(self) -> None:
        with managed_test_app() as app:
            app.login()

            create_response = app.client.post(
                "/api/create-project",
                json={
                    "slug": "new-project",
                    "name": "New Project",
                    "date": "2024-02-01",
                    "pinned": False,
                    "draft": False,
                    "markdown": "Created body",
                },
            )
            self.assertEqual(create_response.status_code, 200)
            self.assertTrue((app.projects_dir / "new-project.md").exists())

            duplicate_response = app.client.post(
                "/api/create-project",
                json={
                    "slug": "new-project",
                    "name": "New Project",
                    "date": "2024-02-01",
                    "pinned": False,
                    "draft": False,
                },
            )
            self.assertEqual(duplicate_response.status_code, 400)
            self.assertEqual(
                duplicate_response.json()["detail"],
                "Project with this slug already exists",
            )

    def test_save_project_conflict_then_success(self) -> None:
        with managed_test_app() as app:
            app.login()

            existing = app.client.get("/api/project/sample-project")
            self.assertEqual(existing.status_code, 200)
            revision = existing.json()["revision"]

            conflict_response = app.client.post(
                "/api/save-project",
                json={
                    "slug": "sample-project",
                    "original_slug": "sample-project",
                    "name": "Sample Project",
                    "date": "2024-01-15",
                    "pinned": False,
                    "draft": False,
                    "video": {},
                    "markdown": "Conflicting body",
                    "base_revision": "sha256:stale",
                },
            )
            self.assertEqual(conflict_response.status_code, 409)
            self.assertTrue(conflict_response.json()["conflict"])

            save_response = app.client.post(
                "/api/save-project",
                json={
                    "slug": "sample-project",
                    "original_slug": "sample-project",
                    "name": "Sample Project Updated",
                    "date": "2024-01-15",
                    "pinned": True,
                    "draft": False,
                    "video": {},
                    "markdown": "Updated integration body",
                    "base_revision": revision,
                },
            )
            self.assertEqual(save_response.status_code, 200)
            self.assertEqual(save_response.json()["slug"], "sample-project")
            self.assertNotEqual(save_response.json()["revision"], revision)
            self.assertIn(
                "Updated integration body",
                app.project_file.read_text(encoding="utf-8"),
            )

    def test_public_about_page_renders_seeded_content(self) -> None:
        with managed_test_app() as app:
            response = app.client.get("/me")
            self.assertEqual(response.status_code, 200)
            self.assertIn("About integration body", response.text)

    def test_media_route_serves_object_storage_assets(self) -> None:
        with managed_test_app() as app:
            with patch("routers.pages.is_object_storage_configured", return_value=True):
                with patch(
                    "routers.pages.get_object_storage_client",
                    return_value=_FakeObjectStorageClient(),
                ):
                    with patch("routers.pages.get_bucket_name", return_value="test-bucket"):
                        response = app.client.get("/media/images/test.webp")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"test-image-bytes")
        self.assertEqual(response.headers["content-type"], "image/webp")
        self.assertEqual(response.headers["cache-control"], "max-age=31536000")
        self.assertEqual(response.headers["accept-ranges"], "bytes")
        self.assertEqual(response.headers["access-control-allow-origin"], "*")

    def test_media_route_supports_range_requests(self) -> None:
        with managed_test_app() as app:
            with patch("routers.pages.is_object_storage_configured", return_value=True):
                with patch(
                    "routers.pages.get_object_storage_client",
                    return_value=_FakeObjectStorageClient(),
                ):
                    with patch("routers.pages.get_bucket_name", return_value="test-bucket"):
                        response = app.client.get(
                            "/media/images/test.webp",
                            headers={"range": "bytes=0-3"},
                        )

        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.content, b"test")
        self.assertEqual(response.headers["content-range"], "bytes 0-3/16")

    def test_media_route_rejects_non_public_prefixes(self) -> None:
        with managed_test_app() as app:
            response = app.client.get("/media/content/about.md")

        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()

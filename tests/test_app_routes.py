import unittest

from tests.support import managed_test_app


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

    def test_homepage_list_shows_project_title_and_date(self) -> None:
        with managed_test_app() as app:
            response = app.client.get("/")
            self.assertEqual(response.status_code, 200)
            self.assertIn(
                '<time class="homepage-card-date">January, 2024</time>',
                response.text,
            )
            self.assertIn(
                '<h2 class="homepage-card-title">Sample Project</h2>',
                response.text,
            )

    def test_public_about_page_renders_seeded_content(self) -> None:
        with managed_test_app() as app:
            response = app.client.get("/me")
            self.assertEqual(response.status_code, 200)
            self.assertIn("About integration body", response.text)

    def _add_draft(self, app) -> None:
        (app.projects_dir / "secret-draft.md").write_text(
            "---\nname: Secret Draft\nslug: secret-draft\ndate: 2024-01-15\ndraft: true\n---\n\nUnpublished\n",
            encoding="utf-8",
        )

    def test_drafts_are_hidden_from_the_public(self) -> None:
        with managed_test_app() as app:
            self._add_draft(app)
            self.assertEqual(app.client.get("/secret-draft").status_code, 404)
            self.assertEqual(app.client.get("/secret-draft?_partial=1").status_code, 404)

    def test_editors_can_open_a_draft_directly(self) -> None:
        with managed_test_app() as app:
            self._add_draft(app)
            app.login()

            page = app.client.get("/secret-draft")
            self.assertEqual(page.status_code, 200)
            self.assertIn('data-open-project="secret-draft"', page.text)
            self.assertNotIn('data-open-project="secret-draft"', app.client.get("/").text)

            fragment = app.client.get("/secret-draft?_partial=1")
            self.assertEqual(fragment.status_code, 200)
            self.assertIn("Unpublished", fragment.text)

    def test_a_published_project_opens_from_the_drafts_only_list(self) -> None:
        with managed_test_app() as app:
            app.login()
            page = app.client.get("/sample-project?show_drafts=true")
            self.assertIn('data-open-project="sample-project"', page.text)

    def test_pages_are_cached_publicly_only_for_the_public(self) -> None:
        with managed_test_app() as app:
            self._add_draft(app)
            public = app.client.get("/")
            self.assertEqual(public.headers["cache-control"], "public, max-age=300, stale-while-revalidate=60")
            self.assertIn("Cookie", public.headers["vary"])

            app.login()
            for path in ("/", "/me", "/sample-project", "/secret-draft", "/secret-draft?_partial=1"):
                self.assertEqual(app.client.get(path).headers["cache-control"], "private, no-store", path)

    def test_media_route_serves_object_storage_assets(self) -> None:
        with managed_test_app() as app:
            app.storage.put("images/test.webp", b"test-image-bytes", "image/webp")
            response = app.client.get("/media/images/test.webp")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"test-image-bytes")
        self.assertEqual(response.headers["content-type"], "image/webp")
        self.assertEqual(response.headers["accept-ranges"], "bytes")
        self.assertEqual(response.headers["access-control-allow-origin"], "*")

    def test_media_route_supports_range_requests(self) -> None:
        with managed_test_app() as app:
            app.storage.put("images/test.webp", b"test-image-bytes", "image/webp")
            response = app.client.get(
                "/media/images/test.webp", headers={"range": "bytes=0-3"}
            )

        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.content, b"test")
        self.assertEqual(response.headers["content-range"], "bytes 0-3/16")

    def test_media_route_rejects_non_public_prefixes(self) -> None:
        with managed_test_app() as app:
            app.storage.put("content/about.md")
            response = app.client.get("/media/content/about.md")

        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()

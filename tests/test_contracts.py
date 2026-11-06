"""The formats Python shares with the TypeScript frontend; tests/frontend reads the same fixtures."""
import base64
import json
import unittest
from pathlib import Path

from bs4 import BeautifulSoup

from cms.markdown import markdown_to_html
from cms.projects import validate_slug
from tests.support import managed_test_app

FIXTURES = Path(__file__).parent / "fixtures"


class BlockFormatTests(unittest.TestCase):
    def setUp(self) -> None:
        self.html = markdown_to_html((FIXTURES / "block-format.md").read_text(encoding="utf-8"))

    def test_each_marker_renders_as_its_block(self) -> None:
        self.assertEqual(self.html.count('class="content-block'), 6)
        self.assertIn('<div class="content-col content-col-left"><p>Left column</p></div>', self.html)
        self.assertIn('<div class="content-col content-col-right"><p>Right column</p></div>', self.html)
        self.assertIn('class="html-block-sandbox"', self.html)
        self.assertIn('style="height: 240px"', self.html)
        self.assertIn('<div style="text-align: center">', self.html)
        self.assertNotIn("<!--", self.html)


class SlugTests(unittest.TestCase):
    def test_slug_rules(self) -> None:
        cases = json.loads((FIXTURES / "slugs.json").read_text(encoding="utf-8"))
        for slug in cases["valid"]:
            self.assertTrue(validate_slug(slug), slug)
        for slug in cases["invalid"]:
            self.assertFalse(validate_slug(slug), slug)


CONTRACT_PROJECT = """---
name: Contract Project
slug: contract-project
date: 2024-01-15
draft: false
pinned: false
video:
  hls: https://media.test/contract/master.m3u8
  thumbnail: https://media.test/contract/poster.webp
  spriteSheet: https://media.test/contract/sprite.webp
  frames: 60
  columns: 5
  rows: 12
  frame_width: 320
  frame_height: 180
  video_width: 1920
  video_height: 1080
---

<video src="https://media.test/contract/inline.mp4" loop muted></video>

<!-- block -->

<!-- html -->
<p>caf\u00e9</p>
<!-- /html -->
"""


class FrontendMarkupTests(unittest.TestCase):
    """The markup the frontend reads. tests/frontend builds its fixtures against the same list."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.contract = json.loads((FIXTURES / "frontend-contract.json").read_text(encoding="utf-8"))

    def assert_contract(self, html: str, selectors: list[str]) -> BeautifulSoup:
        soup = BeautifulSoup(html, "html.parser")
        for selector in selectors:
            self.assertTrue(soup.select(selector), f"rendered page has nothing matching {selector}")
        return soup

    def test_homepage_and_detail_fragment_carry_what_the_frontend_reads(self) -> None:
        with managed_test_app() as app:
            (app.projects_dir / "contract-project.md").write_text(CONTRACT_PROJECT, encoding="utf-8")

            self.assert_contract(app.client.get("/").text, self.contract["homepage"])
            self.assert_contract(app.client.get("/contract-project").text, self.contract["homepage"])

            fragment = app.client.get("/contract-project?_partial=1")
            soup = self.assert_contract(fragment.text, self.contract["detailFragment"])
            self.assertNotIn("<html", fragment.text)
            encoded = soup.select_one(".html-block-sandbox")["data-html-b64"]
            self.assertIn("caf\u00e9", base64.b64decode(encoded).decode("utf-8"))

            app.login()
            self.assert_contract(app.client.get("/").text, self.contract["homepageForEditors"])

    def test_each_page_loads_its_own_versioned_assets(self) -> None:
        with managed_test_app() as app:
            homepage = app.client.get("/").text
            self.assertIn("build/homepage.js", homepage)
            self.assertNotIn("build/project.js", homepage)

            point_cloud = app.client.get("/test").text
            self.assertIn("build/project.js", point_cloud)
            self.assertIn("build/project.css", point_cloud)
            self.assertNotIn("build/homepage.js", point_cloud)
            self.assertRegex(point_cloud, r"/static/test/test-page\.js\?v=\d+")

            valentine = app.client.get("/will-you-be-my-valentine").text
            self.assertRegex(valentine, r"/static/valentine/valentine\.js\?v=\d+")


if __name__ == "__main__":
    unittest.main()

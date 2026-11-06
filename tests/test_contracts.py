"""The formats Python shares with the TypeScript editor; tests/frontend reads the same fixtures."""
import json
import unittest
from pathlib import Path

from cms.markdown import markdown_to_html
from cms.projects import validate_slug

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


if __name__ == "__main__":
    unittest.main()

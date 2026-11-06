"""The about page: content/about.md."""
from __future__ import annotations

from dataclasses import dataclass
from functools import cached_property

from cms.documents import read_document, write_document
from cms.markdown import markdown_to_html
from cms.paths import get_content_paths


@dataclass(frozen=True)
class About:
    markdown: str = ""
    revision: str | None = None

    @cached_property
    def html(self) -> str:
        return markdown_to_html(self.markdown) if self.markdown else ""


def load_about() -> About:
    document = read_document(get_content_paths().about_file)
    return About(document.markdown, document.revision) if document else About()


def save_about(markdown_content: str) -> bool:
    return write_document(get_content_paths().about_file, {"title": "About"}, markdown_content)

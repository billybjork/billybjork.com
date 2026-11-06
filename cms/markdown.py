"""
Server-side rendering of the editor's block markdown.

The block markers (`<!-- block -->`, `<!-- row -->`, `<!-- col -->`,
`<!-- html -->`, `<!-- align:* -->`) are a format shared with
static/ts/edit/blocks.ts. tests/fixtures/block-format.md pins it from both sides.
"""
from __future__ import annotations

import base64
import re
from functools import lru_cache
from html import escape

import markdown
from bs4 import BeautifulSoup
from markdown.extensions.fenced_code import FencedCodeExtension
from markdown.extensions.tables import TableExtension


def _process_html_blocks(content: str) -> str:
    """Replace html blocks with base64 placeholders for the frontend's sandboxed iframes."""
    pattern = r'<!--\s*html(?:\s+style="([^"]*)")?\s*-->\s*\n?(.*?)\n?\s*<!--\s*/html\s*-->'

    def replace(match):
        style = (match.group(1) or "").replace("&quot;", '"').strip()
        encoded = base64.b64encode(match.group(2).encode("utf-8")).decode("ascii")
        style_attr = f' style="{escape(style, quote=True)}"' if style else ""
        return f'<div class="html-block-sandbox" data-html-b64="{encoded}"{style_attr}></div>'

    return re.sub(pattern, replace, content, flags=re.DOTALL)


def _strip_layout_markers(md_content: str) -> str:
    return re.sub(r"<!--\s*/?(row|col)\s*-->", "", md_content)


def _split_blocks(md_content: str) -> list[str]:
    parts = re.split(r"\n+\s*<!--\s*block\s*-->\s*\n+", md_content)
    return [part for part in parts if part.strip()]


def _parse_row_block(md_block: str) -> tuple[str, str] | None:
    stripped = md_block.strip()
    if not re.match(r"^\s*<!--\s*row\s*-->\s*", stripped) or not re.search(
        r"<!--\s*/row\s*-->\s*$", stripped
    ):
        return None

    inner = re.sub(r"^\s*<!--\s*row\s*-->\s*", "", stripped, count=1)
    inner = re.sub(r"\s*<!--\s*/row\s*-->\s*$", "", inner, count=1)
    columns = re.split(r"\n*\s*<!--\s*col\s*-->\s*\n*", inner, maxsplit=1)
    if len(columns) != 2:
        return None
    return columns[0].strip(), columns[1].strip()


def _convert_alignment_comments(html_content: str) -> str:
    html_content = re.sub(
        r"<!-- align:(center|right) -->", r'<div style="text-align: \1">', html_content
    )
    return re.sub(r"<!-- /align -->", "</div>", html_content)


def _optimize_media_loading(html_content: str) -> str:
    """Lazy-load body media; videos hand their sources to the frontend via data-src."""
    if not any(tag in html_content for tag in ("<img", "<iframe", "<video")):
        return html_content

    soup = BeautifulSoup(html_content, "html.parser")

    for image in soup.find_all("img"):
        image.attrs.setdefault("loading", "lazy")
        image.attrs.setdefault("decoding", "async")

    for iframe in soup.find_all("iframe"):
        iframe.attrs.setdefault("loading", "lazy")

    for video in soup.find_all("video"):
        classes = list(video.get("class", []))
        if "lazy-video" not in classes:
            classes.append("lazy-inline-video")
        video["class"] = classes
        video["preload"] = "none"

        for element in (video, *video.find_all("source")):
            if element.get("src"):
                element["data-src"] = element["src"]
                del element["src"]

    return str(soup)


def _render_block(md_content: str, renderer: markdown.Markdown) -> str:
    source = _strip_layout_markers(_process_html_blocks(md_content))
    renderer.reset()
    html = _convert_alignment_comments(renderer.convert(source)).strip()
    return _optimize_media_loading(html).strip()


@lru_cache(maxsize=512)
def markdown_to_html(md_content: str) -> str:
    renderer = markdown.Markdown(
        extensions=[
            FencedCodeExtension(),
            TableExtension(),
            "nl2br",
            "sane_lists",
            "smarty",
            "toc",
        ]
    )

    rendered: list[str] = []
    for block in _split_blocks(md_content) or [md_content]:
        columns = _parse_row_block(block)
        if columns:
            left_html = _render_block(columns[0], renderer)
            right_html = _render_block(columns[1], renderer)
            rendered.append(
                '<div class="content-block content-block-row">'
                '<div class="content-row">'
                f'<div class="content-col content-col-left">{left_html}</div>'
                f'<div class="content-col content-col-right">{right_html}</div>'
                "</div>"
                "</div>"
            )
            continue

        html = _render_block(block, renderer)
        if html:
            rendered.append(f'<div class="content-block">{html}</div>')

    return "\n".join(rendered)


def html_excerpt(html_content: str, word_limit: int = 25) -> str:
    """The first words of rendered HTML as plain text, for meta descriptions and feeds."""
    if not html_content:
        return ""
    words = BeautifulSoup(html_content, "lxml").get_text(separator=" ", strip=True).split()
    snippet = " ".join(words[:word_limit])
    return f"{snippet}..." if len(words) > word_limit else snippet

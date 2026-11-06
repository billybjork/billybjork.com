"""Markdown files with YAML frontmatter: reading (cached by stat), writing, and syncing."""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

import yaml

from cms import sync
from object_storage import is_object_storage_configured, rewrite_public_urls_in_text


class ArchiveFailed(Exception):
    """The safety copy could not be written, so the document was left in place."""


def _date_representer(dumper, data):
    return dumper.represent_scalar("tag:yaml.org,2002:str", data.isoformat())


yaml.add_representer(date, _date_representer)
yaml.add_representer(datetime, _date_representer)


@dataclass(frozen=True)
class Document:
    frontmatter: dict
    markdown: str
    revision: str


_cache: dict[Path, tuple[tuple[int, int], Document]] = {}


def _parse_frontmatter(content: str) -> tuple[dict, str]:
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", content, re.DOTALL)
    if not match:
        return {}, content
    try:
        return yaml.safe_load(match.group(1)) or {}, match.group(2)
    except yaml.YAMLError:
        return {}, match.group(2)


def read_document(path: Path) -> Document | None:
    """The file's parsed content with managed asset URLs rewritten to the current host."""
    try:
        stat = path.stat()
    except FileNotFoundError:
        _cache.pop(path, None)
        return None

    fingerprint = (stat.st_mtime_ns, stat.st_size)
    cached = _cache.get(path)
    if cached and cached[0] == fingerprint:
        return cached[1]

    raw = path.read_bytes()
    frontmatter, markdown_content = _parse_frontmatter(raw.decode("utf-8").replace("\r\n", "\n"))
    document = Document(
        frontmatter=frontmatter,
        markdown=rewrite_public_urls_in_text(markdown_content),
        revision="sha256:" + hashlib.sha256(raw).hexdigest()[:16],
    )
    _cache[path] = (fingerprint, document)
    return document


def write_document(path: Path, frontmatter: dict, markdown_content: str) -> bool:
    """False when object storage is configured but the upload failed: the next deploy loses the write."""
    frontmatter_text = yaml.dump(
        frontmatter, default_flow_style=False, allow_unicode=True, sort_keys=False
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"---\n{frontmatter_text}---\n\n{markdown_content}", encoding="utf-8")
    _cache.pop(path, None)
    return sync.sync_to_object_storage(path) or not is_object_storage_configured()


def archive_document(path: Path) -> None:
    """Copy to the archive as a safety net. Raises ArchiveFailed; without object storage there is no archive."""
    if is_object_storage_configured() and not sync.archive_to_object_storage(path):
        raise ArchiveFailed(path.name)


def remove_document(path: Path) -> None:
    path.unlink()
    _cache.pop(path, None)
    sync.delete_from_object_storage(path)


def delete_document(path: Path) -> None:
    """Archive, then remove from both places. A failed archive stops the delete."""
    archive_document(path)
    remove_document(path)

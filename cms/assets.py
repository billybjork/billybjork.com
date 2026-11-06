"""The registry of uploaded assets (content/assets.json) and orphan cleanup in object storage."""
import hashlib
import json
import logging
import re
from pathlib import Path
from typing import Iterable
from urllib.parse import unquote

from cms import sync
from cms.paths import get_content_paths
from media.keys import hero_set
from object_storage import delete_object, extract_public_asset_urls, list_keys, object_keys

logger = logging.getLogger(__name__)

# Matched in raw text, whatever the host: hero folder names can hold commas and percent escapes.
_HERO_MANIFEST = re.compile(r"videos/[^\s\"'<>]+?\.m3u8")


def _load_registry() -> dict:
    assets_file = get_content_paths().assets_file
    if not assets_file.exists():
        return {"version": 1, "assets": {}}
    return json.loads(assets_file.read_text(encoding="utf-8"))


def _save_registry(registry: dict) -> None:
    paths = get_content_paths()
    paths.content_dir.mkdir(parents=True, exist_ok=True)
    paths.assets_file.write_text(json.dumps(registry, indent=2), encoding="utf-8")
    sync.sync_to_object_storage(paths.assets_file)


def compute_hash(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def find_by_hash(content_hash: str) -> str | None:
    """The object key of an already-registered asset with this content."""
    for object_key, asset_info in _load_registry().get("assets", {}).items():
        if asset_info.get("hash") == content_hash:
            return object_key
    return None


def register_asset(object_key: str, content_hash: str, size: int) -> None:
    registry = _load_registry()
    registry["assets"][object_key] = {"hash": content_hash, "size": size}
    _save_registry(registry)


def _unregister_asset(object_key: str) -> None:
    registry = _load_registry()
    if object_key in registry.get("assets", {}):
        del registry["assets"][object_key]
        _save_registry(registry)


def _content_files() -> list[Path]:
    paths = get_content_paths()
    files = [paths.about_file, paths.settings_file]
    if paths.projects_dir.exists():
        files.extend(paths.projects_dir.glob("*.md"))
    return [path for path in files if path.exists()]


def _referenced_keys() -> set[str]:
    """Object keys referenced by any content file."""
    keys: set[str] = set()
    for path in _content_files():
        keys |= object_keys(extract_public_asset_urls(path.read_text(encoding="utf-8")))
    return keys


def _referenced_hero_sets() -> set[str]:
    """The hero sets (see media.keys.hero_set) any content file points at, under either spelling of a URL."""
    sets: set[str] = set()
    for path in _content_files():
        for manifest in _HERO_MANIFEST.findall(path.read_text(encoding="utf-8")):
            sets |= {hero_set(manifest), hero_set(unquote(manifest))}
    return sets - {None}


def cleanup_orphans(keys_to_check: set[str]) -> list[str]:
    """Delete the given keys that no content references."""
    if not keys_to_check:
        return []

    referenced = _referenced_keys()
    hero_sets = _referenced_hero_sets()
    deleted = []
    for key in keys_to_check - referenced:
        if hero_set(key) not in hero_sets and delete_object(key):
            _unregister_asset(key)
            deleted.append(key)
            logger.info("Deleted orphaned asset: %s", key)
    return deleted


def cleanup_hero_folders(folders: Iterable[str], live_hero_sets: Iterable[str] = ()) -> list[str]:
    """Delete files under these `videos/<folder>/` prefixes that no content references.

    References, not paths, decide: a project keeps its hero folder through a rename, and 58
    projects have one that never matched their slug. `live_hero_sets` are encodes in progress,
    which no content can reference yet. Best-effort: a failure must not fail the triggering edit.
    """
    keep = _referenced_hero_sets() | set(live_hero_sets)
    prefixes = {spelling for folder in folders for spelling in (folder, unquote(folder))}
    deleted = []
    for prefix in prefixes:
        try:
            for key in list_keys(prefix):
                if hero_set(key) not in keep and delete_object(key):
                    deleted.append(key)
                    logger.info("Deleted hero video file: %s", key)
        except Exception:
            logger.exception("Error deleting object-storage keys under %s", prefix)
    return deleted

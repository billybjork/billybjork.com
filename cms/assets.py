"""The registry of uploaded assets (content/assets.json) and orphan cleanup in object storage."""
import hashlib
import json
import logging
import re
from typing import Callable

from cms import sync
from cms.paths import get_content_paths
from media.keys import hero_root
from object_storage import delete_object, extract_public_asset_urls, list_keys, object_keys

logger = logging.getLogger(__name__)


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


def _referenced_keys() -> set[str]:
    """Object keys referenced by any content file."""
    paths = get_content_paths()
    files = [paths.about_file, paths.settings_file]
    if paths.projects_dir.exists():
        files.extend(paths.projects_dir.glob("*.md"))

    keys: set[str] = set()
    for path in files:
        if path.exists():
            keys |= object_keys(extract_public_asset_urls(path.read_text(encoding="utf-8")))
    return keys


def cleanup_orphans(keys_to_check: set[str]) -> list[str]:
    """Delete the given keys that no content references."""
    if not keys_to_check:
        return []

    referenced = _referenced_keys()
    deleted = []
    for key in keys_to_check - referenced:
        if delete_object(key):
            _unregister_asset(key)
            deleted.append(key)
            logger.info("Deleted orphaned asset: %s", key)
    return deleted


def _delete_keys_under(prefix: str, should_delete: Callable[[str], bool]) -> list[str]:
    """Best-effort: a listing failure is logged and must not fail the edit that triggered it."""
    deleted = []
    try:
        for key in list_keys(prefix):
            if should_delete(key) and delete_object(key):
                deleted.append(key)
                logger.info("Deleted hero video file: %s", key)
    except Exception:
        logger.exception("Error deleting object-storage keys under %s", prefix)
    return deleted


def delete_hero_videos(project_slug: str) -> list[str]:
    return _delete_keys_under(f"{hero_root(project_slug)}/", lambda _key: True)


def cleanup_old_hero_versions(project_slug: str, current_hls_url: str | None) -> list[str]:
    """Delete every HLS version under the project except the one current_hls_url points at.

    Files directly under the root predate versioned paths; they go only when no
    version is current.
    """
    root = hero_root(project_slug)
    current = re.search(rf"/{re.escape(root)}/(\d+)/", current_hls_url or "")
    current_version = current.group(1) if current else None

    def is_stale(key: str) -> bool:
        version = re.match(rf"{re.escape(root)}/(\d+)/", key)
        return version.group(1) != current_version if version else current_version is None

    return _delete_keys_under(f"{root}/", is_stale)

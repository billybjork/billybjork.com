"""
Asset registry and object-storage cleanup helpers.
"""
import hashlib
import json
import logging
from typing import Optional

logger = logging.getLogger(__name__)

from .content import get_content_paths
from .media_paths import hero_hls_prefix
from .object_storage import (
    delete_file,
    extract_object_key,
    get_bucket_name,
    get_object_storage_client,
    managed_public_base_urls,
)

__all__ = [
    "compute_hash",
    "find_by_hash",
    "register_asset",
    "extract_object_key",
    "extract_public_asset_urls",
    "cleanup_orphans",
    "delete_video_prefix",
    "cleanup_old_hls_versions",
]


def _load_registry() -> dict:
    """Load the asset registry from disk."""
    assets_file = get_content_paths().assets_file
    if not assets_file.exists():
        return {"version": 1, "assets": {}}

    with open(assets_file, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_registry(registry: dict) -> None:
    """Save the asset registry to disk and sync to object storage."""
    content_paths = get_content_paths()
    content_paths.content_dir.mkdir(parents=True, exist_ok=True)
    with open(content_paths.assets_file, "w", encoding="utf-8") as f:
        json.dump(registry, f, indent=2)

    try:
        from .content_sync import sync_to_object_storage

        sync_to_object_storage(content_paths.assets_file)
    except Exception:
        logger.exception(
            "Best-effort object-storage sync failed for %s",
            content_paths.assets_file,
        )


def compute_hash(data: bytes) -> str:
    """
    Compute SHA-256 hash of content.

    Args:
        data: File content as bytes

    Returns:
        Hash string prefixed with 'sha256:'
    """
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def find_by_hash(content_hash: str) -> Optional[str]:
    """
    Check if an asset with the same hash exists.

    Args:
        content_hash: Hash to look up

    Returns:
        Object key if found, None otherwise
    """
    registry = _load_registry()
    for object_key, asset_info in registry.get("assets", {}).items():
        if asset_info.get("hash") == content_hash:
            return object_key
    return None


def register_asset(object_key: str, content_hash: str, size: int) -> None:
    """
    Add an asset to the registry.

    Args:
        object_key: Object key (path within bucket)
        content_hash: Hash of the content
        size: File size in bytes
    """
    registry = _load_registry()
    registry["assets"][object_key] = {
        "hash": content_hash,
        "size": size,
    }
    _save_registry(registry)


def unregister_asset(object_key: str) -> bool:
    """
    Remove an asset from the registry.

    Args:
        object_key: Object key to remove

    Returns:
        True if asset was found and removed
    """
    registry = _load_registry()
    if object_key in registry.get("assets", {}):
        del registry["assets"][object_key]
        _save_registry(registry)
        return True
    return False


def extract_public_asset_urls(content: str) -> set[str]:
    """Extract known managed public URLs from arbitrary text content."""
    matches: set[str] = set()
    if not content:
        return matches

    for base_url in managed_public_base_urls():
        prefix = f"{base_url}/"
        start = 0
        while True:
            index = content.find(prefix, start)
            if index == -1:
                break
            end = index + len(prefix)
            while end < len(content) and content[end] not in {
                '"',
                "'",
                "<",
                ">",
                " ",
                "\n",
                "\r",
                "\t",
                ")",
                ",",
                "]",
                "}",
            }:
                end += 1
            matches.add(content[index:end])
            start = end

    return matches


def scan_all_references() -> set[str]:
    """
    Scan all content files for managed public asset URLs.

    Returns:
        Set of object keys that are referenced in content
    """
    content_paths = get_content_paths()
    referenced_keys = set()

    # Scan all project files
    if content_paths.projects_dir.exists():
        for filepath in content_paths.projects_dir.glob("*.md"):
            with open(filepath, "r", encoding="utf-8") as f:
                content = f.read()
            for url in extract_public_asset_urls(content):
                key = extract_object_key(url)
                if key:
                    referenced_keys.add(key)

    # Scan about page
    if content_paths.about_file.exists():
        with open(content_paths.about_file, "r", encoding="utf-8") as f:
            content = f.read()
        for url in extract_public_asset_urls(content):
            key = extract_object_key(url)
            if key:
                referenced_keys.add(key)

    # Scan settings (for about photo)
    if content_paths.settings_file.exists():
        with open(content_paths.settings_file, "r", encoding="utf-8") as f:
            content = f.read()
        for url in extract_public_asset_urls(content):
            key = extract_object_key(url)
            if key:
                referenced_keys.add(key)

    return referenced_keys


def cleanup_orphans(keys_to_check: set[str]) -> list[str]:
    """
    Delete object-storage keys that are not referenced anywhere.

    Args:
        keys_to_check: Set of object keys to potentially delete

    Returns:
        List of keys that were deleted
    """
    if not keys_to_check:
        return []

    # Get all currently referenced keys
    all_refs = scan_all_references()

    deleted = []
    for key in keys_to_check:
        if key not in all_refs:
            # Not referenced anywhere, safe to delete
            if delete_file(key):
                unregister_asset(key)
                deleted.append(key)
                logger.info("Deleted orphaned asset: %s", key)

    return deleted


def delete_video_prefix(project_slug: str) -> list[str]:
    """
    Delete all files under a project's video prefix.

    Paginates through list_objects_v2 to handle prefixes with >1000 keys
    (common for long videos with multiple HLS resolution variants).

    Args:
        project_slug: Project slug

    Returns:
        List of keys that were deleted
    """
    from .content import validate_slug

    if not validate_slug(project_slug):
        raise ValueError(f"Invalid slug: {project_slug}")
    prefix = f"{hero_hls_prefix(project_slug)}/"

    try:
        client = get_object_storage_client()
        deleted = []
        continuation_token = None

        while True:
            kwargs = {"Bucket": get_bucket_name(), "Prefix": prefix}
            if continuation_token:
                kwargs["ContinuationToken"] = continuation_token

            response = client.list_objects_v2(**kwargs)

            for obj in response.get("Contents", []):
                key = obj["Key"]
                if delete_file(key):
                    deleted.append(key)
                    logger.info("Deleted video file: %s", key)

            if not response.get("IsTruncated"):
                break
            continuation_token = response.get("NextContinuationToken")

        return deleted
    except Exception as e:
        logger.exception("Error deleting video prefix: %s", prefix)
        return []


def cleanup_old_hls_versions(project_slug: str, current_hls_url: Optional[str]) -> list[str]:
    """
    Delete old HLS versions, keeping only the current one.

    With versioned HLS paths (videos/{slug}/{version}/), this function
    deletes all versions except the one referenced by current_hls_url.

    Args:
        project_slug: Project slug
        current_hls_url: The current HLS URL to keep (or None to delete all)

    Returns:
        List of keys that were deleted
    """
    from .content import validate_slug
    import re

    if not validate_slug(project_slug):
        raise ValueError(f"Invalid slug: {project_slug}")

    # Extract current version from URL if provided
    # URL format: https://domain/videos/{slug}/{version}/master.m3u8
    current_version = None
    if current_hls_url:
        match = re.search(rf'/videos/{re.escape(project_slug)}/(\d+)/', current_hls_url)
        if match:
            current_version = match.group(1)

    prefix = f"videos/{project_slug}/"

    try:
        client = get_object_storage_client()
        deleted = []
        continuation_token = None

        while True:
            kwargs = {"Bucket": get_bucket_name(), "Prefix": prefix}
            if continuation_token:
                kwargs["ContinuationToken"] = continuation_token

            response = client.list_objects_v2(**kwargs)

            for obj in response.get("Contents", []):
                key = obj["Key"]
                # Extract version from key: videos/{slug}/{version}/...
                key_match = re.match(rf'videos/{re.escape(project_slug)}/(\d+)/', key)
                if key_match:
                    key_version = key_match.group(1)
                    if key_version != current_version:
                        # This is an old version, delete it
                        if delete_file(key):
                            deleted.append(key)
                            logger.info("Deleted old HLS version: %s", key)
                elif current_version is None:
                    # No current version specified and this is a non-versioned file
                    # (legacy format: videos/{slug}/master.m3u8)
                    if delete_file(key):
                        deleted.append(key)
                        logger.info("Deleted legacy HLS file: %s", key)

            if not response.get("IsTruncated"):
                break
            continuation_token = response.get("NextContinuationToken")

        return deleted
    except Exception as e:
        logger.exception("Error cleaning up old HLS versions for: %s", project_slug)
        return []


extract_s3_key = extract_object_key
extract_cloudfront_urls = extract_public_asset_urls

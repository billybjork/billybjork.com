"""
Asset Registry Module
Handles S3 asset deduplication and orphan cleanup.
"""
import hashlib
import json
import logging
import re
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

from .media_paths import hero_hls_prefix
from .s3 import CLOUDFRONT_DOMAIN, S3_BUCKET, delete_file, get_s3_client

__all__ = [
    "compute_hash",
    "find_by_hash",
    "register_asset",
    "extract_s3_key",
    "extract_cloudfront_urls",
    "cleanup_orphans",
    "delete_video_prefix",
]

# Asset registry file
CONTENT_DIR = Path(__file__).parent.parent / "content"
ASSETS_FILE = CONTENT_DIR / "assets.json"

# CloudFront URL pattern
CLOUDFRONT_PATTERN = re.compile(
    rf'https?://{re.escape(CLOUDFRONT_DOMAIN)}/([^\s"\'<>\)]+)'
)


def _load_registry() -> dict:
    """Load the asset registry from disk."""
    if not ASSETS_FILE.exists():
        return {"version": 1, "assets": {}}

    with open(ASSETS_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def _save_registry(registry: dict) -> None:
    """Save the asset registry to disk."""
    CONTENT_DIR.mkdir(parents=True, exist_ok=True)
    with open(ASSETS_FILE, "w", encoding="utf-8") as f:
        json.dump(registry, f, indent=2)


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
        S3 key if found, None otherwise
    """
    registry = _load_registry()
    for s3_key, asset_info in registry.get("assets", {}).items():
        if asset_info.get("hash") == content_hash:
            return s3_key
    return None


def register_asset(s3_key: str, content_hash: str, size: int) -> None:
    """
    Add an asset to the registry.

    Args:
        s3_key: S3 key (path within bucket)
        content_hash: Hash of the content
        size: File size in bytes
    """
    registry = _load_registry()
    registry["assets"][s3_key] = {
        "hash": content_hash,
        "size": size,
    }
    _save_registry(registry)


def unregister_asset(s3_key: str) -> bool:
    """
    Remove an asset from the registry.

    Args:
        s3_key: S3 key to remove

    Returns:
        True if asset was found and removed
    """
    registry = _load_registry()
    if s3_key in registry.get("assets", {}):
        del registry["assets"][s3_key]
        _save_registry(registry)
        return True
    return False


def extract_s3_key(cloudfront_url: str) -> Optional[str]:
    """
    Extract S3 key from a CloudFront URL.

    Args:
        cloudfront_url: Full CloudFront URL

    Returns:
        S3 key or None if not a valid CloudFront URL
    """
    match = CLOUDFRONT_PATTERN.match(cloudfront_url)
    if match:
        return match.group(1)
    return None


def extract_cloudfront_urls(content: str) -> set[str]:
    """
    Extract all CloudFront URLs from content.

    Args:
        content: Markdown or other text content

    Returns:
        Set of CloudFront URLs found
    """
    return set(
        f"https://{CLOUDFRONT_DOMAIN}/{match}"
        for match in CLOUDFRONT_PATTERN.findall(content)
    )


def scan_all_references() -> set[str]:
    """
    Scan all markdown files for CloudFront URLs.

    Returns:
        Set of S3 keys that are referenced in content
    """
    from .content import CONTENT_DIR, PROJECTS_DIR, ABOUT_FILE, SETTINGS_FILE

    referenced_keys = set()

    # Scan all project files
    if PROJECTS_DIR.exists():
        for filepath in PROJECTS_DIR.glob("*.md"):
            with open(filepath, "r", encoding="utf-8") as f:
                content = f.read()
            for url in extract_cloudfront_urls(content):
                key = extract_s3_key(url)
                if key:
                    referenced_keys.add(key)

    # Scan about page
    if ABOUT_FILE.exists():
        with open(ABOUT_FILE, "r", encoding="utf-8") as f:
            content = f.read()
        for url in extract_cloudfront_urls(content):
            key = extract_s3_key(url)
            if key:
                referenced_keys.add(key)

    # Scan settings (for about photo)
    if SETTINGS_FILE.exists():
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            content = f.read()
        for url in extract_cloudfront_urls(content):
            key = extract_s3_key(url)
            if key:
                referenced_keys.add(key)

    return referenced_keys


def cleanup_orphans(keys_to_check: set[str]) -> list[str]:
    """
    Delete S3 keys that are not referenced anywhere.

    Args:
        keys_to_check: Set of S3 keys to potentially delete

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
        s3 = get_s3_client()
        deleted = []
        continuation_token = None

        while True:
            kwargs = {"Bucket": S3_BUCKET, "Prefix": prefix}
            if continuation_token:
                kwargs["ContinuationToken"] = continuation_token

            response = s3.list_objects_v2(**kwargs)

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

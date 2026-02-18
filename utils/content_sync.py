"""
Content Sync — S3-backed persistence for the file-based CMS.

On every content save, the file is also uploaded to S3 so edits
survive ephemeral container redeployments.  On app startup,
sync_from_s3() pulls the latest content back to the local filesystem.

Uses the same S3 client, bucket, and credentials as media uploads.
"""
import logging
from pathlib import Path
from pathlib import PurePosixPath

from .s3 import S3_BUCKET, get_s3_client

logger = logging.getLogger(__name__)

CONTENT_DIR = Path(__file__).parent.parent / "content"
S3_CONTENT_PREFIX = "content/"

# Archive prefix for soft-deleted projects
S3_ARCHIVE_PREFIX = "content-archive/"


def sync_to_s3(local_path: Path) -> None:
    """Upload a single content file to S3 after a local write."""
    try:
        relative = local_path.relative_to(CONTENT_DIR)
        s3_key = f"{S3_CONTENT_PREFIX}{relative}"

        s3 = get_s3_client()
        with open(local_path, "rb") as f:
            s3.upload_fileobj(
                f,
                S3_BUCKET,
                s3_key,
                ExtraArgs={"ContentType": _content_type(local_path)},
            )
        logger.info("Synced to S3: %s", s3_key)
    except Exception:
        logger.exception("Failed to sync %s to S3", local_path)


def delete_from_s3(local_path: Path) -> None:
    """Delete a content file from S3 (e.g. after project deletion)."""
    try:
        relative = local_path.relative_to(CONTENT_DIR)
        s3_key = f"{S3_CONTENT_PREFIX}{relative}"

        s3 = get_s3_client()
        s3.delete_object(Bucket=S3_BUCKET, Key=s3_key)
        logger.info("Deleted from S3: %s", s3_key)
    except Exception:
        logger.exception("Failed to delete %s from S3", local_path)


def archive_to_s3(local_path: Path) -> None:
    """Archive a content file to S3 before deletion (safety net)."""
    try:
        from datetime import datetime

        relative = local_path.relative_to(CONTENT_DIR)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        s3_key = f"{S3_ARCHIVE_PREFIX}{relative.stem}_{timestamp}{relative.suffix}"

        s3 = get_s3_client()
        with open(local_path, "rb") as f:
            s3.upload_fileobj(
                f,
                S3_BUCKET,
                s3_key,
                ExtraArgs={"ContentType": _content_type(local_path)},
            )
        logger.info("Archived to S3: %s", s3_key)
    except Exception:
        logger.exception("Failed to archive %s to S3", local_path)


def sync_from_s3() -> int:
    """Download all content files from S3 to local filesystem.

    Called on app startup so the container has the latest content
    even after a redeploy.

    Returns:
        Number of files synced.
    """
    s3 = get_s3_client()
    synced = 0

    try:
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=S3_CONTENT_PREFIX):
            for obj in page.get("Contents", []):
                s3_key = obj["Key"]
                relative = s3_key[len(S3_CONTENT_PREFIX):]
                local_path = _safe_local_content_path(relative)
                if not local_path:
                    continue

                local_path.parent.mkdir(parents=True, exist_ok=True)

                s3.download_file(S3_BUCKET, s3_key, str(local_path))
                synced += 1

        if synced:
            logger.info("Synced %d file(s) from S3 to %s", synced, CONTENT_DIR)
    except Exception:
        logger.exception("S3 content sync failed")

    return synced


def _content_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".md":
        return "text/markdown; charset=utf-8"
    if suffix == ".json":
        return "application/json; charset=utf-8"
    return "application/octet-stream"


def _safe_local_content_path(relative_key: str) -> Path | None:
    """Map an S3 key suffix to a safe local path under CONTENT_DIR."""
    if not relative_key:
        return None

    # Skip directory placeholders
    if relative_key.endswith("/"):
        return None

    # S3 keys are POSIX-style paths; reject traversal or absolute paths.
    pure = PurePosixPath(relative_key)
    if pure.is_absolute() or any(part in ("", ".", "..") for part in pure.parts):
        logger.warning("Skipping unsafe content key: %s", relative_key)
        return None

    local_path = (CONTENT_DIR / Path(*pure.parts)).resolve()
    content_root = CONTENT_DIR.resolve()
    try:
        local_path.relative_to(content_root)
    except ValueError:
        logger.warning("Skipping out-of-root content key: %s", relative_key)
        return None

    return local_path

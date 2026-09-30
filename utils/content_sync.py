"""
Content sync for the file-based CMS using S3-compatible object storage.

On every content save, the file is also uploaded to object storage so edits
survive ephemeral container redeployments. On app startup,
`sync_from_object_storage()` pulls the latest content back to the local
filesystem.
"""
import argparse
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from pathlib import PurePosixPath

from botocore.exceptions import ClientError
from dotenv import load_dotenv

from .content import get_content_paths
from .object_storage import get_bucket_name, get_object_storage_client

logger = logging.getLogger(__name__)

OBJECT_STORAGE_CONTENT_PREFIX = "content/"
OBJECT_STORAGE_CANONICAL_MARKER_KEY = f"{OBJECT_STORAGE_CONTENT_PREFIX}.object-storage-canonical.json"
LEGACY_S3_CANONICAL_MARKER_KEY = f"{OBJECT_STORAGE_CONTENT_PREFIX}.s3-canonical.json"

# Archive prefix for soft-deleted projects
OBJECT_STORAGE_ARCHIVE_PREFIX = "content-archive/"


def sync_to_object_storage(local_path: Path) -> bool:
    """Upload a single content file after a local write."""
    try:
        object_key = local_to_object_storage_key(local_path)

        client = get_object_storage_client()
        with open(local_path, "rb") as f:
            client.upload_fileobj(
                f,
                get_bucket_name(),
                object_key,
                ExtraArgs={"ContentType": _content_type(local_path)},
            )
        logger.info("Synced to object storage: %s", object_key)
        return True
    except Exception:
        logger.exception("Failed to sync %s to object storage", local_path)
        return False


def delete_from_object_storage(local_path: Path) -> bool:
    """Delete a content file from object storage (e.g. after project deletion)."""
    try:
        object_key = local_to_object_storage_key(local_path)

        client = get_object_storage_client()
        client.delete_object(Bucket=get_bucket_name(), Key=object_key)
        logger.info("Deleted from object storage: %s", object_key)
        return True
    except Exception:
        logger.exception("Failed to delete %s from object storage", local_path)
        return False


def archive_to_object_storage(local_path: Path) -> bool:
    """Archive a content file before deletion (safety net)."""
    try:
        from datetime import datetime

        relative = local_path.relative_to(get_content_paths().content_dir)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        object_key = f"{OBJECT_STORAGE_ARCHIVE_PREFIX}{relative.stem}_{timestamp}{relative.suffix}"

        client = get_object_storage_client()
        with open(local_path, "rb") as f:
            client.upload_fileobj(
                f,
                get_bucket_name(),
                object_key,
                ExtraArgs={"ContentType": _content_type(local_path)},
            )
        logger.info("Archived to object storage: %s", object_key)
        return True
    except Exception:
        logger.exception("Failed to archive %s to object storage", local_path)
        return False


def sync_from_object_storage(*, require_marker: bool = False) -> int:
    """Download all content files from object storage to local filesystem.

    Called on app startup so the container has the latest content even after a
    redeploy.

    Returns:
        Number of files synced.
    """
    if require_marker and not has_canonical_marker():
        logger.warning(
            "Skipping startup object-storage content sync: canonical marker missing (%s). "
            "Run `uv run python -m utils.content_sync seed` to establish object storage as source of truth.",
            OBJECT_STORAGE_CANONICAL_MARKER_KEY,
        )
        return 0

    client = get_object_storage_client()
    synced = 0

    try:
        paginator = client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=get_bucket_name(), Prefix=OBJECT_STORAGE_CONTENT_PREFIX):
            for obj in page.get("Contents", []):
                object_key = obj["Key"]
                if _is_metadata_key(object_key):
                    continue
                relative = object_key[len(OBJECT_STORAGE_CONTENT_PREFIX):]
                local_path = _safe_local_content_path(relative)
                if not local_path:
                    continue

                local_path.parent.mkdir(parents=True, exist_ok=True)

                client.download_file(get_bucket_name(), object_key, str(local_path))
                synced += 1

        if synced:
            logger.info(
                "Synced %d file(s) from object storage to %s",
                synced,
                get_content_paths().content_dir,
            )
    except Exception:
        logger.exception("Object-storage content sync failed")

    return synced


def has_canonical_marker() -> bool:
    """Return True if the object-storage canonical marker exists."""
    client = get_object_storage_client()
    for marker_key in (OBJECT_STORAGE_CANONICAL_MARKER_KEY, LEGACY_S3_CANONICAL_MARKER_KEY):
        try:
            client.head_object(Bucket=get_bucket_name(), Key=marker_key)
            return True
        except ClientError as e:
            code = str(e.response.get("Error", {}).get("Code", ""))
            if code in {"404", "NoSuchKey", "NotFound"}:
                continue
            logger.warning("Unable to check canonical marker (%s): %s", marker_key, code)
            return False
    return False


def write_canonical_marker(*, source: str) -> None:
    """Write/update canonical marker indicating object storage is runtime source of truth."""
    client = get_object_storage_client()
    payload = {
        "canonical": "object_storage",
        "content_prefix": OBJECT_STORAGE_CONTENT_PREFIX,
        "source": source,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    client.put_object(
        Bucket=get_bucket_name(),
        Key=OBJECT_STORAGE_CANONICAL_MARKER_KEY,
        Body=json.dumps(payload, indent=2).encode("utf-8"),
        ContentType="application/json; charset=utf-8",
    )
    logger.info("Wrote object-storage canonical marker: %s", OBJECT_STORAGE_CANONICAL_MARKER_KEY)


def local_to_object_storage_key(local_path: Path) -> str:
    """Translate a local content path to its object-storage key."""
    relative = local_path.relative_to(get_content_paths().content_dir)
    return f"{OBJECT_STORAGE_CONTENT_PREFIX}{relative.as_posix()}"


def seed_object_storage_from_local(*, delete_extra: bool = False) -> tuple[int, int]:
    """Upload all local content files and write a canonical marker.

    Returns:
        tuple(uploaded_count, deleted_count)
    """
    uploaded = 0
    deleted = 0
    local_keys: set[str] = set()

    for local_path in _iter_local_content_files():
        object_key = local_to_object_storage_key(local_path)
        if sync_to_object_storage(local_path):
            uploaded += 1
            local_keys.add(object_key)

    write_canonical_marker(source="seed")
    local_keys.add(OBJECT_STORAGE_CANONICAL_MARKER_KEY)

    if delete_extra:
        client = get_object_storage_client()
        paginator = client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=get_bucket_name(), Prefix=OBJECT_STORAGE_CONTENT_PREFIX):
            for obj in page.get("Contents", []):
                object_key = obj["Key"]
                if object_key.endswith("/"):
                    continue
                if object_key not in local_keys:
                    client.delete_object(Bucket=get_bucket_name(), Key=object_key)
                    deleted += 1
                    logger.info("Deleted extra object-storage content key: %s", object_key)

    return uploaded, deleted


def _iter_local_content_files() -> list[Path]:
    """List syncable local content files."""
    content_dir = get_content_paths().content_dir
    if not content_dir.exists():
        return []

    files = []
    for path in content_dir.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(content_dir)
        if any(part.startswith(".") for part in relative.parts):
            continue
        files.append(path)
    files.sort()
    return files


def _is_metadata_key(object_key: str) -> bool:
    return object_key in {OBJECT_STORAGE_CANONICAL_MARKER_KEY, LEGACY_S3_CANONICAL_MARKER_KEY}


def _content_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".md":
        return "text/markdown; charset=utf-8"
    if suffix == ".json":
        return "application/json; charset=utf-8"
    return "application/octet-stream"


def _safe_local_content_path(relative_key: str) -> Path | None:
    """Map an object-storage key suffix to a safe local path under CONTENT_DIR."""
    if not relative_key:
        return None

    # Skip directory placeholders
    if relative_key.endswith("/"):
        return None

    # Object-storage keys are POSIX-style paths; reject traversal or absolute paths.
    pure = PurePosixPath(relative_key)
    if pure.is_absolute() or any(part in ("", ".", "..") for part in pure.parts):
        logger.warning("Skipping unsafe content key: %s", relative_key)
        return None

    content_root = get_content_paths().content_dir.resolve()
    local_path = (content_root / Path(*pure.parts)).resolve()
    try:
        local_path.relative_to(content_root)
    except ValueError:
        logger.warning("Skipping out-of-root content key: %s", relative_key)
        return None

    return local_path


def _main() -> int:
    load_dotenv()

    parser = argparse.ArgumentParser(
        description="Content sync utilities for object-storage-backed CMS content."
    )
    sub = parser.add_subparsers(dest="command", required=True)

    seed = sub.add_parser(
        "seed",
        help="Upload local content/ files and mark object storage as canonical.",
    )
    seed.add_argument(
        "--delete-extra",
        action="store_true",
        help="Delete object-storage content/ keys that do not exist locally.",
    )

    status = sub.add_parser(
        "status",
        help="Show local/object-storage sync status and canonical marker state.",
    )

    args = parser.parse_args()

    if args.command == "seed":
        uploaded, deleted = seed_object_storage_from_local(delete_extra=args.delete_extra)
        print(
            f"Uploaded {uploaded} file(s) to s3://{get_bucket_name()}/{OBJECT_STORAGE_CONTENT_PREFIX}"
        )
        if args.delete_extra:
            print(f"Deleted {deleted} extra object-storage key(s)")
        print(
            f"Canonical marker: s3://{get_bucket_name()}/{OBJECT_STORAGE_CANONICAL_MARKER_KEY}"
        )
        return 0

    if args.command == "status":
        local_count = len(_iter_local_content_files())
        marker = has_canonical_marker()
        print(f"Local content files: {local_count}")
        print(
            f"Object-storage canonical marker ({OBJECT_STORAGE_CANONICAL_MARKER_KEY}): "
            f"{'present' if marker else 'missing'}"
        )
        return 0

    parser.print_help()
    return 1


sync_to_s3 = sync_to_object_storage
delete_from_s3 = delete_from_object_storage
archive_to_s3 = archive_to_object_storage
sync_from_s3 = sync_from_object_storage
local_to_s3_key = local_to_object_storage_key
seed_s3_from_local = seed_object_storage_from_local


if __name__ == "__main__":
    raise SystemExit(_main())

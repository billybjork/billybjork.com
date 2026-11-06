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

from cms.paths import get_content_paths
from object_storage import (
    delete_object,
    get_bucket_name,
    get_object_storage_client,
    list_keys,
)

logger = logging.getLogger(__name__)

OBJECT_STORAGE_CONTENT_PREFIX = "content/"
OBJECT_STORAGE_CANONICAL_MARKER_KEY = f"{OBJECT_STORAGE_CONTENT_PREFIX}.object-storage-canonical.json"
OBJECT_STORAGE_ARCHIVE_PREFIX = "content-archive/"


def _upload(local_path: Path, object_key: str) -> None:
    with open(local_path, "rb") as f:
        get_object_storage_client().upload_fileobj(
            f,
            get_bucket_name(),
            object_key,
            ExtraArgs={"ContentType": _content_type(local_path)},
        )


def sync_to_object_storage(local_path: Path) -> bool:
    """Best-effort: a failed upload is logged, and the local write stands."""
    try:
        _upload(local_path, _object_key(local_path))
        return True
    except Exception:
        logger.exception("Failed to sync %s to object storage", local_path)
        return False


def delete_from_object_storage(local_path: Path) -> bool:
    return delete_object(_object_key(local_path))


def archive_to_object_storage(local_path: Path) -> bool:
    try:
        relative = local_path.relative_to(get_content_paths().content_dir)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        _upload(local_path, f"{OBJECT_STORAGE_ARCHIVE_PREFIX}{relative.stem}_{timestamp}{relative.suffix}")
        return True
    except Exception:
        logger.exception("Failed to archive %s to object storage", local_path)
        return False


def run_startup_sync(policy: str) -> None:
    """off, always, or guarded (only once the canonical marker exists)."""
    if policy == "off":
        logger.info("Startup: content sync from object storage disabled")
        return
    count = sync_from_object_storage(require_marker=policy == "guarded")
    if count:
        logger.info("Startup: synced %d content file(s) from object storage", count)


def sync_from_object_storage(*, require_marker: bool = False) -> int:
    """Make local content match object storage, on app startup after a redeploy.

    Local files the bucket lacks are removed, or a project deleted in the editor
    would return from the image's git copy. A listing with no content files says
    nothing about what should exist, so it removes nothing. Any listing or
    download failure raises before anything is removed.

    Returns:
        Number of files synced.
    """
    if require_marker and not has_canonical_marker():
        logger.warning(
            "Skipping startup object-storage content sync: canonical marker missing (%s). "
            "Run `uv run python -m cms.sync seed` to establish object storage as source of truth.",
            OBJECT_STORAGE_CANONICAL_MARKER_KEY,
        )
        return 0

    client = get_object_storage_client()
    pulled: set[Path] = set()

    for object_key in list_keys(OBJECT_STORAGE_CONTENT_PREFIX):
        relative = object_key[len(OBJECT_STORAGE_CONTENT_PREFIX):]
        local_path = _safe_local_content_path(relative)
        if not local_path:
            continue

        local_path.parent.mkdir(parents=True, exist_ok=True)
        client.download_file(get_bucket_name(), object_key, str(local_path))
        pulled.add(local_path)

    if pulled:
        logger.info(
            "Synced %d file(s) from object storage to %s",
            len(pulled),
            get_content_paths().content_dir,
        )
        for path in _iter_local_content_files():
            if path.resolve() not in pulled:
                path.unlink()
                logger.info("Removed local content file absent from object storage: %s", path)

    return len(pulled)


def has_canonical_marker() -> bool:
    try:
        get_object_storage_client().head_object(
            Bucket=get_bucket_name(), Key=OBJECT_STORAGE_CANONICAL_MARKER_KEY
        )
        return True
    except ClientError as e:
        code = str(e.response.get("Error", {}).get("Code", ""))
        if code not in {"404", "NoSuchKey", "NotFound"}:
            logger.warning("Unable to check canonical marker: %s", code)
        return False


def _write_canonical_marker() -> None:
    client = get_object_storage_client()
    payload = {
        "canonical": "object_storage",
        "content_prefix": OBJECT_STORAGE_CONTENT_PREFIX,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    client.put_object(
        Bucket=get_bucket_name(),
        Key=OBJECT_STORAGE_CANONICAL_MARKER_KEY,
        Body=json.dumps(payload, indent=2).encode("utf-8"),
        ContentType="application/json; charset=utf-8",
    )


def _object_key(local_path: Path) -> str:
    relative = local_path.relative_to(get_content_paths().content_dir)
    return f"{OBJECT_STORAGE_CONTENT_PREFIX}{relative.as_posix()}"


def seed_object_storage_from_local(*, delete_extra: bool = False) -> tuple[int, int]:
    """Upload all local content and write the canonical marker. Returns (uploaded, deleted)."""
    local_files = _iter_local_content_files()
    local_keys = {_object_key(path) for path in local_files}
    uploaded = sum(sync_to_object_storage(path) for path in local_files)
    deleted = 0

    _write_canonical_marker()
    local_keys.add(OBJECT_STORAGE_CANONICAL_MARKER_KEY)

    if delete_extra:
        for object_key in list_keys(OBJECT_STORAGE_CONTENT_PREFIX):
            if object_key not in local_keys and not object_key.endswith("/"):
                delete_object(object_key)
                deleted += 1
                logger.info("Deleted extra object-storage content key: %s", object_key)

    return uploaded, deleted


def _iter_local_content_files() -> list[Path]:
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


def _content_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".md":
        return "text/markdown; charset=utf-8"
    if suffix == ".json":
        return "application/json; charset=utf-8"
    return "application/octet-stream"


def _safe_local_content_path(relative_key: str) -> Path | None:
    """Local path for a key suffix. Dotfiles are sync metadata, as in _iter_local_content_files."""
    if not relative_key:
        return None

    if relative_key.endswith("/"):
        return None

    # Object-storage keys are POSIX-style paths; reject traversal or absolute paths.
    pure = PurePosixPath(relative_key)
    if pure.is_absolute() or any(part in ("", ".", "..") for part in pure.parts):
        logger.warning("Skipping unsafe content key: %s", relative_key)
        return None
    if any(part.startswith(".") for part in pure.parts):
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

    sub.add_parser(
        "status",
        help="Show the local file count and whether the canonical marker exists.",
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

    local_count = len(_iter_local_content_files())
    marker = has_canonical_marker()
    print(f"Local content files: {local_count}")
    print(
        f"Object-storage canonical marker ({OBJECT_STORAGE_CANONICAL_MARKER_KEY}): "
        f"{'present' if marker else 'missing'}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())

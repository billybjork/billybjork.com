"""
Content Sync — S3-backed persistence for the file-based CMS.

On every content save, the file is also uploaded to S3 so edits
survive ephemeral container redeployments.  On app startup,
sync_from_s3() pulls the latest content back to the local filesystem.

Uses the same S3 client, bucket, and credentials as media uploads.
"""
import argparse
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from pathlib import PurePosixPath

from botocore.exceptions import ClientError
from dotenv import load_dotenv

from .s3 import S3_BUCKET, get_s3_client

logger = logging.getLogger(__name__)

CONTENT_DIR = Path(__file__).parent.parent / "content"
S3_CONTENT_PREFIX = "content/"
S3_CANONICAL_MARKER_KEY = f"{S3_CONTENT_PREFIX}.s3-canonical.json"

# Archive prefix for soft-deleted projects
S3_ARCHIVE_PREFIX = "content-archive/"


def sync_to_s3(local_path: Path) -> bool:
    """Upload a single content file to S3 after a local write."""
    try:
        s3_key = local_to_s3_key(local_path)

        s3 = get_s3_client()
        with open(local_path, "rb") as f:
            s3.upload_fileobj(
                f,
                S3_BUCKET,
                s3_key,
                ExtraArgs={"ContentType": _content_type(local_path)},
            )
        logger.info("Synced to S3: %s", s3_key)
        return True
    except Exception:
        logger.exception("Failed to sync %s to S3", local_path)
        return False


def delete_from_s3(local_path: Path) -> bool:
    """Delete a content file from S3 (e.g. after project deletion)."""
    try:
        s3_key = local_to_s3_key(local_path)

        s3 = get_s3_client()
        s3.delete_object(Bucket=S3_BUCKET, Key=s3_key)
        logger.info("Deleted from S3: %s", s3_key)
        return True
    except Exception:
        logger.exception("Failed to delete %s from S3", local_path)
        return False


def archive_to_s3(local_path: Path) -> bool:
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
        return True
    except Exception:
        logger.exception("Failed to archive %s to S3", local_path)
        return False


def sync_from_s3(*, require_marker: bool = False) -> int:
    """Download all content files from S3 to local filesystem.

    Called on app startup so the container has the latest content
    even after a redeploy.

    Returns:
        Number of files synced.
    """
    if require_marker and not has_canonical_marker():
        logger.warning(
            "Skipping startup S3 content sync: canonical marker missing (%s). "
            "Run `uv run python -m utils.content_sync seed` to establish S3 as source of truth.",
            S3_CANONICAL_MARKER_KEY,
        )
        return 0

    s3 = get_s3_client()
    synced = 0

    try:
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=S3_CONTENT_PREFIX):
            for obj in page.get("Contents", []):
                s3_key = obj["Key"]
                if _is_metadata_key(s3_key):
                    continue
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


def has_canonical_marker() -> bool:
    """Return True if the S3 canonical marker exists."""
    s3 = get_s3_client()
    try:
        s3.head_object(Bucket=S3_BUCKET, Key=S3_CANONICAL_MARKER_KEY)
        return True
    except ClientError as e:
        code = str(e.response.get("Error", {}).get("Code", ""))
        if code in {"404", "NoSuchKey", "NotFound"}:
            return False
        logger.warning("Unable to check canonical marker (%s): %s", S3_CANONICAL_MARKER_KEY, code)
        return False


def write_canonical_marker(*, source: str) -> None:
    """Write/update canonical marker indicating S3 is runtime source of truth."""
    s3 = get_s3_client()
    payload = {
        "canonical": "s3",
        "content_prefix": S3_CONTENT_PREFIX,
        "source": source,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    s3.put_object(
        Bucket=S3_BUCKET,
        Key=S3_CANONICAL_MARKER_KEY,
        Body=json.dumps(payload, indent=2).encode("utf-8"),
        ContentType="application/json; charset=utf-8",
    )
    logger.info("Wrote S3 canonical marker: %s", S3_CANONICAL_MARKER_KEY)


def local_to_s3_key(local_path: Path) -> str:
    """Translate a local content path to its S3 key."""
    relative = local_path.relative_to(CONTENT_DIR)
    return f"{S3_CONTENT_PREFIX}{relative.as_posix()}"


def seed_s3_from_local(*, delete_extra: bool = False) -> tuple[int, int]:
    """Upload all local content files to S3 and write canonical marker.

    Returns:
        tuple(uploaded_count, deleted_count)
    """
    uploaded = 0
    deleted = 0
    local_keys: set[str] = set()

    for local_path in _iter_local_content_files():
        s3_key = local_to_s3_key(local_path)
        if sync_to_s3(local_path):
            uploaded += 1
            local_keys.add(s3_key)

    write_canonical_marker(source="seed")
    local_keys.add(S3_CANONICAL_MARKER_KEY)

    if delete_extra:
        s3 = get_s3_client()
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=S3_BUCKET, Prefix=S3_CONTENT_PREFIX):
            for obj in page.get("Contents", []):
                s3_key = obj["Key"]
                if s3_key.endswith("/"):
                    continue
                if s3_key not in local_keys:
                    s3.delete_object(Bucket=S3_BUCKET, Key=s3_key)
                    deleted += 1
                    logger.info("Deleted extra S3 content key: %s", s3_key)

    return uploaded, deleted


def _iter_local_content_files() -> list[Path]:
    """List syncable local content files."""
    if not CONTENT_DIR.exists():
        return []

    files = []
    for path in CONTENT_DIR.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(CONTENT_DIR)
        if any(part.startswith(".") for part in relative.parts):
            continue
        files.append(path)
    files.sort()
    return files


def _is_metadata_key(s3_key: str) -> bool:
    return s3_key == S3_CANONICAL_MARKER_KEY


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


def _main() -> int:
    load_dotenv()

    parser = argparse.ArgumentParser(
        description="Content sync utilities for S3-backed CMS content."
    )
    sub = parser.add_subparsers(dest="command", required=True)

    seed = sub.add_parser(
        "seed",
        help="Upload local content/ files to S3 and mark S3 as canonical.",
    )
    seed.add_argument(
        "--delete-extra",
        action="store_true",
        help="Delete S3 content/ keys that do not exist locally.",
    )

    status = sub.add_parser(
        "status",
        help="Show local/S3 content sync status and canonical marker state.",
    )

    args = parser.parse_args()

    if args.command == "seed":
        uploaded, deleted = seed_s3_from_local(delete_extra=args.delete_extra)
        print(f"Uploaded {uploaded} file(s) to s3://{S3_BUCKET}/{S3_CONTENT_PREFIX}")
        if args.delete_extra:
            print(f"Deleted {deleted} extra S3 key(s)")
        print(f"Canonical marker: s3://{S3_BUCKET}/{S3_CANONICAL_MARKER_KEY}")
        return 0

    if args.command == "status":
        local_count = len(_iter_local_content_files())
        marker = has_canonical_marker()
        print(f"Local content files: {local_count}")
        print(f"S3 canonical marker ({S3_CANONICAL_MARKER_KEY}): {'present' if marker else 'missing'}")
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(_main())

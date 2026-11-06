"""Public delivery of object-storage media, for buckets that aren't publicly readable."""
from __future__ import annotations

import asyncio
import logging
from pathlib import PurePosixPath

from botocore.exceptions import ClientError
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from media.keys import PUBLIC_MEDIA_PREFIXES
from object_storage import get_bucket_name, get_object_storage_client, is_object_storage_configured

logger = logging.getLogger(__name__)

router = APIRouter()


def _is_public_media_key(key: str) -> bool:
    parts = PurePosixPath(key).parts
    return bool(key) and not any(part in {"", ".", ".."} for part in parts) and key.startswith(
        PUBLIC_MEDIA_PREFIXES
    )


def _fetch_media_object(key: str, range_header: str | None) -> tuple[bytes, dict[str, str], int]:
    params = {"Bucket": get_bucket_name(), "Key": key}
    if range_header:
        params["Range"] = range_header
    obj = get_object_storage_client().get_object(**params)

    headers = {
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
    }
    for header, field in (
        ("Content-Type", "ContentType"),
        ("Cache-Control", "CacheControl"),
        ("ETag", "ETag"),
        ("Content-Range", "ContentRange"),
    ):
        if obj.get(field):
            headers[header] = obj[field]
    if obj.get("LastModified"):
        headers["Last-Modified"] = obj["LastModified"].strftime("%a, %d %b %Y %H:%M:%S GMT")
    if obj.get("ContentLength") is not None:
        headers["Content-Length"] = str(obj["ContentLength"])

    return obj["Body"].read(), headers, 206 if obj.get("ContentRange") else 200


@router.get("/media/{object_key:path}", include_in_schema=False)
async def get_media_asset(request: Request, object_key: str):
    key = object_key.strip().lstrip("/")
    if not _is_public_media_key(key):
        raise HTTPException(status_code=404, detail="Asset not found")
    if not is_object_storage_configured():
        raise HTTPException(status_code=503, detail="Object storage is not configured")

    try:
        body, headers, status_code = await asyncio.to_thread(
            _fetch_media_object, key, request.headers.get("range")
        )
    except ClientError as exc:
        error_code = str(exc.response.get("Error", {}).get("Code", ""))
        if error_code in {"404", "NoSuchKey", "NotFound"}:
            raise HTTPException(status_code=404, detail="Asset not found") from exc
        if error_code in {"InvalidRange", "416"}:
            raise HTTPException(status_code=416, detail="Invalid range") from exc
        logger.warning("Failed to fetch object-storage asset %s", key, exc_info=True)
        raise HTTPException(status_code=502, detail="Asset fetch failed") from exc

    return Response(content=body, status_code=status_code, headers=headers)

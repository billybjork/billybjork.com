"""Storing processed images: content-addressed dedupe in front of object storage."""
from __future__ import annotations

import io
from typing import Callable

from cms.assets import compute_hash, find_by_hash, register_asset
from object_storage import public_asset_url, upload_file


def store_webp(data: bytes, new_key: Callable[[], str]) -> tuple[str, bool]:
    """Upload unless identical bytes are already stored. Returns (url, deduplicated)."""
    content_hash = compute_hash(data)
    existing_key = find_by_hash(content_hash)
    if existing_key:
        return public_asset_url(existing_key), True

    key = new_key()
    url = upload_file(io.BytesIO(data), key, "image/webp")
    register_asset(key, content_hash, len(data))
    return url, False

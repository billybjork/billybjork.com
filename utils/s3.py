"""
Backward-compatible object storage helpers.

This module intentionally preserves the older `utils.s3` import surface while
delegating to the generic S3-compatible object-storage implementation.
"""

from __future__ import annotations

from .object_storage import (
    delete_file,
    get_bucket_name,
    get_object_storage_client,
    get_object_storage_settings,
    upload_file,
)

__all__ = [
    "S3_BUCKET",
    "CLOUDFRONT_DOMAIN",
    "get_s3_client",
    "upload_file",
    "delete_file",
]


def get_s3_client():
    return get_object_storage_client()


def __getattr__(name: str):
    settings = get_object_storage_settings()
    if name == "S3_BUCKET":
        return get_bucket_name()
    if name == "CLOUDFRONT_DOMAIN":
        public_base_url = settings.public_base_url
        if not public_base_url:
            return ""
        return public_base_url.removeprefix("https://").removeprefix("http://")
    raise AttributeError(name)

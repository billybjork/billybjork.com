from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from functools import lru_cache
from typing import BinaryIO

import boto3
from botocore.config import Config

logger = logging.getLogger(__name__)

__all__ = [
    "ObjectStorageSettings",
    "get_object_storage_settings",
    "is_object_storage_configured",
    "get_object_storage_client",
    "get_bucket_name",
    "public_asset_url",
    "managed_public_base_urls",
    "is_managed_public_url",
    "extract_object_key",
    "rewrite_managed_public_url",
    "rewrite_public_urls_in_text",
    "upload_file",
    "delete_file",
]


@dataclass(frozen=True)
class ObjectStorageSettings:
    access_key_id: str | None
    secret_access_key: str | None
    region: str
    bucket: str
    endpoint_url: str | None
    public_base_url: str | None
    legacy_public_base_urls: tuple[str, ...]
    addressing_style: str | None


def _normalized_base_url(value: str | None) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if "://" not in normalized:
        normalized = f"https://{normalized}"
    return normalized.rstrip("/")


def _split_base_urls(value: str | None) -> tuple[str, ...]:
    if not isinstance(value, str):
        return ()
    urls: list[str] = []
    for raw_part in value.split(","):
        normalized = _normalized_base_url(raw_part)
        if normalized and normalized not in urls:
            urls.append(normalized)
    return tuple(urls)


@lru_cache(maxsize=1)
def get_object_storage_settings() -> ObjectStorageSettings:
    public_base_url = _normalized_base_url(
        os.getenv("OBJECT_STORAGE_PUBLIC_BASE_URL")
    )
    legacy_cloudfront = _normalized_base_url(os.getenv("CLOUDFRONT_DOMAIN"))
    legacy_public_base_urls = list(
        _split_base_urls(os.getenv("OBJECT_STORAGE_LEGACY_PUBLIC_BASE_URLS"))
    )
    if legacy_cloudfront and legacy_cloudfront not in legacy_public_base_urls:
        legacy_public_base_urls.append(legacy_cloudfront)

    addressing_style = (os.getenv("OBJECT_STORAGE_ADDRESSING_STYLE") or "").strip().lower()
    if addressing_style not in {"auto", "path", "virtual"}:
        addressing_style = None

    return ObjectStorageSettings(
        access_key_id=(
            os.getenv("OBJECT_STORAGE_ACCESS_KEY_ID")
            or os.getenv("AWS_ACCESS_KEY_ID")
        ),
        secret_access_key=(
            os.getenv("OBJECT_STORAGE_SECRET_ACCESS_KEY")
            or os.getenv("AWS_SECRET_ACCESS_KEY")
        ),
        region=(
            os.getenv("OBJECT_STORAGE_REGION")
            or os.getenv("AWS_REGION")
            or "us-west-1"
        ),
        bucket=(
            os.getenv("OBJECT_STORAGE_BUCKET")
            or os.getenv("S3_BUCKET")
            or "billybjork.com"
        ),
        endpoint_url=_normalized_base_url(os.getenv("OBJECT_STORAGE_ENDPOINT_URL")),
        public_base_url=(
            public_base_url
            or legacy_cloudfront
        ),
        legacy_public_base_urls=tuple(legacy_public_base_urls),
        addressing_style=addressing_style,
    )


@lru_cache(maxsize=1)
def get_object_storage_client():
    settings = get_object_storage_settings()
    client_kwargs: dict[str, object] = {
        "service_name": "s3",
        "aws_access_key_id": settings.access_key_id,
        "aws_secret_access_key": settings.secret_access_key,
        "region_name": settings.region,
    }
    if settings.endpoint_url:
        client_kwargs["endpoint_url"] = settings.endpoint_url
    if settings.addressing_style:
        client_kwargs["config"] = Config(
            signature_version="s3v4",
            s3={"addressing_style": settings.addressing_style},
        )
    return boto3.client(**client_kwargs)


def is_object_storage_configured() -> bool:
    settings = get_object_storage_settings()
    return bool(
        settings.access_key_id
        and settings.secret_access_key
        and settings.bucket
    )


def get_bucket_name() -> str:
    return get_object_storage_settings().bucket


def managed_public_base_urls() -> tuple[str, ...]:
    settings = get_object_storage_settings()
    urls: list[str] = []
    if settings.public_base_url:
        urls.append(settings.public_base_url)
    for base_url in settings.legacy_public_base_urls:
        if base_url not in urls:
            urls.append(base_url)
    return tuple(urls)


def public_asset_url(key: str) -> str:
    settings = get_object_storage_settings()
    if not settings.public_base_url:
        raise ValueError("OBJECT_STORAGE_PUBLIC_BASE_URL is not configured")
    return f"{settings.public_base_url}/{key.lstrip('/')}"


def extract_object_key(url: str) -> str | None:
    if not isinstance(url, str):
        return None
    normalized = url.strip()
    if not normalized:
        return None

    for base_url in managed_public_base_urls():
        prefix = f"{base_url}/"
        if normalized.startswith(prefix):
            key = normalized[len(prefix):].lstrip("/")
            return key or None
    return None


def is_managed_public_url(url: str) -> bool:
    return extract_object_key(url) is not None


def rewrite_managed_public_url(url: str | None) -> str | None:
    if not url:
        return url
    key = extract_object_key(url)
    if not key:
        return url
    try:
        return public_asset_url(key)
    except ValueError:
        return url


def rewrite_public_urls_in_text(text: str | None) -> str | None:
    if text is None:
        return None
    rewritten = text
    current_base_url = get_object_storage_settings().public_base_url
    if not current_base_url:
        return rewritten

    for base_url in managed_public_base_urls():
        if base_url == current_base_url:
            continue
        rewritten = rewritten.replace(f"{base_url}/", f"{current_base_url}/")
    return rewritten


def upload_file(
    file_data: BinaryIO,
    key: str,
    content_type: str,
    cache_control: str = "max-age=31536000",
) -> str:
    client = get_object_storage_client()
    client.upload_fileobj(
        file_data,
        get_bucket_name(),
        key,
        ExtraArgs={
            "ContentType": content_type,
            "CacheControl": cache_control,
        },
    )
    return public_asset_url(key)


def delete_file(key: str) -> bool:
    try:
        client = get_object_storage_client()
        client.delete_object(Bucket=get_bucket_name(), Key=key)
        return True
    except Exception:
        logger.exception("Error deleting object-storage key: %s", key)
        return False

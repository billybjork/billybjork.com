"""
S3 Upload Utilities
Handles file uploads to AWS S3 with CloudFront integration
"""
import logging
import os
from typing import BinaryIO

import boto3

logger = logging.getLogger(__name__)

__all__ = [
    "S3_BUCKET",
    "CLOUDFRONT_DOMAIN",
    "get_s3_client",
    "upload_file",
    "delete_file",
]

# AWS Configuration (loaded from environment, expects dotenv already called in main)
AWS_ACCESS_KEY_ID = os.getenv('AWS_ACCESS_KEY_ID')
AWS_SECRET_ACCESS_KEY = os.getenv('AWS_SECRET_ACCESS_KEY')
AWS_REGION = os.getenv('AWS_REGION', 'us-west-1')
S3_BUCKET = os.getenv('S3_BUCKET', 'billybjork.com')
CLOUDFRONT_DOMAIN = os.getenv('CLOUDFRONT_DOMAIN', 'd17y8p6t5eu2ht.cloudfront.net')


_s3_client = None


def get_s3_client():
    """Get configured S3 client (lazy singleton)."""
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client(
            's3',
            aws_access_key_id=AWS_ACCESS_KEY_ID,
            aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
            region_name=AWS_REGION
        )
    return _s3_client


def upload_file(
    file_data: BinaryIO,
    key: str,
    content_type: str,
    cache_control: str = 'max-age=31536000'
) -> str:
    """
    Upload a file to S3 and return the CloudFront URL.

    Args:
        file_data: File-like object to upload
        key: S3 key (path within bucket)
        content_type: MIME type of the file
        cache_control: Cache-Control header value

    Returns:
        CloudFront URL for the uploaded file
    """
    s3 = get_s3_client()

    s3.upload_fileobj(
        file_data,
        S3_BUCKET,
        key,
        ExtraArgs={
            'ContentType': content_type,
            'CacheControl': cache_control,
        }
    )

    return f'https://{CLOUDFRONT_DOMAIN}/{key}'


def delete_file(key: str) -> bool:
    """
    Delete a file from S3.

    Args:
        key: S3 key to delete

    Returns:
        True if successful
    """
    try:
        s3 = get_s3_client()
        s3.delete_object(Bucket=S3_BUCKET, Key=key)
        return True
    except Exception as e:
        logger.exception("Error deleting S3 key: %s", key)
        return False

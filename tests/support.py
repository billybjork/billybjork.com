from __future__ import annotations

import io
import json
import os
import re
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Iterator
from unittest.mock import patch

from botocore.exceptions import ClientError
from fastapi.testclient import TestClient

from config import AppSettings, AuthSettings, ContentPaths
from main import create_app
from object_storage import get_object_storage_client, get_object_storage_settings

PUBLIC_BASE_URL = "https://media.test"
EDIT_TOKEN = "secret-token"


class FakeObjectStorage:
    """An in-memory stand-in for the boto3 S3 client, the app's only outside dependency in tests."""

    def __init__(self) -> None:
        self.objects: dict[str, dict] = {}
        self.failing_upload_prefixes: tuple[str, ...] = ()

    def put(self, key: str, body: bytes = b"x", content_type: str = "application/octet-stream") -> None:
        self.objects[key] = {"Body": body, "ContentType": content_type, "CacheControl": None}

    def upload_fileobj(self, fileobj, _bucket, key, ExtraArgs=None) -> None:
        if key.startswith(self.failing_upload_prefixes):
            raise ClientError({"Error": {"Code": "SlowDown"}}, "upload")
        extra = ExtraArgs or {}
        self.objects[key] = {
            "Body": fileobj.read(),
            "ContentType": extra.get("ContentType"),
            "CacheControl": extra.get("CacheControl"),
        }

    def put_object(self, Bucket, Key, Body, ContentType=None) -> None:
        self.put(Key, Body, ContentType)

    def delete_object(self, Bucket, Key) -> None:
        self.objects.pop(Key, None)

    def _require(self, key: str) -> dict:
        if key not in self.objects:
            raise ClientError({"Error": {"Code": "NoSuchKey"}}, "op")
        return self.objects[key]

    def head_object(self, Bucket, Key) -> dict:
        self._require(Key)
        return {}

    def get_object(self, Bucket, Key, Range=None) -> dict:
        stored = self._require(Key)
        body = stored["Body"]
        response = {
            "ContentType": stored["ContentType"],
            "CacheControl": stored["CacheControl"],
            "ContentLength": len(body),
        }
        if Range:
            match = re.fullmatch(r"bytes=(\d+)-(\d+)", Range)
            start, end = int(match[1]), int(match[2])
            response["ContentRange"] = f"bytes {start}-{end}/{len(body)}"
            body = body[start : end + 1]
            response["ContentLength"] = len(body)
        response["Body"] = io.BytesIO(body)
        return response

    def download_file(self, _bucket, key, path) -> None:
        Path(path).write_bytes(self._require(key)["Body"])

    def get_paginator(self, _operation):
        return self

    def paginate(self, Bucket, Prefix):
        keys = sorted(key for key in self.objects if key.startswith(Prefix))
        for start in range(0, max(len(keys), 1), 2):
            yield {"Contents": [{"Key": key} for key in keys[start : start + 2]]}


@dataclass
class TestAppHarness:
    client: TestClient
    content_root: Path
    storage: FakeObjectStorage

    @property
    def projects_dir(self) -> Path:
        return self.content_root / "projects"

    @property
    def project_file(self) -> Path:
        return self.projects_dir / "sample-project.md"

    def login(self) -> None:
        response = self.client.post(
            "/edit/login", data={"token": EDIT_TOKEN}, follow_redirects=False
        )
        assert response.status_code == 303


def _seed_content_root(content_root: Path) -> None:
    projects_dir = content_root / "projects"
    projects_dir.mkdir(parents=True, exist_ok=True)
    (projects_dir / "sample-project.md").write_text(
        "---\nname: Sample Project\nslug: sample-project\ndate: 2024-01-15\n"
        "draft: false\npinned: false\n---\n\nSeed project body\n",
        encoding="utf-8",
    )
    (content_root / "about.md").write_text(
        "---\ntitle: About\n---\n\nAbout integration body\n", encoding="utf-8"
    )
    (content_root / "settings.json").write_text(
        json.dumps({"social_links": {}, "about": {}}), encoding="utf-8"
    )


@contextmanager
def managed_test_app(
    startup_content_sync_policy: str = "off",
    storage_configured: bool = True,
) -> Iterator[TestAppHarness]:
    storage = FakeObjectStorage()
    environment = {
        "OBJECT_STORAGE_ACCESS_KEY_ID": "key" if storage_configured else "",
        "OBJECT_STORAGE_SECRET_ACCESS_KEY": "secret" if storage_configured else "",
        "AWS_ACCESS_KEY_ID": "",
        "AWS_SECRET_ACCESS_KEY": "",
        "OBJECT_STORAGE_BUCKET": "bucket",
        "OBJECT_STORAGE_PUBLIC_BASE_URL": PUBLIC_BASE_URL,
        "OBJECT_STORAGE_LEGACY_PUBLIC_BASE_URLS": "",
    }
    with TemporaryDirectory() as temp_dir, patch.dict(os.environ, environment), patch(
        "object_storage.boto3.client", return_value=storage
    ):
        get_object_storage_settings.cache_clear()
        get_object_storage_client.cache_clear()
        root = Path(temp_dir)
        content_root = root / "content"
        _seed_content_root(content_root)

        app = create_app(
            AppSettings(
                content_paths=ContentPaths.from_root(content_root),
                analytics_db_path=root / "data" / "analytics.db",
                auth=AuthSettings(
                    edit_token=EDIT_TOKEN,
                    cookie_secret="cookie-secret",
                    localhost_bypass_enabled=False,
                ),
                startup_content_sync_policy=startup_content_sync_policy,
            )
        )
        with TestClient(app) as client:
            yield TestAppHarness(client=client, content_root=content_root, storage=storage)
    get_object_storage_settings.cache_clear()
    get_object_storage_client.cache_clear()

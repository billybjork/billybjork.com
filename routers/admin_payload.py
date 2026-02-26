from typing import Any, Optional

from fastapi import HTTPException

from utils.assets import extract_cloudfront_urls, extract_s3_key
from utils.content import validate_slug


def validate_save_project_input(data: dict[str, Any]) -> tuple[str, str]:
    slug_raw = data.get("slug")
    original_slug_raw = data.get("original_slug") or slug_raw

    if not isinstance(slug_raw, str) or not slug_raw:
        raise HTTPException(status_code=400, detail="Slug is required")
    if not isinstance(original_slug_raw, str) or not original_slug_raw:
        raise HTTPException(status_code=400, detail="Original slug is required")

    slug = slug_raw.strip()
    original_slug = original_slug_raw.strip()
    if not validate_slug(slug):
        raise HTTPException(status_code=400, detail="Invalid slug format")
    if not validate_slug(original_slug):
        raise HTTPException(status_code=400, detail="Invalid original slug format")

    return slug, original_slug


def build_project_frontmatter(
    data: dict[str, Any], slug: str
) -> tuple[dict[str, Any], dict[str, Any]]:
    frontmatter: dict[str, Any] = {
        "name": data.get("name", slug),
        "slug": slug,
        "date": data.get("date"),
        "pinned": data.get("pinned", False),
        "draft": data.get("draft", False),
    }

    raw_video = data.get("video", {})
    video = raw_video if isinstance(raw_video, dict) else {}
    normalized_video: dict[str, Any] = {}
    for key in ("hls", "thumbnail", "spriteSheet"):
        value = video.get(key)
        if isinstance(value, str) and value.strip():
            normalized_video[key] = value.strip()

    for key in ("frames", "columns", "rows", "frame_width", "frame_height", "fps"):
        value = video.get(key)
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)) and value > 0:
            normalized_video[key] = int(value)
            continue
        if isinstance(value, str):
            try:
                parsed = int(float(value.strip()))
            except ValueError:
                continue
            if parsed > 0:
                normalized_video[key] = parsed

    if normalized_video:
        frontmatter["video"] = normalized_video

    youtube = data.get("youtube")
    if youtube:
        frontmatter["youtube"] = youtube

    return frontmatter, normalized_video


def collect_asset_refs(markdown_content: str, video: Optional[dict[str, Any]] = None) -> set[str]:
    refs = extract_cloudfront_urls(markdown_content or "")
    if isinstance(video, dict):
        for key in ("hls", "thumbnail", "spriteSheet"):
            value = video.get(key)
            if isinstance(value, str) and value:
                refs.add(value)
    return refs


def collect_cleanup_candidates(data: dict[str, Any], limit: int = 200) -> set[str]:
    raw_candidates = data.get("cleanup_candidates")
    if not isinstance(raw_candidates, list):
        return set()

    candidates: set[str] = set()
    for item in raw_candidates[:limit]:
        if isinstance(item, str):
            value = item.strip()
            if value:
                candidates.add(value)
    return candidates


def extract_s3_keys(urls: set[str]) -> set[str]:
    keys = set()
    for url in urls:
        key = extract_s3_key(url)
        if key:
            keys.add(key)
    return keys

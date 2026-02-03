from __future__ import annotations


def hero_hls_prefix(project_slug: str) -> str:
    return f"videos/{project_slug}"


def hero_sprite_key(project_slug: str) -> str:
    return f"images/sprite-sheets/{project_slug}_sprite_sheet.jpg"


def hero_thumbnail_key(project_slug: str) -> str:
    return f"images/thumbnails/{project_slug}.webp"


def content_image_key(filename: str) -> str:
    return f"images/project-content/{filename}"


def misc_image_key(filename: str) -> str:
    return f"images/misc/{filename}"


def content_video_key(filename: str) -> str:
    return f"videos_mp4/{filename}"

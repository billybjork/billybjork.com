#!/usr/bin/env python3
"""
Regenerate hero poster thumbnails from frame 0 for hero-video projects.

Usage:
  uv run python tools/regenerate_hero_posters_first_frame.py --apply --cleanup-orphans
  uv run python tools/regenerate_hero_posters_first_frame.py --slug my-project --apply
"""

from __future__ import annotations

import argparse
import sys
import tempfile
import time
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from utils.assets import cleanup_orphans, extract_s3_key
from utils.content import PROJECTS_DIR, parse_frontmatter, save_project, validate_slug
from utils.media_paths import hero_thumbnail_key
from utils.s3 import upload_file
from utils.video import generate_thumbnail


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Regenerate hero poster thumbnails at frame 0 and update frontmatter.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write updates to project frontmatter and upload new thumbnails.",
    )
    parser.add_argument(
        "--cleanup-orphans",
        action="store_true",
        help="After apply, delete replaced thumbnail assets that are now orphaned.",
    )
    parser.add_argument(
        "--slug",
        action="append",
        default=[],
        help="Restrict to one or more specific project slugs (repeatable).",
    )
    return parser.parse_args()


def iter_project_files(slugs: set[str]) -> list[Path]:
    if slugs:
        files: list[Path] = []
        for slug in sorted(slugs):
            files.append(PROJECTS_DIR / f"{slug}.md")
        return files
    return sorted(PROJECTS_DIR.glob("*.md"))


def main() -> int:
    load_dotenv()
    args = parse_args()

    selected_slugs = {slug.strip() for slug in args.slug if slug and slug.strip()}
    invalid_slugs = [slug for slug in selected_slugs if not validate_slug(slug)]
    if invalid_slugs:
        for slug in invalid_slugs:
            print(f"[ERROR] Invalid slug: {slug}")
        return 2

    project_files = iter_project_files(selected_slugs)
    if not project_files:
        print("[INFO] No project files found.")
        return 0

    mode = "APPLY" if args.apply else "DRY RUN"
    print(f"[INFO] Mode: {mode}")
    replaced_keys: set[str] = set()
    scanned = 0
    updated = 0
    skipped = 0

    for project_file in project_files:
        if not project_file.exists():
            print(f"[WARN] Missing project file: {project_file.name}")
            skipped += 1
            continue

        raw = project_file.read_text(encoding="utf-8")
        frontmatter, markdown = parse_frontmatter(raw)
        slug = str(frontmatter.get("slug") or project_file.stem).strip()

        if not validate_slug(slug):
            print(f"[WARN] Skipping {project_file.name}: invalid slug '{slug}'")
            skipped += 1
            continue

        video = frontmatter.get("video")
        if not isinstance(video, dict):
            skipped += 1
            continue

        hls_url = video.get("hls")
        if not isinstance(hls_url, str) or not hls_url.strip():
            skipped += 1
            continue
        hls_url = hls_url.strip()

        scanned += 1
        old_thumbnail = video.get("thumbnail")

        if not args.apply:
            print(f"[DRY-RUN] {slug}: would regenerate poster from frame 0 (hls={hls_url})")
            updated += 1
            continue

        try:
            with tempfile.TemporaryDirectory() as temp_dir:
                poster_path = Path(temp_dir) / "hero-first-frame.webp"
                generate_thumbnail(hls_url, str(poster_path), time=0)

                version = str(int(time.time()))
                thumbnail_key = hero_thumbnail_key(slug, version)
                with poster_path.open("rb") as poster_file:
                    new_thumbnail = upload_file(
                        poster_file,
                        thumbnail_key,
                        "image/webp",
                        cache_control="max-age=31536000, immutable",
                    )

            video["thumbnail"] = new_thumbnail
            frontmatter["video"] = video
            save_project(slug, frontmatter, markdown)

            if isinstance(old_thumbnail, str) and old_thumbnail and old_thumbnail != new_thumbnail:
                old_key = extract_s3_key(old_thumbnail)
                if old_key:
                    replaced_keys.add(old_key)

            updated += 1
            print(f"[UPDATED] {slug}: {new_thumbnail}")
        except Exception as exc:
            print(f"[ERROR] {slug}: {exc}")

    print(
        f"[SUMMARY] scanned={scanned} updated={updated} "
        f"skipped={skipped} replaced_candidates={len(replaced_keys)}"
    )

    if args.apply and args.cleanup_orphans and replaced_keys:
        deleted = cleanup_orphans(replaced_keys)
        print(f"[CLEANUP] deleted_orphans={len(deleted)}")
    elif args.cleanup_orphans and not args.apply:
        print("[CLEANUP] skipped (use --apply with --cleanup-orphans)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

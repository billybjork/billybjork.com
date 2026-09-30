#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from utils.object_storage import managed_public_base_urls, rewrite_public_urls_in_text


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Rewrite managed asset base URLs inside content files.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write rewritten content back to disk.",
    )
    parser.add_argument(
        "--path",
        action="append",
        default=[],
        help="Optional file or directory to rewrite. Defaults to content/.",
    )
    return parser.parse_args()


def iter_target_files(paths: list[str]) -> list[Path]:
    if not paths:
        paths = ["content"]

    files: list[Path] = []
    for raw_path in paths:
        path = (PROJECT_ROOT / raw_path).resolve()
        if path.is_file():
            files.append(path)
            continue
        if path.is_dir():
            for candidate in sorted(path.rglob("*")):
                if candidate.suffix.lower() not in {".md", ".json"}:
                    continue
                if candidate.is_file():
                    files.append(candidate)
    seen: set[Path] = set()
    unique_files: list[Path] = []
    for file_path in files:
        if file_path not in seen:
            seen.add(file_path)
            unique_files.append(file_path)
    return unique_files


def main() -> int:
    load_dotenv()
    args = parse_args()

    files = iter_target_files(args.path)
    if not files:
        print("[INFO] No matching files found.")
        return 0

    bases = managed_public_base_urls()
    if len(bases) < 2:
        print(
            "[INFO] Nothing to rewrite. Configure both "
            "OBJECT_STORAGE_PUBLIC_BASE_URL and OBJECT_STORAGE_LEGACY_PUBLIC_BASE_URLS "
            "when migrating hosts."
        )
        return 0

    changed = 0
    for file_path in files:
        original = file_path.read_text(encoding="utf-8")
        rewritten = rewrite_public_urls_in_text(original)
        if rewritten == original:
            continue

        changed += 1
        if args.apply:
            file_path.write_text(rewritten, encoding="utf-8")
            print(f"[UPDATED] {file_path.relative_to(PROJECT_ROOT)}")
        else:
            print(f"[DRY-RUN] {file_path.relative_to(PROJECT_ROOT)}")

    mode = "APPLY" if args.apply else "DRY RUN"
    print(f"[SUMMARY] mode={mode} changed={changed} scanned={len(files)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

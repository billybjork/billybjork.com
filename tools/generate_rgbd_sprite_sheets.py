#!/usr/bin/env python3
"""
Generate RGBD sprite sheets from RGB frames and Video Depth Anything output.

Takes RGB frames + VDA depth output and generates:
1. RGB sprite sheet atlas
2. Normalized depth sprite sheet atlas (8-bit grayscale)
3. metadata.json for the shader

Usage:
    python tools/generate_rgbd_sprite_sheets.py \
        --rgb-dir ./workdir/vda_test/full_output/rgb_frames \
        --depth-npz ./workdir/vda_test/full_output/depths.npz \
        --output ./static/test/rgbd-sprites \
        --columns 5 \
        --resolutions 320x180,640x360
"""

import argparse
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image


def normalize_depth_clip(depths: np.ndarray) -> np.ndarray:
    """
    Normalize depth values across the entire clip to 0-1 range.

    Uses global min/max rather than per-frame to avoid temporal "pumping".
    """
    global_min = depths.min()
    global_max = depths.max()

    if global_max - global_min < 1e-6:
        return np.zeros_like(depths)

    normalized = (depths - global_min) / (global_max - global_min)
    return normalized


def load_rgb_frames(rgb_dir: Path, max_frames: int = None) -> list[np.ndarray]:
    """Load RGB frames from directory."""
    frame_paths = sorted(rgb_dir.glob("frame_*.png"))
    if max_frames:
        frame_paths = frame_paths[:max_frames]

    frames = []
    for path in frame_paths:
        img = Image.open(path).convert("RGB")
        frames.append(np.array(img))

    return frames


def load_depth_frames(npz_path: Path, max_frames: int = None) -> np.ndarray:
    """Load and normalize depth frames from npz file."""
    data = np.load(npz_path)
    depths = data["depths"]

    if max_frames:
        depths = depths[:max_frames]

    # Normalize across entire clip
    normalized = normalize_depth_clip(depths)

    return normalized


def create_sprite_sheet(
    frames: list[np.ndarray],
    columns: int,
    target_size: tuple[int, int],
) -> np.ndarray:
    """
    Create a sprite sheet from frames.

    Args:
        frames: List of frame arrays (H, W, C) or (H, W)
        columns: Number of columns in the grid
        target_size: (width, height) for each frame

    Returns:
        Sprite sheet as numpy array
    """
    num_frames = len(frames)
    rows = (num_frames + columns - 1) // columns

    target_w, target_h = target_size

    # Determine if grayscale or RGB
    is_grayscale = frames[0].ndim == 2

    if is_grayscale:
        sheet = np.zeros((rows * target_h, columns * target_w), dtype=np.uint8)
    else:
        sheet = np.zeros((rows * target_h, columns * target_w, 3), dtype=np.uint8)

    for i, frame in enumerate(frames):
        row = i // columns
        col = i % columns

        # Resize frame
        img = Image.fromarray(frame)
        if is_grayscale:
            img = img.convert("L")
        img = img.resize((target_w, target_h), Image.Resampling.LANCZOS)
        resized = np.array(img)

        # Place in sheet
        y_start = row * target_h
        x_start = col * target_w
        sheet[y_start:y_start + target_h, x_start:x_start + target_w] = resized

    return sheet


def main():
    parser = argparse.ArgumentParser(description="Generate RGBD sprite sheets")
    parser.add_argument("--rgb-dir", required=True, help="Directory with RGB frames")
    parser.add_argument("--depth-npz", required=True, help="Path to depths.npz from VDA")
    parser.add_argument("--output", "-o", required=True, help="Output directory")
    parser.add_argument("--columns", type=int, default=5, help="Columns in sprite grid")
    parser.add_argument(
        "--resolutions",
        default="320x180,640x360",
        help="Comma-separated WxH resolutions",
    )
    args = parser.parse_args()

    rgb_dir = Path(args.rgb_dir)
    depth_npz = Path(args.depth_npz)
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Parse resolutions
    resolutions = []
    for res_str in args.resolutions.split(","):
        w, h = map(int, res_str.strip().split("x"))
        resolutions.append((w, h))

    print(f"Loading depth data from {depth_npz}...")
    depth_data = np.load(depth_npz)
    depths = depth_data["depths"]
    num_depth_frames = depths.shape[0]
    print(f"  Depth frames: {num_depth_frames}, shape: {depths.shape}")

    # Load RGB frames
    print(f"Loading RGB frames from {rgb_dir}...")
    rgb_frame_paths = sorted(rgb_dir.glob("frame_*.png"))
    num_rgb_frames = len(rgb_frame_paths)
    print(f"  RGB frames: {num_rgb_frames}")

    # Use minimum frame count
    num_frames = min(num_depth_frames, num_rgb_frames)
    if num_frames != num_depth_frames or num_frames != num_rgb_frames:
        print(f"  Using {num_frames} frames (min of depth={num_depth_frames}, rgb={num_rgb_frames})")

    # Load and process frames
    rgb_frames = load_rgb_frames(rgb_dir, max_frames=num_frames)
    print(f"  Loaded {len(rgb_frames)} RGB frames, size: {rgb_frames[0].shape}")

    # Normalize depth across clip
    print("Normalizing depth across clip...")
    depths_truncated = depths[:num_frames]
    global_min = depths_truncated.min()
    global_max = depths_truncated.max()
    print(f"  Depth range: {global_min:.2f} to {global_max:.2f}")

    normalized_depths = normalize_depth_clip(depths_truncated)

    # Convert normalized depth (0-1 float) to 8-bit grayscale frames
    depth_frames = []
    for i in range(num_frames):
        # Convert to 8-bit (0-255)
        depth_8bit = (normalized_depths[i] * 255).astype(np.uint8)
        depth_frames.append(depth_8bit)

    print(f"  Converted to {len(depth_frames)} 8-bit depth frames")

    # Calculate grid layout
    columns = args.columns
    rows = (num_frames + columns - 1) // columns
    print(f"\nSprite sheet layout: {columns}x{rows} ({num_frames} frames)")

    # Generate sprite sheets for each resolution
    metadata = {
        "frames": num_frames,
        "columns": columns,
        "rows": rows,
        "atlas_version": int(time.time()),
        "depth_normalization": {
            "global_min": float(global_min),
            "global_max": float(global_max),
        },
        "resolutions": {},
    }

    for target_w, target_h in resolutions:
        res_key = f"{target_w}x{target_h}"
        print(f"\nGenerating {res_key} sprite sheets...")

        # RGB sprite sheet (lossless to avoid chroma subsampling artifacts)
        rgb_sheet = create_sprite_sheet(rgb_frames, columns, (target_w, target_h))
        rgb_path = output_dir / f"rgb_{res_key}.webp"
        Image.fromarray(rgb_sheet).save(rgb_path, lossless=True, method=6)
        print(f"  Saved: {rgb_path} ({rgb_path.stat().st_size / 1024:.1f} KB)")

        # Depth sprite sheet (WebP lossless - much smaller than PNG)
        depth_sheet = create_sprite_sheet(depth_frames, columns, (target_w, target_h))
        depth_path = output_dir / f"depth_{res_key}.webp"
        Image.fromarray(depth_sheet).save(depth_path, lossless=True, method=6)
        print(f"  Saved: {depth_path} ({depth_path.stat().st_size / 1024:.1f} KB)")

        metadata["resolutions"][res_key] = {
            "frame_width": target_w,
            "frame_height": target_h,
            "sheet_width": columns * target_w,
            "sheet_height": rows * target_h,
            "rgb_file": rgb_path.name,
            "depth_file": depth_path.name,  # Use WebP lossless for depth
        }

    # Save metadata
    metadata_path = output_dir / "metadata.json"
    with open(metadata_path, "w") as f:
        json.dump(metadata, f, indent=2)
    print(f"\nSaved: {metadata_path}")

    print("\nDone!")


if __name__ == "__main__":
    main()

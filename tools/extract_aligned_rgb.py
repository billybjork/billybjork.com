#!/usr/bin/env python3
"""
Extract RGB frames from video aligned with depths.npz frame count.

This ensures RGB frames match the exact frames that VDA processed for depth.
Uses OpenCV for cross-platform compatibility.

Usage:
    python tools/extract_aligned_rgb.py \
        --video "/path/to/video.mp4" \
        --depths ./workdir/depth_output/depths.npz \
        --output ./workdir/depth_output/rgb_frames \
        --fps 5 \
        --max-res 1080
"""

import argparse
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


def main():
    parser = argparse.ArgumentParser(description="Extract aligned RGB frames")
    parser.add_argument("--video", "-v", required=True, help="Input video path")
    parser.add_argument("--depths", "-d", required=True, help="Path to depths.npz")
    parser.add_argument("--output", "-o", required=True, help="Output directory for RGB frames")
    parser.add_argument("--fps", type=int, default=5, help="Target FPS used by VDA")
    parser.add_argument("--max-res", type=int, default=1080, help="Max resolution")
    args = parser.parse_args()

    video_path = Path(args.video)
    depths_path = Path(args.depths)
    output_dir = Path(args.output)

    # Load depths to get target frame count
    depths = np.load(depths_path)["depths"]
    target_frame_count = depths.shape[0]
    print(f"Depths.npz has {target_frame_count} frames")

    # Open video with OpenCV
    cap = cv2.VideoCapture(str(video_path))
    original_fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    print(f"Video: {total_frames} frames at {original_fps:.2f} fps")

    # Calculate frame indices using VDA's EXACT stride-based sampling
    # VDA uses: stride = round(fps / target_fps), then range(0, len, stride)
    target_fps = args.fps
    if target_fps > 0 and target_fps < original_fps:
        stride = round(original_fps / target_fps)
        stride = max(stride, 1)
        frame_indices = list(range(0, total_frames, stride))
    else:
        frame_indices = list(range(total_frames))

    print(f"Calculated {len(frame_indices)} frame indices at {target_fps} fps")

    # Verify frame count matches
    if len(frame_indices) != target_frame_count:
        print(f"WARNING: Frame count mismatch!")
        print(f"  Calculated: {len(frame_indices)}")
        print(f"  depths.npz: {target_frame_count}")

        # Adjust to match depths.npz exactly
        if len(frame_indices) > target_frame_count:
            print(f"  Trimming to {target_frame_count} frames")
            frame_indices = frame_indices[:target_frame_count]
        elif len(frame_indices) < target_frame_count:
            # Add more frames by extending the sampling
            print(f"  Extending sampling to get {target_frame_count} frames")
            # Recalculate with adjusted interval
            frame_interval = (total_frames - 1) / (target_frame_count - 1)
            frame_indices = [min(int(i * frame_interval), total_frames - 1) for i in range(target_frame_count)]

    # Extract frames
    output_dir.mkdir(parents=True, exist_ok=True)

    # Clear existing frames
    for f in output_dir.glob("frame_*.png"):
        f.unlink()

    print(f"Extracting {len(frame_indices)} RGB frames...")
    max_res = args.max_res

    last_good_frame = None

    for i, frame_idx in enumerate(frame_indices):
        # Seek to frame
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ret, frame = cap.read()

        if not ret:
            print(f"  Warning: Could not read frame {frame_idx}, using last good frame")
            if last_good_frame is None:
                print(f"  Error: No frames available!")
                continue
            frame = last_good_frame.copy()
        else:
            last_good_frame = frame.copy()

        # Convert BGR to RGB
        frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        # Resize to match max_res
        h, w = frame.shape[:2]
        if max(h, w) > max_res:
            scale = max_res / max(h, w)
            new_w, new_h = int(w * scale), int(h * scale)
            # Make dimensions even
            new_w = new_w - (new_w % 2)
            new_h = new_h - (new_h % 2)
            img = Image.fromarray(frame).resize((new_w, new_h), Image.Resampling.LANCZOS)
        else:
            img = Image.fromarray(frame)

        # Save as PNG (1-indexed to match depth frames)
        out_path = output_dir / f"frame_{i+1:04d}.png"
        img.save(out_path)

        if (i + 1) % 5 == 0:
            print(f"  Saved {i + 1}/{len(frame_indices)}")

    cap.release()
    print(f"\nDone! Saved {len(frame_indices)} frames to {output_dir}")


if __name__ == "__main__":
    main()

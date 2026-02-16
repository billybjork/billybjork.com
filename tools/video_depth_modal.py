#!/usr/bin/env python3
"""
Video Depth Anything inference on Modal.

Generates temporally-consistent depth maps from video using Video Depth Anything.
Uses relative depth (not metric) since we only need depth ordering for parallax.

Usage:
    # Run inference on a local video
    python tools/video_depth_modal.py \
        --input "/path/to/video.mp4" \
        --output "./workdir/depth_output" \
        --fps 5 \
        --max-res 1080

    # With custom encoder (vitl is best quality, vits is fastest)
    python tools/video_depth_modal.py \
        --input "/path/to/video.mp4" \
        --output "./workdir/depth_output" \
        --encoder vitl

Outputs:
    - depth_video.mp4: Grayscale visualization of depth
    - depth_frames/: Individual depth frames as 16-bit PNG
    - metadata.json: Processing parameters and stats
"""

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

import modal

# Enable Modal output for debugging
modal.enable_output()

# Modal app definition
app = modal.App("video-depth-anything")

# Image with Video Depth Anything dependencies
vda_image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install("git", "ffmpeg", "libgl1-mesa-glx", "libglib2.0-0")
    .pip_install(
        # Core PyTorch - use compatible versions
        "torch==2.1.1",
        "torchvision==0.16.1",
        # VDA dependencies
        "numpy==1.24.0",
        "opencv-python",
        "matplotlib",
        "pillow",
        "imageio==2.37.0",
        "imageio-ffmpeg==0.4.7",
        "decord",
        "einops==0.4.1",
        "easydict",
        "tqdm",
        "huggingface_hub",
        # xformers for efficient attention
        "xformers==0.0.23",
    )
    .run_commands(
        "git clone https://github.com/DepthAnything/Video-Depth-Anything /app/vda",
    )
    .env({"PYTHONPATH": "/app/vda"})
)

# Volume for caching model checkpoints
model_volume = modal.Volume.from_name("vda-checkpoints", create_if_missing=True)


@app.function(
    image=vda_image,
    gpu="A100",
    timeout=1800,  # 30 minutes max
    volumes={"/checkpoints": model_volume},
)
def run_depth_inference(
    video_bytes: bytes,
    filename: str,
    encoder: str = "vitl",
    target_fps: int = -1,
    max_res: int = 1080,
    save_npz: bool = True,
) -> dict:
    """
    Run Video Depth Anything inference on a video.

    Args:
        video_bytes: Raw video file bytes
        filename: Original filename (for format detection)
        encoder: Model encoder size (vits, vitb, vitl)
        target_fps: Target FPS for output (-1 = same as input)
        max_res: Maximum resolution (longer edge)
        save_npz: Whether to save raw depth values as .npz

    Returns:
        dict with:
            - depth_video: bytes of grayscale depth video
            - depth_frames: list of (frame_idx, png_bytes) tuples
            - depth_npz: list of (frame_idx, npz_bytes) tuples if save_npz
            - metadata: processing info
    """
    import os
    import tempfile
    import cv2
    import numpy as np
    from pathlib import Path

    # Ensure checkpoints are downloaded to the location VDA expects
    # VDA looks for ./checkpoints/ relative to the script
    checkpoint_dir = Path("/app/vda/checkpoints")
    checkpoint_dir.mkdir(exist_ok=True)
    checkpoint_path = checkpoint_dir / f"video_depth_anything_{encoder}.pth"

    # Check volume first
    volume_checkpoint = Path("/checkpoints") / f"video_depth_anything_{encoder}.pth"

    if not checkpoint_path.exists():
        if volume_checkpoint.exists():
            # Copy from volume cache
            print(f"Using cached checkpoint from volume...")
            import shutil
            shutil.copy(volume_checkpoint, checkpoint_path)
        else:
            # Download from HuggingFace
            print(f"Downloading {encoder} checkpoint...")
            from huggingface_hub import hf_hub_download

            model_map = {
                "vits": "depth-anything/Video-Depth-Anything-Small",
                "vitb": "depth-anything/Video-Depth-Anything-Base",
                "vitl": "depth-anything/Video-Depth-Anything-Large",
            }

            downloaded = hf_hub_download(
                repo_id=model_map[encoder],
                filename=f"video_depth_anything_{encoder}.pth",
                local_dir=str(checkpoint_dir),
            )
            print(f"Downloaded to {downloaded}")

            # Cache in volume for future runs
            Path("/checkpoints").mkdir(exist_ok=True)
            import shutil
            shutil.copy(checkpoint_path, volume_checkpoint)
            model_volume.commit()
            print(f"Cached checkpoint in volume")

    # Write input video to temp file
    with tempfile.TemporaryDirectory() as tmpdir:
        tmpdir = Path(tmpdir)
        input_path = tmpdir / filename
        output_dir = tmpdir / "output"
        output_dir.mkdir()

        input_path.write_bytes(video_bytes)
        print(f"Input video: {input_path} ({len(video_bytes) / 1024 / 1024:.1f} MB)")

        # Pre-process: Convert VFR to CFR to avoid decord frame seeking issues
        # VFR videos with B-frames can cause frame duplication/skipping in VDA
        cfr_path = tmpdir / f"{input_path.stem}_cfr.mp4"
        preprocess_cmd = [
            "ffmpeg", "-y",
            "-i", str(input_path),
            "-vf", "fps=30",  # Force constant 30fps
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "18",
            "-an",  # No audio needed
            str(cfr_path),
        ]
        print(f"Pre-processing to CFR: {' '.join(preprocess_cmd)}")
        result = subprocess.run(preprocess_cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"CFR conversion warning (using original): {result.stderr}")
            cfr_path = input_path  # Fall back to original if conversion fails
        else:
            print(f"CFR video: {cfr_path} ({cfr_path.stat().st_size / 1024 / 1024:.1f} MB)")
            input_path = cfr_path  # Use CFR version for VDA

        # Build command
        cmd = [
            "python", "/app/vda/run.py",
            "--input_video", str(input_path),
            "--output_dir", str(output_dir),
            "--encoder", encoder,
            "--max_res", str(max_res),
            # FP16 is default, --fp32 would use FP32
        ]

        if target_fps > 0:
            cmd.extend(["--target_fps", str(target_fps)])

        if save_npz:
            cmd.append("--save_npz")

        print(f"Running: {' '.join(cmd)}")

        result = subprocess.run(
            cmd,
            cwd="/app/vda",
            capture_output=True,
            text=True,
        )

        if result.returncode != 0:
            print(f"STDOUT: {result.stdout}")
            print(f"STDERR: {result.stderr}")
            raise RuntimeError(f"VDA inference failed: {result.stderr}")

        print(result.stdout)

        # Collect outputs
        stem = input_path.stem
        output_data = {
            "depth_video": None,
            "depth_frames": [],
            "rgb_frames": [],  # Also extract aligned RGB frames
            "depth_npz": None,
            "metadata": {
                "encoder": encoder,
                "target_fps": target_fps,
                "max_res": max_res,
            },
        }

        # Find depth visualization video ({name}_vis.mp4)
        vis_video = output_dir / f"{stem}_vis.mp4"
        if vis_video.exists():
            output_data["depth_video"] = vis_video.read_bytes()
            print(f"Depth video: {vis_video} ({len(output_data['depth_video']) / 1024 / 1024:.1f} MB)")

        # Extract individual frames from depth video as 16-bit grayscale
        if output_data["depth_video"]:
            frames_dir = output_dir / "frames"
            frames_dir.mkdir()

            # First convert colorful vis to grayscale, then extract frames
            # VDA uses a color map by default; we need grayscale for displacement
            gray_video = output_dir / f"{stem}_gray.mp4"

            # Extract frames directly - we'll normalize later
            extract_cmd = [
                "ffmpeg", "-y",
                "-i", str(vis_video),
                "-vf", "format=gray",
                "-pix_fmt", "gray16le",
                str(frames_dir / "frame_%04d.png"),
            ]
            result = subprocess.run(extract_cmd, capture_output=True, text=True)
            if result.returncode != 0:
                print(f"Frame extraction warning: {result.stderr}")

            # Read depth frames
            for frame_path in sorted(frames_dir.glob("frame_*.png")):
                frame_idx = int(frame_path.stem.split("_")[1])
                output_data["depth_frames"].append((frame_idx, frame_path.read_bytes()))

            print(f"Extracted {len(output_data['depth_frames'])} depth frames")

            # Extract RGB frames from VDA's _src.mp4 output
            # VDA saves the exact frames it processes to {name}_src.mp4
            # This guarantees perfect 1:1 alignment with depth frames
            rgb_frames_dir = output_dir / "rgb_frames"
            rgb_frames_dir.mkdir()

            from PIL import Image
            import io

            src_video = output_dir / f"{stem}_src.mp4"
            if src_video.exists():
                print(f"Extracting RGB frames from VDA's source video: {src_video}")

                # Extract all frames from _src.mp4 (these are the exact frames VDA processed)
                extract_rgb_cmd = [
                    "ffmpeg", "-y",
                    "-i", str(src_video),
                    "-pix_fmt", "rgb24",
                    str(rgb_frames_dir / "frame_%04d.png"),
                ]
                result = subprocess.run(extract_rgb_cmd, capture_output=True, text=True)
                if result.returncode != 0:
                    print(f"RGB frame extraction warning: {result.stderr}")

                # Read the extracted RGB frames
                rgb_frame_paths = sorted(rgb_frames_dir.glob("frame_*.png"))
                print(f"Extracted {len(rgb_frame_paths)} RGB frames from _src.mp4")

                # Verify frame count matches depth
                npz_file = output_dir / f"{stem}_depths.npz"
                if npz_file.exists():
                    depth_data = np.load(npz_file)
                    num_depth_frames = depth_data["depths"].shape[0]
                    if len(rgb_frame_paths) != num_depth_frames:
                        print(f"WARNING: RGB frames ({len(rgb_frame_paths)}) != depth frames ({num_depth_frames})")

                # Convert to bytes for transfer
                for frame_path in rgb_frame_paths:
                    frame_idx = int(frame_path.stem.split("_")[1])
                    output_data["rgb_frames"].append((frame_idx, frame_path.read_bytes()))

                print(f"Prepared {len(output_data['rgb_frames'])} RGB frames for transfer")
            else:
                print(f"WARNING: VDA source video not found at {src_video}")

        # Check for npz file (single file with all depths)
        npz_file = output_dir / f"{stem}_depths.npz"
        if npz_file.exists():
            output_data["depth_npz"] = npz_file.read_bytes()
            print(f"Depth NPZ: {len(output_data['depth_npz']) / 1024 / 1024:.1f} MB")

        output_data["metadata"]["num_frames"] = len(output_data["depth_frames"])

        return output_data


def main():
    parser = argparse.ArgumentParser(description="Run Video Depth Anything on Modal")
    parser.add_argument("--input", "-i", required=True, help="Input video path")
    parser.add_argument("--output", "-o", required=True, help="Output directory")
    parser.add_argument(
        "--encoder",
        choices=["vits", "vitb", "vitl"],
        default="vitl",
        help="Model encoder size (default: vitl)",
    )
    parser.add_argument(
        "--fps",
        type=int,
        default=-1,
        help="Target FPS (-1 = same as input)",
    )
    parser.add_argument(
        "--max-res",
        type=int,
        default=1080,
        help="Max resolution (default: 1080)",
    )
    parser.add_argument(
        "--no-npz",
        action="store_true",
        help="Skip saving raw depth values",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    output_dir = Path(args.output)

    if not input_path.exists():
        print(f"Error: Input file not found: {input_path}")
        sys.exit(1)

    output_dir.mkdir(parents=True, exist_ok=True)

    # Read input video
    print(f"Reading {input_path}...")
    video_bytes = input_path.read_bytes()
    print(f"Video size: {len(video_bytes) / 1024 / 1024:.1f} MB")

    # Run inference on Modal
    print(f"\nSubmitting to Modal (encoder={args.encoder}, fps={args.fps}, max_res={args.max_res})...")

    with app.run():
        result = run_depth_inference.remote(
            video_bytes=video_bytes,
            filename=input_path.name,
            encoder=args.encoder,
            target_fps=args.fps,
            max_res=args.max_res,
            save_npz=not args.no_npz,
        )

    # Save outputs
    print(f"\nSaving outputs to {output_dir}...")

    # Save depth video
    if result["depth_video"]:
        depth_video_path = output_dir / "depth_video.mp4"
        depth_video_path.write_bytes(result["depth_video"])
        print(f"  Saved: {depth_video_path}")

    # Save depth frames
    frames_dir = output_dir / "depth_frames"
    frames_dir.mkdir(exist_ok=True)
    for frame_idx, frame_bytes in result["depth_frames"]:
        frame_path = frames_dir / f"frame_{frame_idx:04d}.png"
        frame_path.write_bytes(frame_bytes)
    print(f"  Saved {len(result['depth_frames'])} depth frames to {frames_dir}")

    # Save RGB frames (aligned with depth)
    rgb_frames_dir = output_dir / "rgb_frames"
    rgb_frames_dir.mkdir(exist_ok=True)
    for frame_idx, frame_bytes in result["rgb_frames"]:
        frame_path = rgb_frames_dir / f"frame_{frame_idx:04d}.png"
        frame_path.write_bytes(frame_bytes)
    print(f"  Saved {len(result['rgb_frames'])} RGB frames to {rgb_frames_dir}")

    # Save npz file (single file with all depths)
    if result["depth_npz"]:
        npz_path = output_dir / "depths.npz"
        npz_path.write_bytes(result["depth_npz"])
        print(f"  Saved: {npz_path} ({len(result['depth_npz']) / 1024 / 1024:.1f} MB)")

    # Save metadata
    metadata_path = output_dir / "metadata.json"
    with open(metadata_path, "w") as f:
        json.dump(result["metadata"], f, indent=2)
    print(f"  Saved: {metadata_path}")

    print("\nDone!")


if __name__ == "__main__":
    main()

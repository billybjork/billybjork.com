"""
Video Processing Utilities
Handles HLS conversion, sprite sheet generation, and video compression
"""
import json
import os
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Tuple

from .media_paths import (
    content_video_key,
    hero_hls_prefix,
    hero_sprite_key,
    hero_thumbnail_key,
)
from .s3 import CLOUDFRONT_DOMAIN, S3_BUCKET, get_s3_client

__all__ = [
    "check_ffmpeg",
    "get_video_info",
    "generate_hls",
    "generate_sprite_sheet",
    "generate_thumbnail",
    "compress_video",
    "process_hero_video",
    "process_content_video",
]


def check_ffmpeg() -> bool:
    """Check if ffmpeg is available."""
    try:
        subprocess.run(['ffmpeg', '-version'], capture_output=True, check=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False


def get_video_info(video_path: str) -> dict:
    """
    Get video information using ffprobe.

    Returns dict with: width, height, duration, fps
    """
    cmd = [
        'ffprobe',
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,r_frame_rate,duration',
        '-of', 'json',
        video_path
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise ValueError(f"ffprobe failed: {result.stderr}")

    data = json.loads(result.stdout)
    stream = data.get('streams', [{}])[0]

    # Parse frame rate (e.g., "30/1" -> 30)
    fps_str = stream.get('r_frame_rate', '30/1')
    if '/' in fps_str:
        num, den = fps_str.split('/')
        fps = float(num) / float(den) if float(den) > 0 else 30
    else:
        fps = float(fps_str)

    return {
        'width': int(stream.get('width', 1920)),
        'height': int(stream.get('height', 1080)),
        'duration': float(stream.get('duration', 0)),
        'fps': fps,
    }


def generate_hls(
    video_path: str,
    output_dir: str,
    start_time: float = 0,
    duration: float = None
) -> str:
    """
    Generate HLS adaptive bitrate streams from a video.

    Args:
        video_path: Path to source video
        output_dir: Directory to write HLS files
        start_time: Start time in seconds for trimming
        duration: Duration in seconds (None for full video)

    Returns:
        Path to master.m3u8
    """
    info = get_video_info(video_path)
    source_height = info['height']

    # Define resolution ladder based on source
    resolutions = []
    if source_height >= 2160:
        resolutions.append((3840, 2160, 12000))  # 4K
    if source_height >= 1440:
        resolutions.append((2560, 1440, 8000))   # 1440p
    if source_height >= 1080:
        resolutions.append((1920, 1080, 5000))   # 1080p
    if source_height >= 720:
        resolutions.append((1280, 720, 2500))    # 720p
    resolutions.append((854, 480, 1200))         # 480p
    resolutions.append((640, 360, 800))          # 360p
    resolutions.append((426, 240, 400))          # 240p

    os.makedirs(output_dir, exist_ok=True)

    # Build ffmpeg command for all streams
    inputs = ['-i', video_path]
    if start_time > 0:
        inputs = ['-ss', str(start_time)] + inputs
    if duration:
        inputs = inputs + ['-t', str(duration)]

    filter_complex = []
    maps = []
    stream_maps = []

    for i, (width, height, bitrate) in enumerate(resolutions):
        filter_complex.append(
            f"[0:v]scale={width}:{height}:force_original_aspect_ratio=decrease,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2[v{i}]"
        )
        maps.extend(['-map', f'[v{i}]', '-map', '0:a?'])
        stream_maps.append(f'v:{i},a:{i}')

    cmd = [
        'ffmpeg',
        '-y',
        *inputs,
        '-filter_complex', ';'.join(filter_complex),
        *maps,
        '-c:v', 'libx264',
        '-preset', 'slow',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-f', 'hls',
        '-hls_time', '6',
        '-hls_list_size', '0',
        '-hls_segment_filename', os.path.join(output_dir, 'seg_%v_%03d.ts'),
        '-master_pl_name', 'master.m3u8',
        '-var_stream_map', ' '.join(stream_maps),
        os.path.join(output_dir, 'playlist_%v.m3u8')
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise ValueError(f"HLS generation failed: {result.stderr}")

    return os.path.join(output_dir, 'master.m3u8')


def generate_sprite_sheet(
    video_path: str,
    output_path: str,
    start_time: float = 0,
    duration: float = 3,
    fps: int = 20,
    frame_width: int = 320,
    frame_height: int = 180,
    columns: int = 5
) -> Tuple[str, dict]:
    """
    Generate a sprite sheet from a video.

    Args:
        video_path: Path to source video
        output_path: Path to output sprite sheet
        start_time: Start time in seconds
        duration: Duration to capture in seconds
        fps: Frames per second to capture
        frame_width: Width of each frame
        frame_height: Height of each frame
        columns: Number of columns in sprite sheet

    Returns:
        Tuple of (output_path, metadata dict)
    """
    total_frames = int(duration * fps)
    rows = (total_frames + columns - 1) // columns

    # Create temporary directory for frames
    with tempfile.TemporaryDirectory() as temp_dir:
        frames_pattern = os.path.join(temp_dir, 'frame_%04d.jpg')

        # Extract frames
        cmd = [
            'ffmpeg',
            '-y',
            '-ss', str(start_time),
            '-i', video_path,
            '-t', str(duration),
            '-vf', f'fps={fps},scale={frame_width}:{frame_height}',
            '-q:v', '5',
            frames_pattern
        ]

        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise ValueError(f"Frame extraction failed: {result.stderr}")

        # Get list of frames
        frames = sorted(Path(temp_dir).glob('frame_*.jpg'))
        actual_frames = min(len(frames), total_frames)

        if actual_frames == 0:
            raise ValueError("No frames extracted")

        # Create sprite sheet using ImageMagick montage
        montage_cmd = [
            'montage',
            *[str(f) for f in frames[:actual_frames]],
            '-tile', f'{columns}x',
            '-geometry', f'{frame_width}x{frame_height}+0+0',
            '-quality', '80',
            output_path
        ]

        result = subprocess.run(montage_cmd, capture_output=True, text=True)
        if result.returncode != 0:
            # Fallback: try using ffmpeg for montage
            # Create a tile filter
            tile_w = columns
            tile_h = (actual_frames + columns - 1) // columns

            ffmpeg_tile_cmd = [
                'ffmpeg',
                '-y',
                '-ss', str(start_time),
                '-i', video_path,
                '-t', str(duration),
                '-vf', f'fps={fps},scale={frame_width}:{frame_height},tile={tile_w}x{tile_h}',
                '-frames:v', '1',
                '-q:v', '5',
                output_path
            ]

            result = subprocess.run(ffmpeg_tile_cmd, capture_output=True, text=True)
            if result.returncode != 0:
                raise ValueError(f"Sprite sheet creation failed: {result.stderr}")

    metadata = {
        'frames': actual_frames,
        'columns': columns,
        'rows': rows,
        'frame_width': frame_width,
        'frame_height': frame_height,
        'fps': fps,
    }

    return output_path, metadata


def generate_thumbnail(
    video_path: str,
    output_path: str,
    time: float = 0,
    width: int = 1280,
    height: int = 720
) -> str:
    """
    Extract a single frame as thumbnail.

    Args:
        video_path: Path to source video
        output_path: Path to output thumbnail (WebP)
        time: Time in seconds to extract frame
        width: Output width
        height: Output height

    Returns:
        Path to thumbnail
    """
    cmd = [
        'ffmpeg',
        '-y',
        '-ss', str(time),
        '-i', video_path,
        '-vframes', '1',
        '-vf', f'scale={width}:{height}:force_original_aspect_ratio=decrease',
        '-c:v', 'libwebp',
        '-quality', '80',
        output_path
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise ValueError(f"Thumbnail extraction failed: {result.stderr}")

    return output_path


def compress_video(
    video_path: str,
    output_path: str,
    max_height: int = 720,
    crf: int = 28
) -> str:
    """
    Compress a video for content embedding.

    Args:
        video_path: Path to source video
        output_path: Path to output video
        max_height: Maximum height (will maintain aspect ratio)
        crf: Constant Rate Factor (higher = smaller file, lower quality)

    Returns:
        Path to compressed video
    """
    cmd = [
        'ffmpeg',
        '-y',
        '-i', video_path,
        '-vf', f'scale=-2:\'min({max_height},ih)\'',
        '-c:v', 'libx264',
        '-preset', 'slow',
        '-crf', str(crf),
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        output_path
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise ValueError(f"Video compression failed: {result.stderr}")

    return output_path


def process_hero_video(
    video_path: str,
    project_slug: str,
    trim_start: float = 0,
    sprite_start: float = 0,
    sprite_duration: float = 3
) -> dict:
    """
    Process a hero video: generate HLS, sprite sheet, and thumbnail.

    Args:
        video_path: Path to source video
        project_slug: Project slug for S3 key organization
        trim_start: Start time for video trim
        sprite_start: Start time for sprite sheet (relative to trim_start)
        sprite_duration: Duration for sprite sheet

    Returns:
        Dict with URLs for HLS, sprite sheet, and thumbnail
    """
    if not check_ffmpeg():
        raise RuntimeError("ffmpeg not found. Please install ffmpeg.")

    results = {}

    with tempfile.TemporaryDirectory() as temp_dir:
        # Generate HLS
        hls_dir = os.path.join(temp_dir, 'hls')
        generate_hls(video_path, hls_dir, start_time=trim_start)

        # Upload HLS files to S3
        s3 = get_s3_client()
        hls_prefix = hero_hls_prefix(project_slug)
        for file_path in Path(hls_dir).rglob('*'):
            if file_path.is_file():
                relative_path = file_path.relative_to(hls_dir)
                s3_key = f'{hls_prefix}/{relative_path}'

                content_type = 'application/vnd.apple.mpegurl' if file_path.suffix == '.m3u8' else 'video/mp2t'

                with open(file_path, 'rb') as f:
                    s3.upload_fileobj(
                        f,
                        S3_BUCKET,
                        s3_key,
                        ExtraArgs={
                            'ContentType': content_type,
                            'CacheControl': 'max-age=31536000',
                        }
                    )

        results['hls'] = f'https://{CLOUDFRONT_DOMAIN}/{hls_prefix}/master.m3u8'

        # Generate sprite sheet
        sprite_path = os.path.join(temp_dir, 'sprite.jpg')
        _, sprite_meta = generate_sprite_sheet(
            video_path,
            sprite_path,
            start_time=trim_start + sprite_start,
            duration=sprite_duration
        )

        sprite_key = hero_sprite_key(project_slug)
        with open(sprite_path, 'rb') as f:
            s3.upload_fileobj(
                f,
                S3_BUCKET,
                sprite_key,
                ExtraArgs={
                    'ContentType': 'image/jpeg',
                    'CacheControl': 'max-age=31536000',
                }
            )

        results['spriteSheet'] = f'https://{CLOUDFRONT_DOMAIN}/{sprite_key}'
        results['spriteMeta'] = sprite_meta

        # Generate thumbnail
        thumb_path = os.path.join(temp_dir, 'thumb.webp')
        generate_thumbnail(
            video_path,
            thumb_path,
            time=trim_start + sprite_start
        )

        thumbnail_key = hero_thumbnail_key(project_slug)
        with open(thumb_path, 'rb') as f:
            s3.upload_fileobj(
                f,
                S3_BUCKET,
                thumbnail_key,
                ExtraArgs={
                    'ContentType': 'image/webp',
                    'CacheControl': 'max-age=31536000',
                }
            )

        results['thumbnail'] = f'https://{CLOUDFRONT_DOMAIN}/{thumbnail_key}'

    return results


def process_content_video(video_path: str) -> str:
    """
    Process a content video: compress and upload.

    Args:
        video_path: Path to source video

    Returns:
        CloudFront URL for the compressed video
    """
    if not check_ffmpeg():
        raise RuntimeError("ffmpeg not found. Please install ffmpeg.")

    with tempfile.TemporaryDirectory() as temp_dir:
        # Compress video
        output_path = os.path.join(temp_dir, 'compressed.mp4')
        compress_video(video_path, output_path)

        # Generate unique filename
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
        s3_key = content_video_key(f"{timestamp}.mp4")

        # Upload to S3
        s3 = get_s3_client()
        with open(output_path, 'rb') as f:
            s3.upload_fileobj(
                f,
                S3_BUCKET,
                s3_key,
                ExtraArgs={
                    'ContentType': 'video/mp4',
                    'CacheControl': 'max-age=31536000',
                }
            )

        return f'https://{CLOUDFRONT_DOMAIN}/{s3_key}'

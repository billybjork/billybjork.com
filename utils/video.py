"""
Video Processing Utilities
Handles HLS conversion, sprite sheet generation, and video compression
"""
import json
import os
import subprocess
import tempfile
import time
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
    "extract_thumbnail_frames",
    "generate_hls_only",
    "generate_sprite_and_thumbnail",
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
            '-vf', f'fps={fps},scale={frame_width}:{frame_height}:force_original_aspect_ratio=increase,crop={frame_width}:{frame_height}',
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
                '-vf', f'fps={fps},scale={frame_width}:{frame_height}:force_original_aspect_ratio=increase,crop={frame_width}:{frame_height},tile={tile_w}x{tile_h}',
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


def extract_thumbnail_frames(
    video_path: str,
    num_frames: int = 30,
    width: int = 160,
    height: int = 90
) -> Tuple[list, float]:
    """
    Extract evenly-spaced thumbnail frames from a video using ffmpeg.

    Uses input seeking (-ss before -i) for fast keyframe extraction.
    Works with any codec that ffmpeg supports, including ProRes and HEVC.

    Args:
        video_path: Path to source video
        num_frames: Number of frames to extract (default 30)
        width: Thumbnail width in pixels
        height: Thumbnail height in pixels

    Returns:
        Tuple of (list of base64 JPEG strings, video duration in seconds)
    """
    import base64

    # Get video duration first
    info = get_video_info(video_path)
    duration = info['duration']

    if duration <= 0:
        raise ValueError("Invalid video duration")

    # Calculate frame timestamps (evenly distributed)
    frame_times = [i * duration / max(num_frames - 1, 1) for i in range(num_frames)]

    frames_b64 = []

    with tempfile.TemporaryDirectory() as temp_dir:
        for i, timestamp in enumerate(frame_times):
            output_path = os.path.join(temp_dir, f'thumb_{i:03d}.jpg')

            # Use -ss before -i for fast keyframe seeking
            cmd = [
                'ffmpeg',
                '-y',
                '-ss', str(timestamp),
                '-i', video_path,
                '-vframes', '1',
                '-vf', f'scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2',
                '-q:v', '5',
                output_path
            ]

            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode != 0:
                # Skip failed frames rather than failing entire extraction
                continue

            # Read and encode as base64
            try:
                with open(output_path, 'rb') as f:
                    frame_data = f.read()
                    b64_str = base64.b64encode(frame_data).decode('utf-8')
                    frames_b64.append(b64_str)
            except Exception:
                continue

    if not frames_b64:
        raise ValueError("Failed to extract any frames from video")

    return frames_b64, duration


def process_hero_video(
    video_path: str,
    project_slug: str,
    trim_start: float = 0,
    sprite_start: float = 0,
    sprite_duration: float = 3,
    progress_callback=None,
) -> dict:
    """
    Process a hero video: generate HLS, sprite sheet, and thumbnail.

    HLS generation and sprite sheet generation run in parallel using threads.

    Args:
        video_path: Path to source video
        project_slug: Project slug for S3 key organization
        trim_start: Start time for video trim
        sprite_start: Start time for sprite sheet (relative to trim_start)
        sprite_duration: Duration for sprite sheet
        progress_callback: Optional callable(stage: str, progress: float) for progress updates

    Returns:
        Dict with URLs for HLS, sprite sheet, and thumbnail
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    if not check_ffmpeg():
        raise RuntimeError("ffmpeg not found. Please install ffmpeg.")

    def _report(stage, progress):
        if progress_callback:
            progress_callback(stage, progress)

    # Use timestamp in paths to bust CDN cache when video is replaced
    version = str(int(time.time()))
    results = {}

    with tempfile.TemporaryDirectory() as temp_dir:
        hls_dir = os.path.join(temp_dir, 'hls')
        sprite_path = os.path.join(temp_dir, 'sprite.jpg')

        # Run HLS and sprite sheet generation in parallel
        _report('Generating HLS and sprite sheet...', 10)

        def _generate_hls_task():
            generate_hls(video_path, hls_dir, start_time=trim_start)
            return 'hls'

        def _generate_sprite_task():
            _, meta = generate_sprite_sheet(
                video_path,
                sprite_path,
                start_time=trim_start + sprite_start,
                duration=sprite_duration,
            )
            return ('sprite', meta)

        sprite_meta = None
        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = {
                executor.submit(_generate_hls_task): 'hls',
                executor.submit(_generate_sprite_task): 'sprite',
            }
            completed = 0
            for future in as_completed(futures):
                result = future.result()
                completed += 1
                if isinstance(result, tuple) and result[0] == 'sprite':
                    sprite_meta = result[1]
                    _report('Sprite sheet ready, waiting for HLS...' if completed < 2 else 'Encoding complete!', 10 + completed * 20)
                else:
                    _report('HLS ready, waiting for sprite sheet...' if completed < 2 else 'Encoding complete!', 10 + completed * 20)

        # Upload HLS files to S3 with versioned path
        s3 = get_s3_client()
        hls_prefix = hero_hls_prefix(project_slug, version)
        hls_files = [p for p in Path(hls_dir).rglob('*') if p.is_file()]
        total_hls = len(hls_files)
        for i, file_path in enumerate(hls_files):
            _report(f'Uploading HLS to S3... ({i + 1}/{total_hls})', 50 + (i / max(total_hls, 1)) * 25)
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

        # Upload sprite sheet to S3 with versioned filename
        _report('Uploading sprite sheet...', 78)
        sprite_key = hero_sprite_key(project_slug, version)
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

        # Generate and upload thumbnail with versioned filename
        _report('Generating thumbnail...', 85)
        thumb_path = os.path.join(temp_dir, 'thumb.webp')
        generate_thumbnail(
            video_path,
            thumb_path,
            time=trim_start + sprite_start
        )

        thumbnail_key = hero_thumbnail_key(project_slug, version)
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
        _report('Complete!', 100)

    return results


def generate_hls_only(
    video_path: str,
    project_slug: str,
    trim_start: float = 0,
    progress_callback=None,
) -> str:
    """
    Generate and upload HLS streams only (without sprite sheet or thumbnail).

    This is used for parallel processing - HLS can start immediately after
    upload while the user is still selecting the sprite range.

    Args:
        video_path: Path to source video
        project_slug: Project slug for S3 key organization
        trim_start: Start time for video trim
        progress_callback: Optional callable(stage: str, progress: float)

    Returns:
        CloudFront URL for the HLS master playlist
    """
    if not check_ffmpeg():
        raise RuntimeError("ffmpeg not found. Please install ffmpeg.")

    def _report(stage, progress):
        if progress_callback:
            progress_callback(stage, progress)

    # Use timestamp in path to bust CDN cache when video is replaced
    version = str(int(time.time()))

    with tempfile.TemporaryDirectory() as temp_dir:
        hls_dir = os.path.join(temp_dir, 'hls')

        _report('Generating HLS streams...', 10)
        generate_hls(video_path, hls_dir, start_time=trim_start)

        # Upload HLS files to S3 with versioned path
        s3 = get_s3_client()
        hls_prefix = hero_hls_prefix(project_slug, version)
        hls_files = [p for p in Path(hls_dir).rglob('*') if p.is_file()]
        total_hls = len(hls_files)

        for i, file_path in enumerate(hls_files):
            _report(f'Uploading HLS to S3... ({i + 1}/{total_hls})', 10 + (i / max(total_hls, 1)) * 85)
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

        _report('HLS complete!', 100)
        return f'https://{CLOUDFRONT_DOMAIN}/{hls_prefix}/master.m3u8'


def generate_sprite_and_thumbnail(
    video_path: str,
    project_slug: str,
    sprite_start: float = 0,
    sprite_duration: float = 3,
    progress_callback=None,
) -> dict:
    """
    Generate sprite sheet and thumbnail, upload to S3.

    This is called after the user confirms their sprite range selection.
    Can run independently of HLS generation.

    Args:
        video_path: Path to source video
        project_slug: Project slug for S3 key organization
        sprite_start: Start time for sprite sheet
        sprite_duration: Duration for sprite sheet
        progress_callback: Optional callable(stage: str, progress: float)

    Returns:
        Dict with spriteSheet, spriteMeta, and thumbnail URLs
    """
    if not check_ffmpeg():
        raise RuntimeError("ffmpeg not found. Please install ffmpeg.")

    def _report(stage, progress):
        if progress_callback:
            progress_callback(stage, progress)

    # Use timestamp in filename to bust CDN cache when assets are replaced
    version = str(int(time.time()))
    results = {}

    with tempfile.TemporaryDirectory() as temp_dir:
        sprite_path = os.path.join(temp_dir, 'sprite.jpg')

        # Generate sprite sheet
        _report('Generating sprite sheet...', 10)
        _, sprite_meta = generate_sprite_sheet(
            video_path,
            sprite_path,
            start_time=sprite_start,
            duration=sprite_duration,
        )

        # Upload sprite sheet to S3 with versioned filename
        _report('Uploading sprite sheet...', 40)
        s3 = get_s3_client()
        sprite_key = hero_sprite_key(project_slug, version)
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

        # Generate and upload thumbnail
        _report('Generating thumbnail...', 70)
        thumb_path = os.path.join(temp_dir, 'thumb.webp')
        generate_thumbnail(
            video_path,
            thumb_path,
            time=sprite_start
        )

        # Upload thumbnail with versioned filename
        thumbnail_key = hero_thumbnail_key(project_slug, version)
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
        _report('Complete!', 100)

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

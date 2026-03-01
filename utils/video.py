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
from typing import Callable, Tuple

from .media_paths import (
    content_video_key,
    hero_hls_prefix,
    hero_sprite_key,
    hero_thumbnail_key,
)
from .s3 import CLOUDFRONT_DOMAIN, S3_BUCKET, get_s3_client

CACHE_CONTROL_IMMUTABLE = 'max-age=31536000'
ProgressCallback = Callable[[str, float], None]
HLS_HEIGHT_BITRATE_LADDER = [
    (2160, 12000),  # 4K
    (1440, 8000),   # 1440p
    (1080, 5000),   # 1080p
    (720, 2500),    # 720p
    (480, 1200),    # 480p
    (360, 800),     # 360p
    (240, 400),     # 240p
]

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


def _round_even(value: float) -> int:
    rounded = int(round(value))
    if rounded % 2 != 0:
        rounded += 1 if value >= rounded else -1
    return max(2, rounded)


def _floor_even(value: int) -> int:
    floored = int(value)
    if floored % 2 != 0:
        floored -= 1
    return max(2, floored)


def _pick_stable_variant_dimensions(
    source_width: int,
    source_height: int,
    target_height: int,
    search_radius: int = 12,
) -> tuple[int, int]:
    """
    Pick even output dimensions near target_height with minimal aspect drift.

    Searching a small height window allows us to find dimensions that preserve
    source aspect ratio more consistently across the full ladder.
    """
    safe_source_width = max(2, source_width)
    safe_source_height = max(2, source_height)
    source_ratio = safe_source_width / safe_source_height

    capped_target_height = min(max(2, target_height), safe_source_height)
    capped_target_height = _floor_even(capped_target_height)

    start = max(2, capped_target_height - search_radius)
    end = min(safe_source_height, capped_target_height + search_radius)

    best: tuple[tuple[float, int, int], int, int] | None = None
    seen_heights: set[int] = set()

    for raw_height in range(start, end + 1):
        height = _floor_even(raw_height)
        if height < 2 or height in seen_heights:
            continue
        seen_heights.add(height)

        width = _round_even(height * source_ratio)
        width = min(width, _floor_even(safe_source_width))
        if width < 2:
            continue

        aspect_drift = abs((width / height) - source_ratio)
        height_delta = abs(height - capped_target_height)
        score = (aspect_drift, height_delta, -height)

        if best is None or score < best[0]:
            best = (score, width, height)

    if best:
        return best[1], best[2]

    fallback_height = _floor_even(capped_target_height)
    fallback_width = _round_even(fallback_height * source_ratio)
    fallback_width = min(fallback_width, _floor_even(safe_source_width))
    return max(2, fallback_width), max(2, fallback_height)


def _build_hls_resolutions(source_width: int, source_height: int) -> list[tuple[int, int, int]]:
    """
    Build an HLS ladder with dimensions that stay close to the source DAR.
    """
    resolutions: list[tuple[int, int, int]] = []
    seen_dimensions: set[tuple[int, int]] = set()

    for target_height, bitrate in HLS_HEIGHT_BITRATE_LADDER:
        # Match previous behavior: only include higher tiers when source can support them.
        if target_height >= 720 and source_height < target_height:
            continue

        width, height = _pick_stable_variant_dimensions(source_width, source_height, target_height)
        dimensions = (width, height)
        if dimensions in seen_dimensions:
            continue

        seen_dimensions.add(dimensions)
        resolutions.append((width, height, bitrate))

    if resolutions:
        return resolutions

    # Extremely small/odd sources: ensure at least one valid rendition.
    return [(_floor_even(source_width), _floor_even(source_height), 800)]


def _report_progress(progress_callback: ProgressCallback | None, stage: str, progress: float) -> None:
    if progress_callback:
        progress_callback(stage, progress)


def _upload_local_file(
    s3_client,
    local_path: str | Path,
    s3_key: str,
    *,
    content_type: str
) -> None:
    with open(local_path, 'rb') as f:
        s3_client.upload_fileobj(
            f,
            S3_BUCKET,
            s3_key,
            ExtraArgs={
                'ContentType': content_type,
                'CacheControl': CACHE_CONTROL_IMMUTABLE,
            }
        )


def _upload_hls_outputs(
    s3_client,
    hls_dir: str,
    project_slug: str,
    version: str,
    *,
    progress_callback: ProgressCallback | None,
    progress_start: float,
    progress_span: float
) -> str:
    hls_prefix = hero_hls_prefix(project_slug, version)
    hls_files = [p for p in Path(hls_dir).rglob('*') if p.is_file()]
    total_hls = len(hls_files)

    for i, file_path in enumerate(hls_files):
        _report_progress(
            progress_callback,
            f'Uploading HLS to S3... ({i + 1}/{total_hls})',
            progress_start + (i / max(total_hls, 1)) * progress_span,
        )
        relative_path = file_path.relative_to(hls_dir).as_posix()
        s3_key = f'{hls_prefix}/{relative_path}'
        content_type = 'application/vnd.apple.mpegurl' if file_path.suffix == '.m3u8' else 'video/mp2t'
        _upload_local_file(s3_client, file_path, s3_key, content_type=content_type)

    return f'https://{CLOUDFRONT_DOMAIN}/{hls_prefix}/master.m3u8'


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
        '-show_entries', 'stream=width,height,r_frame_rate,duration:format=duration',
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

    stream_duration = float(stream.get('duration', 0) or 0)
    format_duration = float(data.get('format', {}).get('duration', 0) or 0)
    duration = stream_duration if stream_duration > 0 else format_duration

    return {
        'width': int(stream.get('width', 1920)),
        'height': int(stream.get('height', 1080)),
        'duration': duration,
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
    source_width = info['width']
    source_height = info['height']
    resolutions = _build_hls_resolutions(source_width, source_height)

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
        # Explicit per-rendition dimensions keep the ladder aspect-stable across ABR switches.
        filter_complex.append(
            f"[0:v]scale={width}:{height}:flags=lanczos,setsar=1[v{i}]"
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
            '-i', video_path,
            '-ss', str(start_time),
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
                '-i', video_path,
                '-ss', str(start_time),
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
        '-i', video_path,
        '-ss', str(time),
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

    if num_frames <= 0:
        raise ValueError("num_frames must be greater than 0")

    # Single-pass extraction keeps frame ordering stable and avoids repeated seeks.
    fps = num_frames / duration
    frames_b64 = []

    with tempfile.TemporaryDirectory() as temp_dir:
        output_pattern = os.path.join(temp_dir, 'thumb_%03d.jpg')
        cmd = [
            'ffmpeg',
            '-y',
            '-i', video_path,
            '-an',
            '-vf',
            f'fps={fps:.6f},scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}',
            '-frames:v', str(num_frames),
            '-q:v', '5',
            output_pattern
        ]

        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise ValueError(f"Failed to extract timeline thumbnails: {result.stderr}")

        frame_paths = sorted(Path(temp_dir).glob('thumb_*.jpg'))
        for frame_path in frame_paths[:num_frames]:
            with open(frame_path, 'rb') as f:
                frame_data = f.read()
                b64_str = base64.b64encode(frame_data).decode('utf-8')
                frames_b64.append(b64_str)

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
        _report_progress(progress_callback, stage, progress)

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

        s3 = get_s3_client()
        results['hls'] = _upload_hls_outputs(
            s3,
            hls_dir,
            project_slug,
            version,
            progress_callback=_report,
            progress_start=50,
            progress_span=25,
        )

        # Upload sprite sheet to S3 with versioned filename
        _report('Uploading sprite sheet...', 78)
        sprite_key = hero_sprite_key(project_slug, version)
        _upload_local_file(s3, sprite_path, sprite_key, content_type='image/jpeg')

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
        _upload_local_file(s3, thumb_path, thumbnail_key, content_type='image/webp')

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
        _report_progress(progress_callback, stage, progress)

    # Use timestamp in path to bust CDN cache when video is replaced
    version = str(int(time.time()))

    with tempfile.TemporaryDirectory() as temp_dir:
        hls_dir = os.path.join(temp_dir, 'hls')

        _report('Generating HLS streams...', 10)
        generate_hls(video_path, hls_dir, start_time=trim_start)

        s3 = get_s3_client()
        hls_url = _upload_hls_outputs(
            s3,
            hls_dir,
            project_slug,
            version,
            progress_callback=_report,
            progress_start=10,
            progress_span=85,
        )

        _report('HLS complete!', 100)
        return hls_url


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
        _report_progress(progress_callback, stage, progress)

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
        _upload_local_file(s3, sprite_path, sprite_key, content_type='image/jpeg')

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
        _upload_local_file(s3, thumb_path, thumbnail_key, content_type='image/webp')

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
        _upload_local_file(s3, output_path, s3_key, content_type='video/mp4')

        return f'https://{CLOUDFRONT_DOMAIN}/{s3_key}'

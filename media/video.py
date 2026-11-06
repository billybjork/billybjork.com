"""ffmpeg pipelines for hero and content videos, and uploading what they produce."""
import base64
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Callable

from media.keys import (
    hero_hls_prefix,
    hero_sprite_key,
    hero_thumbnail_key,
    new_content_video_key,
)
from media.sprite_format import DEFAULT_SPRITE_COLUMNS, SPRITE_FPS, sprite_rows
from object_storage import public_asset_url, upload_file

ProgressCallback = Callable[[str, float], None]
HLS_HEIGHT_BITRATE_LADDER = [
    (2160, 12000),
    (1440, 8000),
    (1080, 5000),
    (720, 2500),
    (480, 1200),
    (360, 800),
    (240, 400),
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


SPRITE_FRAME_LONG_EDGE = 320


def sprite_frame_size(source_width: int, source_height: int) -> tuple[int, int]:
    """Sprite frame size in the source's aspect ratio, long edge SPRITE_FRAME_LONG_EDGE.

    Homepage thumbnails take the video's shape, so sprites must too; a 16:9 crop
    of a portrait video would be cropped again to fit its thumbnail.
    """
    if source_width >= source_height:
        return SPRITE_FRAME_LONG_EDGE, _round_even(SPRITE_FRAME_LONG_EDGE * source_height / source_width)
    return _round_even(SPRITE_FRAME_LONG_EDGE * source_width / source_height), SPRITE_FRAME_LONG_EDGE


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
        if height in seen_heights:
            continue
        seen_heights.add(height)

        width = _round_even(height * source_ratio)
        width = min(width, _floor_even(safe_source_width))

        aspect_drift = abs((width / height) - source_ratio)
        height_delta = abs(height - capped_target_height)
        score = (aspect_drift, height_delta, -height)

        if best is None or score < best[0]:
            best = (score, width, height)

    return best[1], best[2]


def _build_hls_resolutions(source_width: int, source_height: int) -> list[tuple[int, int, int]]:
    resolutions: list[tuple[int, int, int]] = []
    seen_dimensions: set[tuple[int, int]] = set()

    for target_height, bitrate in HLS_HEIGHT_BITRATE_LADDER:
        # Tiers from 720p up never upscale; smaller ones always exist as a floor.
        if target_height >= 720 and source_height < target_height:
            continue

        width, height = _pick_stable_variant_dimensions(source_width, source_height, target_height)
        dimensions = (width, height)
        if dimensions in seen_dimensions:
            continue

        seen_dimensions.add(dimensions)
        resolutions.append((width, height, bitrate))

    return resolutions


def _has_audio_stream(video_path: str) -> bool:
    """Return whether the input has at least one audio stream."""
    cmd = [
        'ffprobe',
        '-v', 'error',
        '-select_streams', 'a:0',
        '-show_entries', 'stream=index',
        '-of', 'json',
        video_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        return False

    try:
        data = json.loads(result.stdout or '{}')
    except json.JSONDecodeError:
        return False

    return bool(data.get('streams'))


def _upload_local_file(local_path: str | Path, key: str, content_type: str) -> None:
    with open(local_path, 'rb') as f:
        upload_file(f, key, content_type)


def _upload_hls_outputs(
    hls_dir: str,
    project_slug: str,
    version: str,
    progress_callback: ProgressCallback,
) -> str:
    hls_prefix = hero_hls_prefix(project_slug, version)
    hls_files = [p for p in Path(hls_dir).rglob('*') if p.is_file()]

    for i, file_path in enumerate(hls_files):
        progress_callback(
            f'Uploading HLS assets... ({i + 1}/{len(hls_files)})',
            10 + (i / len(hls_files)) * 85,
        )
        relative_path = file_path.relative_to(hls_dir).as_posix()
        content_type = 'application/vnd.apple.mpegurl' if file_path.suffix == '.m3u8' else 'video/mp2t'
        _upload_local_file(file_path, f'{hls_prefix}/{relative_path}', content_type)

    return public_asset_url(f"{hls_prefix}/master.m3u8")


def _require_ffmpeg() -> None:
    try:
        subprocess.run(['ffmpeg', '-version'], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        raise RuntimeError("ffmpeg not found. Please install ffmpeg.") from exc


def get_video_info(video_path: str) -> dict:
    """
    Get video information using ffprobe.

    Returns dict with: width, height, duration, fps, start_time (the container's
    first timestamp; HLS streams often start above zero)
    """
    cmd = [
        'ffprobe',
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,r_frame_rate,duration:format=duration,start_time',
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
        'start_time': float(data.get('format', {}).get('start_time', 0) or 0),
    }


def _encode_hls(video_path: str, output_dir: str) -> None:
    """Write an adaptive-bitrate HLS ladder with master.m3u8 into output_dir."""
    info = get_video_info(video_path)
    source_width = info['width']
    source_height = info['height']
    source_fps = max(float(info.get('fps') or 0), 1.0)
    has_audio = _has_audio_stream(video_path)
    resolutions = _build_hls_resolutions(source_width, source_height)
    segment_duration = 6
    gop_size = max(24, int(round(source_fps * segment_duration)))

    os.makedirs(output_dir, exist_ok=True)

    filter_complex = []
    maps = []
    stream_maps = []
    stream_options = []
    audio_options = ['-c:a', 'aac', '-b:a', '128k'] if has_audio else []

    for i, (width, height, bitrate) in enumerate(resolutions):
        # Explicit per-rendition dimensions keep the ladder aspect-stable across ABR switches.
        filter_complex.append(
            f"[0:v]scale={width}:{height}:flags=lanczos,setsar=1[v{i}]"
        )
        maps.extend(['-map', f'[v{i}]'])
        if has_audio:
            maps.extend(['-map', '0:a:0'])
            stream_maps.append(f'v:{i},a:{i}')
        else:
            stream_maps.append(f'v:{i}')

        maxrate = int(round(bitrate * 1.2))
        bufsize = maxrate * 2
        stream_options.extend([
            f'-b:v:{i}', f'{bitrate}k',
            f'-maxrate:v:{i}', f'{maxrate}k',
            f'-bufsize:v:{i}', f'{bufsize}k',
        ])

    cmd = [
        'ffmpeg',
        '-y',
        '-i', video_path,
        '-filter_complex', ';'.join(filter_complex),
        *maps,
        '-c:v', 'libx264',
        '-preset', 'slow',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-g', str(gop_size),
        '-keyint_min', str(gop_size),
        '-sc_threshold', '0',
        '-force_key_frames', f'expr:gte(t,n_forced*{segment_duration})',
        *stream_options,
        *audio_options,
        '-f', 'hls',
        '-hls_time', str(segment_duration),
        '-hls_list_size', '0',
        '-hls_flags', 'independent_segments',
        '-hls_playlist_type', 'vod',
        '-hls_segment_filename', os.path.join(output_dir, 'seg_%v_%03d.ts'),
        '-master_pl_name', 'master.m3u8',
        '-var_stream_map', ' '.join(stream_maps),
        os.path.join(output_dir, 'playlist_%v.m3u8')
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise ValueError(f"HLS generation failed: {result.stderr}")


def _generate_sprite_sheet(
    video_path: str,
    output_path: str,
    start_time: float,
    duration: float,
) -> dict:
    """Tile frames of a time range into one image in the source's aspect ratio; returns its layout."""
    info = get_video_info(video_path)
    frame_width, frame_height = sprite_frame_size(info['width'], info['height'])
    columns = DEFAULT_SPRITE_COLUMNS
    fps = SPRITE_FPS
    total_frames = int(duration * fps)

    with tempfile.TemporaryDirectory() as temp_dir:
        frames_pattern = os.path.join(temp_dir, 'frame_%04d.jpg')

        # Input seeking (before -i) is frame-accurate when re-encoding; output
        # seeking after the fps filter can land a second or more off the range.
        # It seeks on the container clock, so offset by the first timestamp to
        # keep start_time relative to the first frame, as the editor timeline is.
        seek_time = start_time + info['start_time']
        cmd = [
            'ffmpeg',
            '-y',
            '-ss', str(seek_time),
            '-i', video_path,
            '-t', str(duration),
            '-vf', f'fps={fps},scale={frame_width}:{frame_height}:flags=lanczos,setsar=1',
            '-q:v', '5',
            frames_pattern
        ]

        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise ValueError(f"Frame extraction failed: {result.stderr}")

        frames = sorted(Path(temp_dir).glob('frame_*.jpg'))
        actual_frames = min(len(frames), total_frames)

        if actual_frames == 0:
            raise ValueError("No frames extracted")

        rows = sprite_rows(actual_frames, columns)
        tile_cmd = [
            'ffmpeg',
            '-y',
            '-framerate', str(fps),
            '-i', frames_pattern,
            '-vf', f'tile={columns}x{rows}',
            '-frames:v', '1',
            '-q:v', '5',
            output_path,
        ]
        result = subprocess.run(tile_cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise ValueError(f"Sprite sheet creation failed: {result.stderr}")

    return {
        'frames': actual_frames,
        'columns': columns,
        'rows': rows,
        'frame_width': frame_width,
        'frame_height': frame_height,
        'fps': fps,
    }


def generate_thumbnail(
    video_path: str,
    output_path: str,
    time: float = 0,
    width: int = 1280,
    height: int = 720,
) -> None:
    """Extract a single frame as WebP, fit inside width x height."""
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


def extract_thumbnail_frames(video_path: str, num_frames: int, width: int, height: int) -> list[str]:
    """Evenly spaced timeline frames as base64 JPEGs. Works with any codec ffmpeg reads."""
    duration = get_video_info(video_path)['duration']
    if duration <= 0:
        raise ValueError("Invalid video duration")

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
                frames_b64.append(base64.b64encode(f.read()).decode('utf-8'))

    if not frames_b64:
        raise ValueError("Failed to extract any frames from video")

    return frames_b64


def encode_and_upload_hls(
    video_path: str,
    project_slug: str,
    version: str,
    progress_callback: ProgressCallback,
) -> str:
    """Runs right after upload, while the user is still choosing a sprite range."""
    _require_ffmpeg()

    with tempfile.TemporaryDirectory() as temp_dir:
        hls_dir = os.path.join(temp_dir, 'hls')
        progress_callback('Generating HLS streams...', 10)
        _encode_hls(video_path, hls_dir)
        return _upload_hls_outputs(hls_dir, project_slug, version, progress_callback)


def generate_sprite_and_poster(
    video_path: str,
    project_slug: str,
    sprite_start: float,
    sprite_duration: float,
) -> dict:
    """Upload a sprite sheet of the chosen range and a poster, always of the first frame."""
    _require_ffmpeg()
    version = str(int(time.time()))

    with tempfile.TemporaryDirectory() as temp_dir:
        sprite_path = os.path.join(temp_dir, 'sprite.jpg')
        sprite_meta = _generate_sprite_sheet(video_path, sprite_path, sprite_start, sprite_duration)
        sprite_key = hero_sprite_key(project_slug, version)
        _upload_local_file(sprite_path, sprite_key, 'image/jpeg')

        thumb_path = os.path.join(temp_dir, 'thumb.webp')
        generate_thumbnail(video_path, thumb_path)
        thumbnail_key = hero_thumbnail_key(project_slug, version)
        _upload_local_file(thumb_path, thumbnail_key, 'image/webp')

    return {
        'spriteSheet': public_asset_url(sprite_key),
        'spriteMeta': sprite_meta,
        'thumbnail': public_asset_url(thumbnail_key),
    }


def compress_and_upload_content_video(video_path: str) -> str:
    _require_ffmpeg()

    with tempfile.TemporaryDirectory() as temp_dir:
        output_path = os.path.join(temp_dir, 'compressed.mp4')
        cmd = [
            'ffmpeg',
            '-y',
            '-i', video_path,
            '-vf', "scale=-2:'min(720,ih)'",
            '-c:v', 'libx264',
            '-preset', 'slow',
            '-crf', '28',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-movflags', '+faststart',
            output_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            raise ValueError(f"Video compression failed: {result.stderr}")

        key = new_content_video_key()
        _upload_local_file(output_path, key, 'video/mp4')
        return public_asset_url(key)

"""
Image Processing Utilities
Handles image resizing and WebP conversion
"""
import io
from typing import BinaryIO, Tuple

from PIL import Image

__all__ = ["process_image"]

# Configuration
MAX_IMAGE_WIDTH = 2000
MAX_IMAGE_HEIGHT = 2000
WEBP_QUALITY = 80


def process_image(
    file_data: BinaryIO,
    max_width: int = MAX_IMAGE_WIDTH,
    max_height: int = MAX_IMAGE_HEIGHT,
    quality: int = WEBP_QUALITY
) -> Tuple[BinaryIO, str]:
    """
    Process an image: resize if needed and convert to WebP.

    Args:
        file_data: Input image file data
        max_width: Maximum width (maintains aspect ratio)
        max_height: Maximum height (maintains aspect ratio)
        quality: WebP quality (1-100)

    Returns:
        Tuple of (processed image data as BytesIO, content_type)

    Raises:
        ValueError: If image cannot be processed
    """
    try:
        img = Image.open(file_data)
    except Exception as e:
        raise ValueError(f"Failed to open image: {e}")

    # Convert to RGB if necessary (handles RGBA, P mode, etc.)
    if img.mode in ('RGBA', 'LA', 'P'):
        # Create white background for transparency
        background = Image.new('RGB', img.size, (255, 255, 255))
        if img.mode == 'P':
            img = img.convert('RGBA')
        background.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
        img = background
    elif img.mode != 'RGB':
        img = img.convert('RGB')

    # Resize if needed (maintain aspect ratio)
    width, height = img.size
    if width > max_width or height > max_height:
        ratio = min(max_width / width, max_height / height)
        new_width = int(width * ratio)
        new_height = int(height * ratio)
        img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)

    # Convert to WebP
    output = io.BytesIO()
    img.save(output, format='WEBP', quality=quality, method=6)
    output.seek(0)

    return output, 'image/webp'

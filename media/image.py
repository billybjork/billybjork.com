import io
from typing import BinaryIO

from PIL import Image, ImageOps

MAX_IMAGE_DIMENSION = 2000
WEBP_QUALITY = 80


def process_image(file_data: BinaryIO) -> bytes:
    """The image as WebP bytes, resized to fit the maximum dimensions.

    Raises ValueError for data that isn't an image.
    """
    try:
        img = ImageOps.exif_transpose(Image.open(file_data))
    except Exception as e:
        raise ValueError(f"Failed to open image: {e}")

    if img.mode in ('RGBA', 'LA', 'P'):
        # Transparency flattens onto white.
        img = img.convert('RGBA')
        background = Image.new('RGB', img.size, (255, 255, 255))
        background.paste(img, mask=img.split()[-1])
        img = background
    elif img.mode != 'RGB':
        img = img.convert('RGB')

    width, height = img.size
    if width > MAX_IMAGE_DIMENSION or height > MAX_IMAGE_DIMENSION:
        ratio = min(MAX_IMAGE_DIMENSION / width, MAX_IMAGE_DIMENSION / height)
        new_width = int(width * ratio)
        new_height = int(height * ratio)
        img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)

    output = io.BytesIO()
    img.save(output, format='WEBP', quality=WEBP_QUALITY, method=6)
    return output.getvalue()

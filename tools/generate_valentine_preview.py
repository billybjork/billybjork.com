#!/usr/bin/env python3
"""
Generate a preview/OG image for the Valentine's page.
Creates a mini collage using the segment images.
"""

from pathlib import Path
from PIL import Image, ImageDraw
import random

# Configuration
SEGMENTS_DIR = Path(__file__).parent.parent / "static" / "valentine" / "segments"
OUTPUT_PATH = Path(__file__).parent.parent / "static" / "valentine" / "valentine-preview.jpg"

# Standard OG image size
WIDTH = 1200
HEIGHT = 630

# Pink gradient colors (matching the site)
BACKGROUND_COLOR = "#ff6b9d"

# Select a subset of images to use (5-6 images for cleaner look)
SELECTED_IMAGES = [
    "IMG_0285_segment.png",
    "IMG_4789_segment.png",
    "IMG_5062_segment.png",
    "IMG_6274_segment.png",
    "IMG_4029_segment.png",
    "IMG_5135_segment.png",
]

# Positions for 6 images [x, y, rotation, scale]
POSITIONS = [
    (50, 80, -8, 0.45),      # Top left
    (600, 50, 5, 0.5),       # Top right
    (200, 300, -6, 0.4),     # Middle left
    (750, 280, 7, 0.45),     # Middle right
    (950, 150, -5, 0.4),     # Upper right
    (400, 450, 8, 0.42),     # Bottom center
]


def create_gradient_background(width, height):
    """Create a vertical pink gradient background."""
    img = Image.new('RGB', (width, height))
    draw = ImageDraw.Draw(img)

    # Define gradient colors
    color_top = (255, 107, 157)     # #ff6b9d
    color_mid = (255, 166, 193)     # #ffa6c1
    color_bottom = (255, 133, 171)  # #ff85ab

    for y in range(height):
        if y < height / 2:
            # Top half: interpolate from top to mid
            ratio = y / (height / 2)
            r = int(color_top[0] + (color_mid[0] - color_top[0]) * ratio)
            g = int(color_top[1] + (color_mid[1] - color_top[1]) * ratio)
            b = int(color_top[2] + (color_mid[2] - color_top[2]) * ratio)
        else:
            # Bottom half: interpolate from mid to bottom
            ratio = (y - height / 2) / (height / 2)
            r = int(color_mid[0] + (color_bottom[0] - color_mid[0]) * ratio)
            g = int(color_mid[1] + (color_bottom[1] - color_mid[1]) * ratio)
            b = int(color_mid[2] + (color_bottom[2] - color_mid[2]) * ratio)

        draw.line([(0, y), (width, y)], fill=(r, g, b))

    return img


def main():
    """Generate the preview image."""
    print(f"Generating Valentine's preview image...")

    # Create background
    canvas = create_gradient_background(WIDTH, HEIGHT)

    # Load and composite each image
    for i, (filename, (x, y, rotation, scale)) in enumerate(zip(SELECTED_IMAGES, POSITIONS)):
        segment_path = SEGMENTS_DIR / filename

        if not segment_path.exists():
            print(f"  ⚠ Warning: {filename} not found, skipping")
            continue

        print(f"  Adding {filename}...")

        # Load segment image
        segment = Image.open(segment_path)

        # Scale the image
        new_width = int(segment.width * scale)
        new_height = int(segment.height * scale)
        segment = segment.resize((new_width, new_height), Image.Resampling.LANCZOS)

        # Rotate the image
        segment = segment.rotate(rotation, expand=True, resample=Image.Resampling.BICUBIC)

        # Calculate position (center the rotated image at x, y)
        paste_x = int(x - segment.width / 2)
        paste_y = int(y - segment.height / 2)

        # Paste with alpha channel (transparency)
        canvas.paste(segment, (paste_x, paste_y), segment if segment.mode == 'RGBA' else None)

    # Save as JPEG
    # Convert to RGB if it has alpha channel
    if canvas.mode == 'RGBA':
        # Create RGB background
        rgb_canvas = Image.new('RGB', canvas.size, BACKGROUND_COLOR)
        rgb_canvas.paste(canvas, (0, 0), canvas)
        canvas = rgb_canvas

    canvas.save(OUTPUT_PATH, 'JPEG', quality=90, optimize=True)
    print(f"\n✓ Preview image saved to: {OUTPUT_PATH}")
    print(f"  Size: {WIDTH}x{HEIGHT}px")


if __name__ == "__main__":
    main()

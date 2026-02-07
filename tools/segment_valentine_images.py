#!/usr/bin/env python3
"""
Segment people from source images using fal.ai SAM 3.
Outputs transparent PNG cutouts to static/valentine/segments/
"""

import os
from pathlib import Path
import fal_client

# Configuration
FAL_KEY = "c0c4d137-b314-45aa-ab21-12d01303600b:32dfb6d0b3fc7fa291ce141c7f86d80e"
SOURCE_DIR = Path("/Users/billy/Downloads/images")
OUTPUT_DIR = Path(__file__).parent.parent / "static" / "valentine" / "segments"

SOURCE_IMAGES = [
    # Original 8 images
    "IMG_0285.JPG",
    "IMG_4789.jpeg",
    "IMG_5062.jpeg",
    "IMG_6274.jpeg",
    "IMG_6511.jpeg",
    "IMG_7381.jpeg",
    "IMG_7427.jpeg",
    "Nick&George-334.jpg",
    # New images
    "DSCF2973.jpeg",
    "IMG_3595.jpeg",
    "IMG_4015.jpeg",
    "IMG_4029.jpeg",
    "IMG_4763.jpeg",
    "IMG_4814.jpeg",
    "IMG_5077.jpeg",
    "IMG_5135.jpeg",
    "IMG_5141.jpeg",
    "IMG_5251.jpeg",
]


def segment_image(image_path: Path, output_path: Path) -> bool:
    """
    Segment a person from an image using fal.ai SAM 3.

    Args:
        image_path: Path to source image
        output_path: Path to save segmented PNG

    Returns:
        True if successful, False otherwise
    """
    print(f"Processing {image_path.name}...")

    try:
        # Upload image to fal.ai
        print(f"  Uploading...")
        image_url = fal_client.upload_file(str(image_path))
        print(f"  Uploaded to: {image_url}")

        # Run SAM 3 segmentation
        print(f"  Running segmentation...")
        result = fal_client.subscribe(
            "fal-ai/sam-3/image",
            arguments={
                "image_url": image_url,
                "prompt": "person",
                "apply_mask": True,  # Returns masked image with transparent background
            }
        )

        # Get the segmented image URL
        segmented_url = result["image"]["url"]
        print(f"  Segmented image: {segmented_url}")

        # Download the segmented image
        print(f"  Downloading...")
        import requests
        response = requests.get(segmented_url)
        response.raise_for_status()

        # Save to output path
        output_path.write_bytes(response.content)
        print(f"  ✓ Saved to {output_path}")
        return True

    except Exception as e:
        print(f"  ✗ Error: {e}")
        return False


def main():
    """Process all source images."""
    # Set API key
    os.environ["FAL_KEY"] = FAL_KEY

    # Create output directory
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Output directory: {OUTPUT_DIR}\n")

    # Process each image
    success_count = 0
    for image_name in SOURCE_IMAGES:
        source_path = SOURCE_DIR / image_name

        # Check if source exists
        if not source_path.exists():
            print(f"⚠ Warning: {image_name} not found in {SOURCE_DIR}")
            continue

        # Output filename: same name but with .png extension
        output_name = source_path.stem + "_segment.png"
        output_path = OUTPUT_DIR / output_name

        # Skip if already processed
        if output_path.exists():
            print(f"Skipping {image_name} (already processed)")
            success_count += 1
            continue

        # Process the image
        if segment_image(source_path, output_path):
            success_count += 1

        print()  # Blank line between images

    # Summary
    print(f"\nCompleted: {success_count}/{len(SOURCE_IMAGES)} images successfully segmented")
    print(f"Segments saved to: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()

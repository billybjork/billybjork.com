# Valentine's Page - Handoff Prompt

## Project Goal
Create a `/will-you-be-my-valentine` route with interactive 3D Gaussian splats of a person segmented from ~8 photos. The route should be self-contained and not affect the rest of the FastAPI app.

## What's Been Done

### 1. 3D Generation Pipeline (WORKING)
A two-step fal.ai pipeline that successfully generates 3D Gaussian splats:
1. **SAM 3** (`fal-ai/sam-3/image`) - segments the person and returns bounding box
2. **SAM 3D Objects** (`fal-ai/sam-3/3d-objects`) - generates PLY splat from the segmented region

**Test successful**: Generated `test_person0.ply` (18.6 MB) from `Nick&George-334.jpg`

**API Key**: `FAL_KEY=c0c4d137-b314-45aa-ab21-12d01303600b:32dfb6d0b3fc7fa291ce141c7f86d80e`

### 2. Files Created (in `static/valentine/`)
- `valentine.js` - Three.js + GaussianSplats3D viewer code
- `valentine.css` - Styling for the page
- `models/test_person0.ply` - One working 3D splat (18.6 MB)
- `models/test_person0.glb` - GLB backup (8 MB)
- `models/manifest.json` - Lists PLY files to load
- `scripts/test_single_image.py` - Working single-image test script
- `scripts/generate_splats.py` - Batch processing script (needs updating)

### 3. Source Images
Location: `/Users/billy/Downloads/images/` (8 images)
- IMG_0285.JPG, IMG_4789.jpeg, IMG_5062.jpeg, IMG_6274.jpeg
- IMG_6511.jpeg, IMG_7381.jpeg, IMG_7427.jpeg, Nick&George-334.jpg

## What's Left To Do

### 1. Fix Frontend Viewer (SharedArrayBuffer Issue)
The GaussianSplats3D library requires `SharedArrayBuffer` which needs these HTTP headers:
```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

**Options**:
- Add these headers to the FastAPI route (but may break CDN imports)
- Use `sharedMemoryForWorkers: false` in viewer config (already added, needs testing)
- Switch to a different splat viewer library
- Host Three.js/GaussianSplats3D locally instead of CDN

### 2. Create FastAPI Route
Add a route in `routers/` that:
- Serves the valentine page at `/will-you-be-my-valentine`
- Sets proper COOP/COEP headers if needed
- Renders a template that loads the JS/CSS

### 3. Process All 8 Images
Update and run the batch script to generate splats for all images:
```bash
cd /Users/billy/Dropbox/Projects/billybjork.com/src/static/valentine
FAL_KEY="c0c4d137-b314-45aa-ab21-12d01303600b:32dfb6d0b3fc7fa291ce141c7f86d80e" python3 scripts/generate_splats.py
```

The `generate_splats.py` script needs to be updated to use the working two-step approach from `test_single_image.py`.

### 4. Final Polish
- Add Valentine's Day text/graphics
- Style improvements
- Test on mobile

## Key Technical Details

### Working SAM 3D API Call Pattern
```python
# Step 1: Get bounding box with SAM 3
seg_result = fal_client.subscribe(
    "fal-ai/sam-3/image",
    arguments={
        "image_url": uploaded_url,
        "prompt": "person",
        "include_boxes": True,
    }
)
box = seg_result["boxes"][0]  # [cx, cy, w, h] normalized

# Step 2: Convert box and call SAM 3D Objects
box_prompt = {
    "x_min": int((box[0] - box[2]/2) * img_width),
    "y_min": int((box[1] - box[3]/2) * img_height),
    "x_max": int((box[0] + box[2]/2) * img_width),
    "y_max": int((box[1] + box[3]/2) * img_height),
    "object_id": 0
}

result_3d = fal_client.subscribe(
    "fal-ai/sam-3/3d-objects",
    arguments={
        "image_url": uploaded_url,
        "box_prompts": [box_prompt],
    }
)

ply_url = result_3d["gaussian_splat"]["url"]
```

### Image Orientation
Several source images have EXIF rotation. The scripts use PIL to fix orientation before uploading.

## Spec Reference
Full spec at: `/Users/billy/Downloads/valentines-spec.md`

Key points:
- Use Gaussian splats (PLY), NOT GLB meshes (washed-out textures)
- Spark.js or GaussianSplats3D for rendering
- Vertical scroll layout with text between 3D viewers
- Horizontal-only rotation for each viewer

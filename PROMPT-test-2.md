# Create /test-2: Point Cloud Rendering from RGBD Sprite Sheets

## Context

This is a FastAPI + Jinja2 website. There's an existing `/test` route (`routers/test.py` + `templates/test.html`) that renders RGBD sprite sheet animations as 3D displaced meshes using Three.js custom shaders. It works well but suffers from mesh stretching at depth discontinuities (where foreground meets background).

The `/test-2` page should explore a fundamentally different rendering approach: **treating the RGBD data as a point cloud** rather than a displaced mesh. The same sprite sheet assets (RGB + depth atlas textures in `static/test/rgbd-sprites/`) are reused with zero pipeline changes — just the rendering changes.

## The Core Idea

Each pixel in an RGBD sprite frame is a point in 3D space:
- **X, Y** come from the pixel's UV coordinates on the plane
- **Z** comes from the depth map value
- **Color** comes from the RGB texture

Instead of creating a `THREE.PlaneGeometry` mesh and displacing vertices (which creates stretching at depth edges), we create a `THREE.Points` object where every point is independently positioned. Points at depth discontinuities simply have gaps between them rather than stretched triangles — this is both more correct and more visually interesting.

## What to Build

### 1. Route & Template Setup

Follow the existing patterns exactly:

**`routers/test_2.py`** — Minimal router:
```python
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from config import templates

router = APIRouter()

@router.get("/test-2", response_class=HTMLResponse)
async def test_2_page(request: Request):
    """Render the point cloud depth test page."""
    return templates.TemplateResponse(
        "test-2.html",
        {
            "request": request,
            "page_title": "Point Cloud Depth Test",
            "page_meta_description": "Testing point cloud rendering from RGBD sprite sheets",
        },
    )
```

**`main.py`** — Register the router (add import and `app.include_router(test_2.router)` alongside the existing test router).

**`templates/test-2.html`** — Extends `base.html` with the same block structure as `test.html`. Reuses the same 4 sprite sets from `/static/test/rgbd-sprites/` (somewhere-in-space, gravity, lead-me-home, surf). Same metadata.json format. Same scroll-based animation system. Same control panel pattern (collapsible, fixed position).

### 2. Point Cloud Renderer

Replace the mesh-based `DepthThumbnail` class with a point-cloud-based version. Key implementation:

**Geometry**: Instead of `THREE.PlaneGeometry`, create a `THREE.BufferGeometry` with one vertex per pixel (or a configurable density subset). For 640x360 that's up to 230,400 points — well within Three.js performance budget. Generate positions as a grid in the vertex shader or pre-compute a grid of UV coordinates as a buffer attribute.

The most elegant approach: create a buffer with just UV coordinates (or pixel indices), then in the **vertex shader** sample both the RGB atlas and depth atlas to determine each point's 3D position and color. This way frame changes just update a `frameIndex` uniform — no buffer updates needed.

```
Vertex Buffer: [u, v] for each point in the grid (static, never changes)
Vertex Shader:
  1. Use u,v to compute atlas UV for current frame
  2. Sample depth texture → z position
  3. Map u,v to x,y plane coordinates
  4. Apply depth as z displacement (back-project into 3D)
  5. Pass color UV to fragment shader
Fragment Shader:
  1. Sample RGB texture at the passed UV
  2. Apply point coloring, opacity, effects
```

**Point sizing**: Use `gl_PointSize` in the vertex shader. Base size should fill the gaps at the camera's default distance. Scale by:
- Distance from camera (perspective attenuation)
- Depth value (closer points slightly larger to fill gaps)
- A user-controllable "point size" uniform

**Camera**: Use `THREE.PerspectiveCamera`. Position should respond to:
- **Scroll position** (Y-axis tilt, same as /test — based on element's viewport position)
- **Mouse position** (X and Y offset, mapped from cursor position relative to the canvas). This is the big immersion upgrade — two additional degrees of freedom.
- Smooth interpolation (lerp) toward target positions, matching /test's `0.12` factor.

### 3. Shader Effects & Controls

Build a control panel with these parameters (same collapsible UI pattern as /test):

**Base Settings:**
- **Point Density** — Fraction of pixels to render (1.0 = every pixel, 0.5 = every other, 0.25 = quarter). Use a stride when generating the UV grid. Lower density = more visible point cloud aesthetic, better performance. Default: 0.5 or so.
- **Point Size** — Base size multiplier. Default: tune so gaps are minimal at default density.
- **Depth Amount** — Z-displacement scale (same as /test). Default: 25.
- **Tilt Range** — Max camera tilt angle in degrees. Default: 20.
- **Mouse Parallax Strength** — How much the mouse moves the camera in X/Y. Default: something subtle like 10-15.

**Point Cloud Style:**
- **Point Shape** — Toggle between square (default `gl.POINTS`), circle (discard fragments outside radius in fragment shader), and soft/gaussian (smooth falloff from center). Default: soft.
- **Size Attenuation** — Whether points get smaller with distance (perspective). Boolean. Default: true.
- **Depth-Based Sizing** — Scale point size by depth (closer = larger). Float multiplier. Default: slight, like 1.2x.
- **Opacity** — Global point opacity. Range 0-1. Default: 1.0.
- **Depth-Based Opacity** — Fade distant points. Boolean + strength. Default: off.

**Creative Effects:**
- **Edge Scatter** — At depth discontinuities (high gradient magnitude, same Sobel detection as /test), randomly offset point positions to create a dissolving/dispersing effect. This turns the "problem" of depth edges into a feature. Controllable strength (0 = no scatter, higher = more dispersion). Default: subtle.
- **Edge Scatter uses noise** — Use a noise function (simple hash or value noise) seeded by UV + frame index to make scatter feel organic, not uniform.
- **Depth of Field** — Blur simulation: points far from a focal depth get larger but more transparent, simulating bokeh. Focal depth slider + strength. Default: off.
- **Color Mode** — Toggle: Original RGB, depth-colorized (viridis-like gradient), normal-colorized, or a blend. Default: Original RGB.

**Debug Views** (mutually exclusive, same pattern as /test):
- Show depth (grayscale depth values)
- Show point density (visualize the grid)
- Show edges (highlight high-gradient areas)

### 4. Animation System

Copy the scroll-based animation system from /test exactly:
- Scroll velocity drives `animationSpeed`
- Deceleration physics with `baseDeceleration: 15` and dynamic factor
- `animationProgress` accumulates, each thumbnail calculates `frameIndex = floor(progress) % frames`
- `pixelsPerFrame = 15` (scroll distance per frame advance)
- Same `startAnimationLoop` / `stopAnimationLoop` / `animationLoop` pattern
- Same visibility API handling

### 5. Mouse Parallax

Add mouse tracking that drives camera X/Y position:

```javascript
// Track mouse position relative to each canvas
canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    // Normalized -1 to 1
    this.mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouseY = ((e.clientY - rect.top) / rect.height) * 2 - 1;
});

canvas.addEventListener('mouseleave', () => {
    // Smoothly return to center
    this.mouseX = 0;
    this.mouseY = 0;
});
```

In the update loop, lerp the camera position:
```javascript
const targetX = this.mouseX * config.mouseParallaxStrength;
const targetY = /* scroll-based tilt */ + this.mouseY * config.mouseParallaxStrength;
this.camera.position.x += (targetX - this.camera.position.x) * 0.08;
// ... similar for Y with scroll tilt combined
this.camera.lookAt(0, 0, config.depthAmount / 2);
```

### 6. Mobile: Device Orientation

Add optional gyroscope support for mobile:

```javascript
if (window.DeviceOrientationEvent) {
    window.addEventListener('deviceorientation', (e) => {
        // Map device tilt to camera position
        // beta = front/back tilt, gamma = left/right tilt
        this.deviceX = (e.gamma || 0) / 45; // Normalize to roughly -1..1
        this.deviceY = (e.beta || 0) / 45;
    });
}
```

Blend with mouse input (use whichever is active).

### 7. Performance Considerations

- At 0.5 density on 640x360, that's ~115K points per thumbnail, 4 thumbnails = ~460K points total. Well within budget for 60fps.
- Use `THREE.Points` with `BufferGeometry` — single draw call per thumbnail.
- The UV grid buffer is static (created once). Only uniforms change per frame.
- Texture sampling in the vertex shader is the main cost — same as /test's mesh approach.
- Set `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))` same as /test.

### 8. Visual Reference / Art Direction

The aesthetic should feel like a **living photograph dissolving into particles at its depth boundaries**. In smooth, confident depth regions, points are packed tightly enough to look like a continuous image — you barely notice they're points. But at depth edges (foreground objects against backgrounds), points scatter and disperse, creating an organic, almost gaseous transition. It should feel like the image is held together by depth coherence and falls apart where that coherence breaks.

When the user moves their mouse across the thumbnail, the perspective shift should feel **immediate and physical** — like looking through a window at a real 3D scene. The point cloud gaps that appear during parallax movement reinforce the sense of looking at a real volumetric space rather than a flat image.

## Existing Code Reference

Study `templates/test.html` carefully — it has the complete working implementation for the mesh-based approach. The `/test-2` page should:
- Reuse the same HTML structure (project items, canvas elements, control panel, debug overlays, global stats)
- Reuse the same CSS patterns (dark theme, fixed controls, thumbnail containers)
- Reuse the same asset loading code (`loadSpriteSet`, `loadTexture`, metadata parsing)
- Reuse the same animation system (scroll handling, deceleration, frame advancement)
- Replace only the rendering: `DepthThumbnail` class internals (geometry creation, shaders, camera control)

## Files to Create/Modify

1. **Create** `routers/test_2.py`
2. **Modify** `main.py` — add import and router inclusion
3. **Create** `templates/test-2.html` — full page implementation

No new assets needed — reuse everything in `static/test/rgbd-sprites/`.

// Shared defaults and constants for the /test point-cloud runtime.
(function() {
    'use strict';

    const defaults = {
        // Base settings (these are the "edge" / exploded values)
        pointDensity: 0.5,
        pointSize: 2.0,
        depthAmount: 25,          // Depth at edges (exploded)
        tiltRange: 20,
        mouseParallax: 12,
        // Viewport coherence - interpolation between edge (exploded) and center (coherent)
        depthAmountCenter: 8,     // Depth at center (coherent) - flatter, clearer
        edgeScatterCenter: 0,     // Scatter at center (coherent) - no scatter, clean
        opacityEdge: 0.85,        // Opacity at edges - slightly transparent/ethereal
        transitionCurve: 0.6,     // Power curve: <1 = wider center zone, >1 = narrower
        // Point cloud style
        pointShape: 0, // 0 = soft, 1 = circle, 2 = square
        sizeAttenuation: true,
        depthSizing: 1.2,
        colorGain: 1.18,          // Compensation for darker look with strict occlusion
        opacityBoost: 1.22,       // Lift mid-alpha to reduce perceived darkening
        opacity: 1.0,             // Opacity at center (coherent) - full opacity
        depthOpacity: false,
        // Creative effects (these are the "edge" / exploded values)
        edgeScatter: 0.8,         // Scatter at edges (exploded) - high dispersion
        edgeThreshold: 0.15,
        // Ambient motion (always-on subtle flow)
        ambientWaveStrength: 0.22,
        ambientWaveFrequency: 13.0,
        ambientWaveSpeed: 0.7,
        ambientWaveDepthInfluence: 0.085,
        ambientWaveLateral: 0.25,
        dofEnable: false,
        dofFocal: 0.5,
        dofStrength: 1.0,
        alphaClip: 0.05,          // Ignore depth writes only when cloud is nearly transparent
        prepassRadius: 0.48,      // Circular depth footprint for soft points
        // Color mode
        colorMode: 0, // 0 = original, 1 = depth, 2 = normal, 3 = blend
        // Debug
        showDepth: false,
        showEdges: false,
        showDensity: false,
    };

    const constants = {
        SPRITE_BASE_PATH: '/static/test/rgbd-sprites',
        PREFERRED_FRAME_WIDTH: 640,
        PREFERRED_FRAME_HEIGHT: 360,
        PLANE_BASE_HEIGHT: 45.0,
        CAMERA_FOV: 50,
        CAMERA_Z: 100,
        TILT_ORBIT_VERTICAL_SCALE: 1.0,
        PAN_Y_CAMERA_INFLUENCE: 0.25,
        PAN_Y_LOOK_INFLUENCE: 0.15,
        CLOUD_FILL_FACTOR: 0.96,
        RENDER_MARGIN: 180,
        DENSITY_REBUILD_DEBOUNCE_MS: 120,
        ACTIVE_SCROLL_RECT_REFRESH_MS: 140,
        STARTUP_STABILIZE_MS: 900,
        SCROLL_SPEED_SMOOTHING: 0.35,
    };

    window.TestPageConfig = Object.freeze({
        defaults: Object.freeze(defaults),
        constants: Object.freeze(constants),
    });
})();

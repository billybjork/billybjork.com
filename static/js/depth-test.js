/**
 * Depth-Layered Sprite Sheet Viewer
 *
 * Loads metadata.json to configure layers, resolutions, and parallax.
 * - Scroll velocity drives temporal frame advance with momentum/deceleration.
 * - Scroll position drives vertical parallax (near layers shift more).
 * - Mouse / device tilt drives horizontal parallax between depth layers.
 * - Render loop runs continuously so controls and parallax always update.
 */
(function () {
    'use strict';

    var SPRITES_BASE = '/static/test/layered-sprites';

    // Populated from metadata.json
    var meta = null;
    var activeRes = null;

    // Animation state
    var state = {
        // Frame advance (scroll-velocity driven)
        animationProgress: 0,
        animationSpeed: 0,
        lastScrollTop: 0,
        lastScrollTime: Date.now(),
        lastFrameTime: Date.now(),
        rafId: null,

        // Parallax (smoothed)
        mouseX: 0.5,
        mouseY: 0.5,
        parallaxX: 0,
        parallaxY: 0,

        // Scroll-position parallax
        scrollParallaxY: 0,
        scrollParallaxYSmooth: 0,
    };

    // Tweakable config (bound to sliders)
    var config = {
        parallaxIntensity: 30,
        pixelsPerFrame: 6,
        temporalSpeed: 1,
        maxAnimationSpeed: 30,
        baseDeceleration: 15,
        layerSpread: 20,
        perspective: 800,
        dofBlur: 0,
        focalLayer: 2,
        scrollParallaxStrength: 50,  // max px shift for nearest layer from scroll viewing angle
    };

    var els = {};

    // ------------------------------------------------------------------
    // Bootstrap
    // ------------------------------------------------------------------

    function init() {
        loadMetadata().then(function (data) {
            meta = data;
            if (!meta) return;

            var resKeys = Object.keys(meta.resolutions);
            activeRes = resKeys.length > 1 ? resKeys[resKeys.length - 1] : resKeys[0];

            buildResolutionPicker(resKeys);
            applyResolution(activeRes);
            cacheElements();
            bindControls();
            bindEvents();

            state.lastScrollTop = window.pageYOffset || document.documentElement.scrollTop;
            handleScroll();

            // Start continuous render loop
            startLoop();
        });
    }

    function loadMetadata() {
        return fetch(SPRITES_BASE + '/metadata.json').then(function (resp) {
            if (!resp.ok) throw new Error(resp.statusText);
            return resp.json();
        }).catch(function (err) {
            console.error('Failed to load metadata.json:', err);
            return fallbackMetadata();
        });
    }

    function fallbackMetadata() {
        return {
            frames: 12, columns: 5, rows: 3, depth_layers: 5,
            parallax_factors: [0.3, 0.47, 0.65, 0.82, 1.0],
            resolutions: {
                '320x180': {
                    frame_width: 320, frame_height: 180,
                    sheet_width: 1600, sheet_height: 540,
                    layers: [
                        { layer: 0, file: 'sprite_sheet_layer_0_far.png' },
                        { layer: 1, file: 'sprite_sheet_layer_1_1.png' },
                        { layer: 2, file: 'sprite_sheet_layer_2_2.png' },
                        { layer: 3, file: 'sprite_sheet_layer_3_3.png' },
                        { layer: 4, file: 'sprite_sheet_layer_4_near.png' },
                    ],
                },
            },
        };
    }

    // ------------------------------------------------------------------
    // Resolution management
    // ------------------------------------------------------------------

    function buildResolutionPicker(resKeys) {
        var container = document.getElementById('resolution-picker');
        if (!container || resKeys.length < 2) return;

        container.innerHTML = '';
        resKeys.forEach(function (key) {
            var btn = document.createElement('button');
            btn.textContent = key;
            btn.className = 'res-btn' + (key === activeRes ? ' active' : '');
            btn.addEventListener('click', function () {
                if (key === activeRes) return;
                container.querySelectorAll('.res-btn').forEach(function (b) { b.classList.remove('active'); });
                btn.classList.add('active');
                applyResolution(key);
            });
            container.appendChild(btn);
        });
    }

    function applyResolution(resKey) {
        activeRes = resKey;
        var res = meta.resolutions[resKey];
        if (!res) return;

        var basePath = SPRITES_BASE + '/' + resKey;
        var bgSize = res.sheet_width + 'px ' + res.sheet_height + 'px';

        document.querySelectorAll('.stacked-layer').forEach(function (el) {
            var idx = parseInt(el.dataset.layer, 10);
            var info = res.layers[idx];
            if (!info) return;
            el.style.backgroundImage = "url('" + basePath + '/' + info.file + "')";
            el.style.backgroundSize = bgSize;
            el.style.width = res.frame_width + 'px';
            el.style.height = res.frame_height + 'px';
        });

        document.querySelectorAll('.layer-thumb').forEach(function (el) {
            var idx = parseInt(el.dataset.layer, 10);
            var info = res.layers[idx];
            if (!info) return;
            el.style.backgroundImage = "url('" + basePath + '/' + info.file + "')";
            el.style.backgroundSize = bgSize;
        });

        var frameTotal = document.getElementById('frame-total');
        if (frameTotal) frameTotal.textContent = meta.frames;
    }

    // ------------------------------------------------------------------
    // DOM caching & controls
    // ------------------------------------------------------------------

    function cacheElements() {
        els = {
            viewport: document.getElementById('viewport-stacked'),
            container: document.getElementById('stacked-layers'),
            layers: document.querySelectorAll('.stacked-layer'),
            layerThumbs: document.querySelectorAll('.layer-thumb'),
            frameDisplay: document.getElementById('frame-display'),
            parallaxXDisplay: document.getElementById('parallax-x'),
            parallaxYDisplay: document.getElementById('parallax-y'),
            parallaxVal: document.getElementById('parallax-val'),
            temporalVal: document.getElementById('temporal-val'),
            spreadVal: document.getElementById('spread-val'),
            perspectiveVal: document.getElementById('perspective-val'),
            dofVal: document.getElementById('dof-val'),
            focalVal: document.getElementById('focal-val'),
            layerPreview: document.getElementById('layer-preview'),
        };
    }

    function bindControls() {
        bind('parallax-intensity', function (v) {
            config.parallaxIntensity = v;
            if (els.parallaxVal) els.parallaxVal.textContent = v;
        });
        bind('temporal-speed', function (v) {
            config.temporalSpeed = Math.max(0.1, v / 10);
            if (els.temporalVal) els.temporalVal.textContent = config.temporalSpeed.toFixed(2);
        });
        bind('layer-spread', function (v) {
            config.layerSpread = v;
            if (els.spreadVal) els.spreadVal.textContent = v;
        });
        bind('perspective', function (v) {
            config.perspective = v;
            if (els.perspectiveVal) els.perspectiveVal.textContent = v;
            if (els.viewport) els.viewport.style.perspective = v + 'px';
        });
        bind('dof-blur', function (v) {
            config.dofBlur = v;
            if (els.dofVal) els.dofVal.textContent = v;
        });
        bind('focal-layer', function (v) {
            config.focalLayer = parseInt(v, 10);
            var names = ['far', 'mid-far', 'mid', 'mid-near', 'near'];
            if (els.focalVal) els.focalVal.textContent = config.focalLayer + ' (' + (names[config.focalLayer] || config.focalLayer) + ')';
        });
        bind('scroll-parallax', function (v) {
            config.scrollParallaxStrength = v;
        });

        var showLayersEl = document.getElementById('show-layers');
        if (showLayersEl) {
            showLayersEl.addEventListener('change', function (e) {
                if (els.layerPreview) els.layerPreview.style.display = e.target.checked ? 'block' : 'none';
            });
        }
    }

    function bind(id, cb) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('input', function (e) { cb(parseFloat(e.target.value)); });
    }

    // ------------------------------------------------------------------
    // Events
    // ------------------------------------------------------------------

    function bindEvents() {
        window.addEventListener('scroll', handleScroll, { passive: true });

        document.addEventListener('mousemove', function (e) {
            state.mouseX = e.clientX / window.innerWidth;
            state.mouseY = e.clientY / window.innerHeight;
        }, { passive: true });

        document.addEventListener('touchmove', function (e) {
            if (e.touches.length > 0) {
                state.mouseX = e.touches[0].clientX / window.innerWidth;
                state.mouseY = e.touches[0].clientY / window.innerHeight;
            }
        }, { passive: true });

        if (window.DeviceOrientationEvent) {
            window.addEventListener('deviceorientation', function (e) {
                if (e.gamma !== null && e.beta !== null) {
                    state.mouseX = Math.max(0, Math.min(1, (e.gamma + 45) / 90));
                    state.mouseY = Math.max(0, Math.min(1, (e.beta - 45) / 90));
                }
            }, { passive: true });
        }

        document.addEventListener('visibilitychange', function () {
            if (document.hidden) stopLoop();
            else startLoop();
        });
    }

    // ------------------------------------------------------------------
    // Scroll → frame advance velocity + vertical parallax
    // ------------------------------------------------------------------

    function handleScroll() {
        var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        var now = Date.now();
        var dt = (now - state.lastScrollTime) / 1000;

        if (dt > 0) {
            var velocity = (scrollTop - state.lastScrollTop) / dt;
            var rawSpeed = (velocity / config.pixelsPerFrame) * config.temporalSpeed;
            var maxSpeed = config.maxAnimationSpeed * config.temporalSpeed;
            state.animationSpeed = Math.max(-maxSpeed, Math.min(maxSpeed, rawSpeed));
        }

        // Viewport-relative vertical parallax:
        // How far is the viewport center from the screen center?
        // Range: -1 (viewport above screen center) to +1 (viewport below center)
        if (els.viewport) {
            var rect = els.viewport.getBoundingClientRect();
            var viewportCenterY = rect.top + rect.height / 2;
            var screenCenterY = window.innerHeight / 2;
            // Normalize: -1 when viewport top is at screen bottom, +1 when bottom is at top
            state.scrollParallaxY = Math.max(-1, Math.min(1,
                (viewportCenterY - screenCenterY) / (window.innerHeight / 2)
            ));
        }

        state.lastScrollTop = scrollTop;
        state.lastScrollTime = now;
    }

    // ------------------------------------------------------------------
    // Continuous render loop
    // ------------------------------------------------------------------

    function startLoop() {
        if (state.rafId !== null || document.hidden) return;
        state.lastFrameTime = Date.now();
        state.rafId = requestAnimationFrame(renderLoop);
    }

    function stopLoop() {
        if (state.rafId !== null) {
            cancelAnimationFrame(state.rafId);
            state.rafId = null;
        }
    }

    function renderLoop() {
        if (document.hidden) { stopLoop(); return; }

        var now = Date.now();
        var dt = (now - state.lastFrameTime) / 1000;
        state.lastFrameTime = now;

        // --- Frame advance (scroll-velocity driven with deceleration) ---
        var speedFactor = Math.abs(state.animationSpeed) * 0.1;
        var decel = config.baseDeceleration + speedFactor;
        if (state.animationSpeed > 0) state.animationSpeed = Math.max(0, state.animationSpeed - decel * dt);
        else if (state.animationSpeed < 0) state.animationSpeed = Math.min(0, state.animationSpeed + decel * dt);

        state.animationProgress += state.animationSpeed * dt;
        if (state.animationProgress > 1e6) state.animationProgress -= 1e6;
        if (state.animationProgress < -1e6) state.animationProgress += 1e6;

        var totalFrames = meta.frames;
        var frameIndex = Math.floor(state.animationProgress) % totalFrames;
        if (frameIndex < 0) frameIndex += totalFrames;

        var res = meta.resolutions[activeRes];
        var fw = res.frame_width;
        var fh = res.frame_height;
        var cols = meta.columns;

        var frameX = (frameIndex % cols) * fw;
        var frameY = Math.floor(frameIndex / cols) * fh;
        var bgPos = '-' + frameX + 'px -' + frameY + 'px';

        // --- Parallax ---
        // Mouse/tilt: horizontal + subtle vertical
        var targetPX = (state.mouseX - 0.5) * config.parallaxIntensity;
        var targetPY = (state.mouseY - 0.5) * config.parallaxIntensity * 0.3;

        // Smooth interpolation for mouse parallax
        state.parallaxX += (targetPX - state.parallaxX) * 0.1;
        state.parallaxY += (targetPY - state.parallaxY) * 0.1;

        // Scroll-position vertical parallax: applied per-layer with different magnitudes.
        // scrollParallaxY ranges -1 to +1 based on viewport position on screen.
        // Near layers (high factor) shift more than far layers (low factor).
        state.scrollParallaxYSmooth += (state.scrollParallaxY - state.scrollParallaxYSmooth) * 0.08;
        var scrollView = state.scrollParallaxYSmooth; // -1 to +1

        // Camera tilt + lift for stronger 2.5D read
        var maxTilt = config.scrollParallaxStrength * 0.2; // 0..20deg
        var maxLift = config.scrollParallaxStrength * 0.6; // 0..60px
        var tiltDeg = scrollView * maxTilt;
        var liftPx = -scrollView * maxLift;

        if (els.container) {
            els.container.style.transform = 'translateY(' + liftPx.toFixed(2) + 'px) rotateX(' + (-tiltDeg).toFixed(2) + 'deg)';
        }
        if (els.viewport) {
            var originShift = scrollView * Math.min(30, config.scrollParallaxStrength * 0.3);
            var originY = Math.max(20, Math.min(80, 50 - originShift));
            els.viewport.style.perspectiveOrigin = '50% ' + originY.toFixed(1) + '%';
        }

        var tiltRad = tiltDeg * Math.PI / 180;

        // --- Apply to layers ---
        var factors = meta.parallax_factors;
        var numLayers = meta.depth_layers;

        els.layers.forEach(function (layer, i) {
            var pf = factors[i] || 1;
            var zOff = (i - Math.floor(numLayers / 2)) * config.layerSpread;

            // Mouse parallax: each layer moves proportionally to depth
            var tx = state.parallaxX * pf;
            var ty = state.parallaxY * pf;

            // Scroll parallax: near layers shift much more than far layers
            // This creates the "viewing angle" effect
            var depthWeight = 0.2 + 0.8 * pf;
            ty += scrollView * config.scrollParallaxStrength * depthWeight;

            // Extra Y offset from camera tilt and layer depth
            ty += Math.sin(tiltRad) * zOff * 0.6;

            layer.style.transform = 'translateZ(' + zOff + 'px) translate(' + tx + 'px, ' + ty + 'px)';
            layer.style.backgroundPosition = bgPos;

            if (config.dofBlur > 0) {
                var blur = Math.abs(i - config.focalLayer) * config.dofBlur;
                layer.style.filter = blur > 0 ? 'blur(' + blur + 'px)' : 'none';
            } else {
                layer.style.filter = 'none';
            }
        });

        // Layer thumbnails
        els.layerThumbs.forEach(function (thumb) {
            thumb.style.backgroundPosition = bgPos;
        });

        // Status
        if (els.frameDisplay) els.frameDisplay.textContent = frameIndex;
        if (els.parallaxXDisplay) els.parallaxXDisplay.textContent = state.parallaxX.toFixed(1);
        if (els.parallaxYDisplay) els.parallaxYDisplay.textContent = state.parallaxY.toFixed(1);

        // Always continue
        state.rafId = requestAnimationFrame(renderLoop);
    }

    // ------------------------------------------------------------------
    // Start
    // ------------------------------------------------------------------

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();

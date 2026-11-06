// Isolated runtime for the /test point-cloud scene (templates/test.html).
(function() {
    'use strict';

    const shaders = window.TestPageShaders;
    if (!shaders || !shaders.vertexShader || !shaders.fragmentShader || !shaders.depthPrepassFragmentShader) {
        console.error('Missing /test shader bundle (window.TestPageShaders).');
        return;
    }
    const { vertexShader, fragmentShader, depthPrepassFragmentShader } = shaders;

    const runtimeConfig = window.TestPageConfig;
    if (!runtimeConfig || !runtimeConfig.defaults || !runtimeConfig.constants) {
        console.error('Missing /test runtime config bundle (window.TestPageConfig).');
        return;
    }

    const config = Object.assign({}, runtimeConfig.defaults);
    const defaultConfig = Object.assign({}, runtimeConfig.defaults);

    const {
        SPRITE_BASE_PATH,
        PREFERRED_FRAME_WIDTH,
        PREFERRED_FRAME_HEIGHT,
        PLANE_BASE_HEIGHT,
        CAMERA_FOV,
        CAMERA_Z,
        TILT_ORBIT_VERTICAL_SCALE,
        PAN_Y_CAMERA_INFLUENCE,
        PAN_Y_LOOK_INFLUENCE,
        CLOUD_FILL_FACTOR,
        RENDER_MARGIN,
        DENSITY_REBUILD_DEBOUNCE_MS,
        ACTIVE_SCROLL_RECT_REFRESH_MS,
        STARTUP_STABILIZE_MS,
        SCROLL_SPEED_SMOOTHING,
    } = runtimeConfig.constants;

    const SPRITE_REQUEST_VERSION = Date.now().toString(36);
    const prefersReducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
    let prefersReducedMotion = prefersReducedMotionMedia.matches;

    // =============================================
    // Global State
    // =============================================
    const spriteSets = {};
    const thumbnails = [];
    const thumbnailByContainer = new Map();
    const thumbnailBySlug = new Map();
    const geometryCache = new Map();
    const managedListeners = [];

    let sharedRenderer = null;
    let hasWebGL = true;
    let resizeObserver = null;
    let intersectionObserver = null;
    let isDisposed = false;
    let renderFrameId = null;
    let rectsNeedUpdate = true;
    let prefersReducedMotionListener = null;

    const renderState = {
        width: 0,
        height: 0,
    };

    let animationProgress = 0;
    let animationSpeed = 0;
    let lastScrollTop = window.pageYOffset || document.documentElement.scrollTop;
    let lastScrollEventTime = Date.now();
    let startupStabilizeUntilMs = Date.now() + STARTUP_STABILIZE_MS;
    let lastAnimationFrameTime = Date.now();
    let animationFrameId = null;

    // Global mouse position (normalized -1 to 1 across viewport)
    let globalMouseX = 0;
    let globalMouseY = 0;

    // Device orientation
    let deviceX = 0;
    let deviceY = 0;
    let hasDeviceOrientation = false;
    let densityRebuildTimer = null;
    let transitionRectRefreshUntilMs = 0;
    let projectTransitionManager = null;

    function addManagedEventListener(target, type, handler, options) {
        target.addEventListener(type, handler, options);
        managedListeners.push({ target, type, handler, options });
    }

    function removeManagedEventListeners() {
        managedListeners.forEach(({ target, type, handler, options }) => {
            target.removeEventListener(type, handler, options);
        });
        managedListeners.length = 0;
    }

    function getCurrentScrollY() {
        return window.pageYOffset || document.documentElement.scrollTop || 0;
    }

    function getScrollElement() {
        return document.scrollingElement || document.documentElement;
    }

    function setScrollTopImmediate(targetTop) {
        const el = getScrollElement();
        if (!el) return;
        const nextTop = Math.max(0, Number(targetTop) || 0);
        const root = document.documentElement;
        const body = document.body;
        const prevRootBehavior = root?.style?.scrollBehavior ?? '';
        const prevBodyBehavior = body?.style?.scrollBehavior ?? '';

        if (root) root.style.scrollBehavior = 'auto';
        if (body) body.style.scrollBehavior = 'auto';

        el.scrollTop = nextTop;
        // Keep both roots in sync for cross-browser quirks.
        if (root) root.scrollTop = nextTop;
        if (body) {
            body.scrollTop = nextTop;
        }

        if (root) root.style.scrollBehavior = prevRootBehavior;
        if (body) body.style.scrollBehavior = prevBodyBehavior;
    }

    function getGeometryCacheKey(frameWidth, frameHeight, density) {
        const stride = Math.max(1, Math.round(1 / density));
        return `${frameWidth}x${frameHeight}@${stride}`;
    }

    function buildPointGeometry(frameWidth, frameHeight, density) {
        const stride = Math.max(1, Math.round(1 / density));
        const pointsX = Math.ceil(frameWidth / stride);
        const pointsY = Math.ceil(frameHeight / stride);
        const pointCount = pointsX * pointsY;

        const uvs = new Float32Array(pointCount * 2);
        let idx = 0;
        for (let y = 0; y < pointsY; y++) {
            for (let x = 0; x < pointsX; x++) {
                // Sample at texel centers (+ 0.5) to avoid boundary interpolation
                uvs[idx++] = (x * stride + 0.5) / frameWidth;
                uvs[idx++] = (y * stride + 0.5) / frameHeight;
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('pixelUV', new THREE.BufferAttribute(uvs, 2));
        const positions = new Float32Array(pointCount * 3);
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        return geometry;
    }

    function acquireSharedGeometry(frameWidth, frameHeight, density) {
        const key = getGeometryCacheKey(frameWidth, frameHeight, density);
        let entry = geometryCache.get(key);
        if (!entry) {
            entry = {
                geometry: buildPointGeometry(frameWidth, frameHeight, density),
                refs: 0,
            };
            geometryCache.set(key, entry);
        }
        entry.refs += 1;
        return { key, geometry: entry.geometry };
    }

    function releaseSharedGeometry(key) {
        if (!key) return;
        const entry = geometryCache.get(key);
        if (!entry) return;
        entry.refs -= 1;
        if (entry.refs <= 0) {
            entry.geometry.dispose();
            geometryCache.delete(key);
        }
    }

    function refreshRenderableThumbnails() {
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;

        thumbnails.forEach((thumb) => {
            if (thumb.renderSuppressed) {
                thumb.isRenderable = false;
                return;
            }

            if (intersectionObserver && !thumb.isInViewportMargin) {
                thumb.isRenderable = false;
                return;
            }

            const rect = thumb.container.getBoundingClientRect();
            thumb.cachedRect = rect;
            thumb.isRenderable =
                rect.bottom > -RENDER_MARGIN &&
                rect.top < viewportHeight + RENDER_MARGIN &&
                rect.right > -RENDER_MARGIN &&
                rect.left < viewportWidth + RENDER_MARGIN;
        });

        rectsNeedUpdate = false;
    }

    function setupThumbnailObservers() {
        if ('IntersectionObserver' in window) {
            intersectionObserver = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    const thumb = thumbnailByContainer.get(entry.target);
                    if (!thumb) return;

                    thumb.isInViewportMargin = entry.isIntersecting;
                    if (entry.isIntersecting) {
                        thumb.cachedRect = entry.boundingClientRect;
                    } else {
                        thumb.isRenderable = false;
                    }
                });
                rectsNeedUpdate = true;
            }, {
                root: null,
                rootMargin: `${RENDER_MARGIN}px 0px ${RENDER_MARGIN}px 0px`,
                threshold: 0,
            });

            thumbnails.forEach((thumb) => intersectionObserver.observe(thumb.container));
        } else {
            thumbnails.forEach((thumb) => {
                thumb.isInViewportMargin = true;
            });
        }

        if ('ResizeObserver' in window) {
            resizeObserver = new ResizeObserver((entries) => {
                entries.forEach((entry) => {
                    const thumb = thumbnailByContainer.get(entry.target);
                    if (!thumb) return;
                    thumb.cachedRect = thumb.container.getBoundingClientRect();
                });
                rectsNeedUpdate = true;
            });
            thumbnails.forEach((thumb) => resizeObserver.observe(thumb.container));
        }
    }

    // Track mouse globally across the entire page
    function setupGlobalMouseTracking() {
        addManagedEventListener(window, 'mousemove', (e) => {
            globalMouseX = (e.clientX / window.innerWidth) * 2 - 1;
            globalMouseY = (e.clientY / window.innerHeight) * 2 - 1;
        }, { passive: true });

        addManagedEventListener(window, 'mouseleave', () => {
            // Smoothly return to center when mouse leaves window
            globalMouseX = 0;
            globalMouseY = 0;
        }, { passive: true });
    }

    function supportsWebGL() {
        const canvas = document.createElement('canvas');
        return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
    }

    function setGlobalStat(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    function bumpTransitionRectRefresh(durationMs = 700) {
        transitionRectRefreshUntilMs = Math.max(transitionRectRefreshUntilMs, Date.now() + durationMs);
        rectsNeedUpdate = true;
    }

    function syncMotionControlledInputs() {
        const disabled = prefersReducedMotion;
        const ids = [
            'tilt-range',
            'mouse-parallax',
            'edge-scatter',
            'depth-amount',
            'opacity-edge',
            'ambient-wave-strength',
            'ambient-wave-frequency',
            'ambient-wave-speed',
            'ambient-wave-depth-influence',
            'ambient-wave-lateral',
        ];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = disabled;
        });
    }

    function syncMotionValuesToUI() {
        const depthAmountInput = document.getElementById('depth-amount');
        if (depthAmountInput) depthAmountInput.value = String(config.depthAmount);
        setGlobalStat('depth-val', String(config.depthAmount));

        const tiltInput = document.getElementById('tilt-range');
        if (tiltInput) tiltInput.value = String(config.tiltRange);
        setGlobalStat('tilt-val', String(config.tiltRange));

        const parallaxInput = document.getElementById('mouse-parallax');
        if (parallaxInput) parallaxInput.value = String(config.mouseParallax);
        setGlobalStat('parallax-val', String(config.mouseParallax));

        const scatterInput = document.getElementById('edge-scatter');
        if (scatterInput) scatterInput.value = String(config.edgeScatter);
        setGlobalStat('scatter-val', config.edgeScatter.toFixed(1));

        const opacityEdgeInput = document.getElementById('opacity-edge');
        if (opacityEdgeInput) opacityEdgeInput.value = String(config.opacityEdge);
        setGlobalStat('opacity-edge-val', config.opacityEdge.toFixed(2));

        const ambientStrengthInput = document.getElementById('ambient-wave-strength');
        if (ambientStrengthInput) ambientStrengthInput.value = String(config.ambientWaveStrength);
        setGlobalStat('ambient-wave-strength-val', config.ambientWaveStrength.toFixed(2));

        const ambientFrequencyInput = document.getElementById('ambient-wave-frequency');
        if (ambientFrequencyInput) ambientFrequencyInput.value = String(config.ambientWaveFrequency);
        setGlobalStat('ambient-wave-frequency-val', config.ambientWaveFrequency.toFixed(1));

        const ambientSpeedInput = document.getElementById('ambient-wave-speed');
        if (ambientSpeedInput) ambientSpeedInput.value = String(config.ambientWaveSpeed);
        setGlobalStat('ambient-wave-speed-val', config.ambientWaveSpeed.toFixed(2));

        const ambientDepthInput = document.getElementById('ambient-wave-depth-influence');
        if (ambientDepthInput) ambientDepthInput.value = String(config.ambientWaveDepthInfluence);
        setGlobalStat('ambient-wave-depth-influence-val', config.ambientWaveDepthInfluence.toFixed(3));

        const ambientLateralInput = document.getElementById('ambient-wave-lateral');
        if (ambientLateralInput) ambientLateralInput.value = String(config.ambientWaveLateral);
        setGlobalStat('ambient-wave-lateral-val', config.ambientWaveLateral.toFixed(2));
    }

    function applyMotionPreference(isReduced) {
        prefersReducedMotion = isReduced;

        if (isReduced) {
            config.tiltRange = 0;
            config.mouseParallax = 0;
            config.edgeScatter = 0;
            config.edgeScatterCenter = 0;
            config.depthAmountCenter = defaultConfig.depthAmountCenter;
            config.depthAmount = defaultConfig.depthAmountCenter;
            config.ambientWaveStrength = 0;
            config.opacityEdge = 1;
            animationSpeed = 0;
        } else {
            config.tiltRange = defaultConfig.tiltRange;
            config.mouseParallax = defaultConfig.mouseParallax;
            config.edgeScatter = defaultConfig.edgeScatter;
            config.edgeScatterCenter = defaultConfig.edgeScatterCenter;
            config.depthAmount = defaultConfig.depthAmount;
            config.depthAmountCenter = defaultConfig.depthAmountCenter;
            config.ambientWaveStrength = defaultConfig.ambientWaveStrength;
            config.opacityEdge = defaultConfig.opacityEdge;
        }

        syncMotionControlledInputs();
        syncMotionValuesToUI();
    }

    const thumbnailRendererModule = window.TestPageThumbnailRendererModule;
    if (!thumbnailRendererModule || typeof thumbnailRendererModule.create !== 'function') {
        console.error('Missing /test thumbnail/renderer module (window.TestPageThumbnailRendererModule).');
        return;
    }

    const transitionManagerModule = window.TestPageTransitionManagerModule;
    if (!transitionManagerModule || typeof transitionManagerModule.create !== 'function') {
        console.error('Missing /test transition manager module (window.TestPageTransitionManagerModule).');
        return;
    }

    const thumbnailRendererRuntime = thumbnailRendererModule.create({
        THREE,
        config,
        renderState,
        spriteSets,
        acquireSharedGeometry,
        releaseSharedGeometry,
        constants: {
            SPRITE_BASE_PATH,
            PREFERRED_FRAME_WIDTH,
            PREFERRED_FRAME_HEIGHT,
            PLANE_BASE_HEIGHT,
            CAMERA_FOV,
            CAMERA_Z,
            TILT_ORBIT_VERTICAL_SCALE,
            PAN_Y_CAMERA_INFLUENCE,
            PAN_Y_LOOK_INFLUENCE,
            CLOUD_FILL_FACTOR,
            SPRITE_REQUEST_VERSION,
        },
        shaders: {
            vertexShader,
            fragmentShader,
            depthPrepassFragmentShader,
        },
        getSharedRenderer: () => sharedRenderer,
        isReducedMotion: () => prefersReducedMotion,
        getInputState: () => ({
            globalMouseX,
            globalMouseY,
            hasDeviceOrientation,
            deviceX,
            deviceY,
        }),
        setHasWebGL: (value) => {
            hasWebGL = !!value;
        },
    });

    const {
        SharedRenderer,
        PointCloudThumbnail,
        loadSpriteSet,
        activateNoWebGLFallback,
    } = thumbnailRendererRuntime;

    function readTransitionDebugEnabled() {
        const query = new URLSearchParams(window.location.search);
        const queryValue = query.get('pc_transition_debug');
        const normalizeFlag = (value) => {
            if (value === null || value === undefined) return null;
            const normalized = String(value).trim().toLowerCase();
            if (!normalized) return null;
            if (normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no') {
                return false;
            }
            return true;
        };

        try {
            const queryFlag = normalizeFlag(queryValue);
            if (queryFlag !== null) {
                if (queryFlag) {
                    window.localStorage.setItem('pc_transition_debug', '1');
                } else {
                    window.localStorage.removeItem('pc_transition_debug');
                }
                return queryFlag;
            }
            return window.localStorage.getItem('pc_transition_debug') === '1';
        } catch {
            return normalizeFlag(queryValue) === true;
        }
    }

    const transitionDebugEnabled = readTransitionDebugEnabled();

    const transitionRuntime = transitionManagerModule.create({
        addManagedEventListener,
        thumbnailBySlug,
        getCurrentScrollY,
        setScrollTopImmediate,
        markRectsNeedUpdate: () => {
            rectsNeedUpdate = true;
        },
        bumpTransitionRectRefresh,
        refreshRenderableThumbnails,
        isReducedMotion: () => prefersReducedMotion,
        isDebugEnabled: () => transitionDebugEnabled,
    });

    const { ProjectTransitionManager } = transitionRuntime;

    function cleanup() {
        if (isDisposed) return;
        isDisposed = true;

        stopAnimationLoop();
        if (renderFrameId !== null) {
            cancelAnimationFrame(renderFrameId);
            renderFrameId = null;
        }

        if (densityRebuildTimer !== null) {
            clearTimeout(densityRebuildTimer);
            densityRebuildTimer = null;
        }

        if (resizeObserver) {
            resizeObserver.disconnect();
            resizeObserver = null;
        }
        if (intersectionObserver) {
            intersectionObserver.disconnect();
            intersectionObserver = null;
        }

        if (prefersReducedMotionListener) {
            if (typeof prefersReducedMotionMedia.removeEventListener === 'function') {
                prefersReducedMotionMedia.removeEventListener('change', prefersReducedMotionListener);
            } else if (typeof prefersReducedMotionMedia.removeListener === 'function') {
                prefersReducedMotionMedia.removeListener(prefersReducedMotionListener);
            }
            prefersReducedMotionListener = null;
        }

        removeManagedEventListeners();

        thumbnails.forEach((thumb) => thumb.destroy());
        thumbnails.length = 0;
        thumbnailByContainer.clear();
        thumbnailBySlug.clear();

        if (projectTransitionManager) {
            projectTransitionManager.destroy();
            projectTransitionManager = null;
        }

        Object.values(spriteSets).forEach((set) => {
            if (set.rgbTexture) set.rgbTexture.dispose();
            if (set.depthTexture) set.depthTexture.dispose();
        });
        Object.keys(spriteSets).forEach((key) => {
            delete spriteSets[key];
        });

        geometryCache.forEach((entry) => {
            entry.geometry.dispose();
        });
        geometryCache.clear();

        if (sharedRenderer && sharedRenderer.renderer) {
            if (typeof sharedRenderer.renderer.forceContextLoss === 'function') {
                sharedRenderer.renderer.forceContextLoss();
            }
            sharedRenderer.renderer.dispose();
        }
        sharedRenderer = null;
    }

    async function init() {
        setupControls();
        applyMotionPreference(prefersReducedMotion);
        addManagedEventListener(window, 'pagehide', cleanup);
        addManagedEventListener(window, 'beforeunload', cleanup);

        if (!supportsWebGL()) {
            activateNoWebGLFallback('WebGL is unavailable. Falling back to static thumbnail containers.');
            return;
        }

        try {
            const canvas = document.getElementById('shared-depth-canvas');
            sharedRenderer = new SharedRenderer(canvas);
        } catch (err) {
            activateNoWebGLFallback('Failed to initialize shared WebGL renderer. Falling back to static thumbnail containers.', err);
            return;
        }

        const projectItems = document.querySelectorAll('.pc-project[data-sprite]');
        const spriteIds = [...new Set([...projectItems].map(el => el.dataset.sprite))];

        console.log(`Loading ${spriteIds.length} sprite sets...`);
        const loadPromises = spriteIds.map(async id => {
            const data = await loadSpriteSet(id);
            if (data) spriteSets[id] = data;
        });
        await Promise.all(loadPromises);

        console.log(`Loaded ${Object.keys(spriteSets).length} sprite sets`);

        projectItems.forEach((item) => {
            const container = item.querySelector('.pc-thumbnail-container');
            const spriteId = item.dataset.sprite;
            const slug = item.dataset.slug;

            if (!spriteSets[spriteId]) {
                console.warn(`Sprite set not loaded: ${spriteId}`);
                return;
            }

            const thumbnail = new PointCloudThumbnail(container, spriteId);
            thumbnail.createPointCloud();
            thumbnails.push(thumbnail);
            thumbnailByContainer.set(container, thumbnail);
            if (slug) {
                thumbnailBySlug.set(slug, thumbnail);
            }
        });

        console.log(`Created ${thumbnails.length} point cloud thumbnails`);

        setupGlobalMouseTracking();
        setupDeviceOrientation();
        setupThumbnailObservers();
        refreshRenderableThumbnails();

        projectTransitionManager = new ProjectTransitionManager();
        projectTransitionManager.init();

        addManagedEventListener(window, 'resize', handleResize);
        addManagedEventListener(window, 'scroll', handleScroll, { passive: true });

        prefersReducedMotionListener = (event) => {
            applyMotionPreference(event.matches);
        };
        if (typeof prefersReducedMotionMedia.addEventListener === 'function') {
            prefersReducedMotionMedia.addEventListener('change', prefersReducedMotionListener);
        } else if (typeof prefersReducedMotionMedia.addListener === 'function') {
            prefersReducedMotionMedia.addListener(prefersReducedMotionListener);
        }

        addManagedEventListener(document, 'visibilitychange', () => {
            if (document.hidden) {
                stopAnimationLoop();
            } else if (Math.abs(animationSpeed) > 0.01) {
                startAnimationLoop();
            }
        });

        animate();
    }

    function setupDeviceOrientation() {
        // Only attempt device orientation on touch devices (mobile/tablet)
        const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        if (!isTouchDevice) return;

        if (window.DeviceOrientationEvent) {
            // Request permission on iOS 13+
            if (typeof DeviceOrientationEvent.requestPermission === 'function') {
                // Need user gesture to request permission
                const requestPermission = () => {
                    DeviceOrientationEvent.requestPermission()
                        .then(response => {
                            if (response === 'granted') {
                                enableDeviceOrientation();
                            }
                        })
                        .catch(console.error);
                };
                addManagedEventListener(document.body, 'click', requestPermission, { once: true });
            } else {
                enableDeviceOrientation();
            }
        }
    }

    function enableDeviceOrientation() {
        addManagedEventListener(window, 'deviceorientation', (e) => {
            // Only enable device orientation if we get meaningful values
            // This prevents desktop browsers from overriding mouse input
            if (e.gamma !== null && e.beta !== null && (Math.abs(e.gamma) > 1 || Math.abs(e.beta) > 1)) {
                hasDeviceOrientation = true;
                // gamma = left/right tilt (-90 to 90)
                // beta = front/back tilt (-180 to 180)
                deviceX = (e.gamma || 0) / 45; // Normalize to roughly -1..1
                deviceY = (e.beta || 0) / 45;
                // Clamp
                deviceX = Math.max(-1, Math.min(1, deviceX));
                deviceY = Math.max(-1, Math.min(1, deviceY));
            }
        });
    }

    // =============================================
    // Scroll Handling
    // =============================================
    function handleScroll() {
        rectsNeedUpdate = true;

        if (prefersReducedMotion) {
            lastScrollTop = window.pageYOffset || document.documentElement.scrollTop;
            lastScrollEventTime = Date.now();
            return;
        }

        const currentScrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const now = Date.now();
        const deltaTime = (now - lastScrollEventTime) / 1000;

        if (deltaTime > 0) {
            const scrollVelocity = (currentScrollTop - lastScrollTop) / deltaTime;
            const pixelsPerFrame = 15;
            const targetSpeed = Math.max(-30, Math.min(30, scrollVelocity / pixelsPerFrame));
            // Smooth speed updates to avoid large visual jumps on abrupt first interactions.
            animationSpeed += (targetSpeed - animationSpeed) * SCROLL_SPEED_SMOOTHING;
        }

        lastScrollTop = currentScrollTop;
        lastScrollEventTime = now;

        if (Math.abs(animationSpeed) > 0.01) {
            startAnimationLoop();
        }
    }

    // =============================================
    // Animation Loop
    // =============================================
    function startAnimationLoop() {
        if (isDisposed) return;
        if (animationFrameId !== null || document.hidden) return;
        lastAnimationFrameTime = Date.now();
        animationFrameId = requestAnimationFrame(animationLoop);
    }

    function stopAnimationLoop() {
        if (animationFrameId !== null) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    }

    function animationLoop() {
        if (isDisposed) {
            stopAnimationLoop();
            return;
        }

        if (document.hidden) {
            stopAnimationLoop();
            return;
        }

        const now = Date.now();
        const deltaTime = (now - lastAnimationFrameTime) / 1000;
        lastAnimationFrameTime = now;

        const baseDeceleration = 15;
        const speedFactor = Math.abs(animationSpeed) * 0.1;
        const dynamicDeceleration = baseDeceleration + speedFactor;

        if (animationSpeed > 0) {
            animationSpeed = Math.max(0, animationSpeed - dynamicDeceleration * deltaTime);
        } else if (animationSpeed < 0) {
            animationSpeed = Math.min(0, animationSpeed + dynamicDeceleration * deltaTime);
        }

        animationProgress += animationSpeed * deltaTime;
        if (animationProgress > 1e6) animationProgress -= 1e6;
        if (animationProgress < -1e6) animationProgress += 1e6;

        if (Math.abs(animationSpeed) > 0.01) {
            animationFrameId = requestAnimationFrame(animationLoop);
        } else {
            animationSpeed = 0;
            stopAnimationLoop();
        }
    }

    function animate() {
        if (isDisposed) return;
        renderFrameId = requestAnimationFrame(animate);

        if (!hasWebGL || !sharedRenderer || thumbnails.length === 0) return;

        const now = Date.now();
        const shouldForceRectRefresh =
            now < startupStabilizeUntilMs ||
            (now - lastScrollEventTime) < ACTIVE_SCROLL_RECT_REFRESH_MS ||
            now < transitionRectRefreshUntilMs;

        if (rectsNeedUpdate || shouldForceRectRefresh) {
            refreshRenderableThumbnails();
        }

        const time = performance.now() / 1000;
        const renderables = [];

        thumbnails.forEach((thumb) => {
            if (thumb.isRenderable && thumb.cachedRect) {
                renderables.push({ thumb, rect: thumb.cachedRect });
            } else {
                thumb.setVisible(false);
            }
        });

        sharedRenderer.render(renderables, animationProgress, time);
    }

    function handleResize() {
        rectsNeedUpdate = true;
        if (sharedRenderer) sharedRenderer.resize();
    }


    // =============================================
    // Controls
    // =============================================
    function setupControls() {
        const on = (element, type, handler, options) => {
            if (!element) return;
            addManagedEventListener(element, type, handler, options);
        };

        // Toggle collapse/expand
        const controlsPanel = document.getElementById('controls-panel');
        const toggleBtn = document.getElementById('controls-toggle');

        on(toggleBtn, 'click', () => {
            controlsPanel.classList.toggle('collapsed');
            toggleBtn.textContent = controlsPanel.classList.contains('collapsed') ? '☰' : '×';
            toggleBtn.title = controlsPanel.classList.contains('collapsed') ? 'Show controls' : 'Hide controls';
        });

        // Base settings
        const rebuildDensityNow = () => {
            if (densityRebuildTimer !== null) {
                clearTimeout(densityRebuildTimer);
                densityRebuildTimer = null;
            }
            thumbnails.forEach(t => t.rebuildPointCloud());
        };

        const scheduleDensityRebuild = () => {
            if (densityRebuildTimer !== null) {
                clearTimeout(densityRebuildTimer);
            }
            densityRebuildTimer = window.setTimeout(() => {
                densityRebuildTimer = null;
                thumbnails.forEach(t => t.rebuildPointCloud());
            }, DENSITY_REBUILD_DEBOUNCE_MS);
        };

        on(document.getElementById('point-density'), 'input', (e) => {
            config.pointDensity = parseFloat(e.target.value);
            document.getElementById('density-val').textContent = config.pointDensity.toFixed(2);
            scheduleDensityRebuild();
        });
        on(document.getElementById('point-density'), 'change', rebuildDensityNow);

        on(document.getElementById('point-size'), 'input', (e) => {
            config.pointSize = parseFloat(e.target.value);
            document.getElementById('size-val').textContent = config.pointSize.toFixed(1);
        });

        on(document.getElementById('depth-amount'), 'input', (e) => {
            config.depthAmount = parseInt(e.target.value, 10);
            document.getElementById('depth-val').textContent = config.depthAmount;
        });

        on(document.getElementById('tilt-range'), 'input', (e) => {
            config.tiltRange = parseInt(e.target.value, 10);
            document.getElementById('tilt-val').textContent = config.tiltRange;
        });

        on(document.getElementById('mouse-parallax'), 'input', (e) => {
            config.mouseParallax = parseInt(e.target.value, 10);
            document.getElementById('parallax-val').textContent = config.mouseParallax;
        });

        // Viewport coherence
        on(document.getElementById('depth-center'), 'input', (e) => {
            config.depthAmountCenter = parseInt(e.target.value, 10);
            document.getElementById('depth-center-val').textContent = config.depthAmountCenter;
        });

        on(document.getElementById('scatter-center'), 'input', (e) => {
            config.edgeScatterCenter = parseFloat(e.target.value);
            document.getElementById('scatter-center-val').textContent = config.edgeScatterCenter.toFixed(2);
        });

        on(document.getElementById('transition-curve'), 'input', (e) => {
            config.transitionCurve = parseFloat(e.target.value);
            document.getElementById('transition-curve-val').textContent = config.transitionCurve.toFixed(1);
        });

        on(document.getElementById('opacity-edge'), 'input', (e) => {
            config.opacityEdge = parseFloat(e.target.value);
            document.getElementById('opacity-edge-val').textContent = config.opacityEdge.toFixed(2);
        });

        // Point cloud style
        on(document.getElementById('point-shape'), 'change', (e) => {
            const shapes = { 'soft': 0, 'circle': 1, 'square': 2 };
            config.pointShape = shapes[e.target.value];
        });

        on(document.getElementById('size-attenuation'), 'change', (e) => {
            config.sizeAttenuation = e.target.checked;
        });

        on(document.getElementById('depth-sizing'), 'input', (e) => {
            config.depthSizing = parseFloat(e.target.value);
            document.getElementById('depth-sizing-val').textContent = config.depthSizing.toFixed(2);
        });

        on(document.getElementById('opacity'), 'input', (e) => {
            config.opacity = parseFloat(e.target.value);
            document.getElementById('opacity-val').textContent = config.opacity.toFixed(2);
        });

        on(document.getElementById('depth-opacity'), 'change', (e) => {
            config.depthOpacity = e.target.checked;
        });

        // Creative effects
        on(document.getElementById('edge-scatter'), 'input', (e) => {
            config.edgeScatter = parseFloat(e.target.value);
            document.getElementById('scatter-val').textContent = config.edgeScatter.toFixed(1);
        });

        on(document.getElementById('edge-threshold'), 'input', (e) => {
            config.edgeThreshold = parseFloat(e.target.value);
            document.getElementById('edge-thresh-val').textContent = config.edgeThreshold.toFixed(2);
        });

        on(document.getElementById('ambient-wave-strength'), 'input', (e) => {
            config.ambientWaveStrength = parseFloat(e.target.value);
            document.getElementById('ambient-wave-strength-val').textContent = config.ambientWaveStrength.toFixed(2);
        });

        on(document.getElementById('ambient-wave-frequency'), 'input', (e) => {
            config.ambientWaveFrequency = parseFloat(e.target.value);
            document.getElementById('ambient-wave-frequency-val').textContent = config.ambientWaveFrequency.toFixed(1);
        });

        on(document.getElementById('ambient-wave-speed'), 'input', (e) => {
            config.ambientWaveSpeed = parseFloat(e.target.value);
            document.getElementById('ambient-wave-speed-val').textContent = config.ambientWaveSpeed.toFixed(2);
        });

        on(document.getElementById('ambient-wave-depth-influence'), 'input', (e) => {
            config.ambientWaveDepthInfluence = parseFloat(e.target.value);
            document.getElementById('ambient-wave-depth-influence-val').textContent = config.ambientWaveDepthInfluence.toFixed(3);
        });

        on(document.getElementById('ambient-wave-lateral'), 'input', (e) => {
            config.ambientWaveLateral = parseFloat(e.target.value);
            document.getElementById('ambient-wave-lateral-val').textContent = config.ambientWaveLateral.toFixed(2);
        });

        on(document.getElementById('dof-enable'), 'change', (e) => {
            config.dofEnable = e.target.checked;
        });

        on(document.getElementById('dof-focal'), 'input', (e) => {
            config.dofFocal = parseFloat(e.target.value);
            document.getElementById('dof-focal-val').textContent = config.dofFocal.toFixed(2);
        });

        on(document.getElementById('dof-strength'), 'input', (e) => {
            config.dofStrength = parseFloat(e.target.value);
            document.getElementById('dof-strength-val').textContent = config.dofStrength.toFixed(1);
        });

        // Color mode
        on(document.getElementById('color-mode'), 'change', (e) => {
            const modes = { 'original': 0, 'depth': 1, 'normal': 2, 'blend': 3 };
            config.colorMode = modes[e.target.value];
        });

        // Debug views (mutually exclusive)
        const debugCheckboxes = ['show-depth', 'show-edges', 'show-density'];
        debugCheckboxes.forEach(id => {
            on(document.getElementById(id), 'change', (e) => {
                if (e.target.checked) {
                    debugCheckboxes.forEach(otherId => {
                        if (otherId !== id) {
                            document.getElementById(otherId).checked = false;
                            config[toCamelCase(otherId)] = false;
                        }
                    });
                }
                config[toCamelCase(id)] = e.target.checked;
            });
        });
    }

    function toCamelCase(str) {
        return str.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
    }

    // Start
    init();
})();

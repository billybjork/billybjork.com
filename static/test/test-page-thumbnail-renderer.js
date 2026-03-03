// Shared thumbnail, renderer, and sprite-loading runtime for the /test scene.
(function() {
    'use strict';

    function create(deps) {
        const {
            THREE,
            config,
            renderState,
            spriteSets,
            acquireSharedGeometry,
            releaseSharedGeometry,
            constants,
            shaders,
            getSharedRenderer,
            isReducedMotion,
            getInputState,
            setHasWebGL,
        } = deps;

        const {
            SPRITE_BASE_PATH,
            RESOLUTION,
            PLANE_WIDTH,
            PLANE_HEIGHT,
            CAMERA_FOV,
            CAMERA_Z,
            TILT_ORBIT_VERTICAL_SCALE,
            PAN_Y_CAMERA_INFLUENCE,
            PAN_Y_LOOK_INFLUENCE,
            CLOUD_FILL_FACTOR,
            SPRITE_REQUEST_VERSION,
        } = constants;

        const { vertexShader, fragmentShader, depthPrepassFragmentShader } = shaders;

    class SharedRenderer {
        constructor(canvas) {
            this.renderer = new THREE.WebGLRenderer({
                canvas,
                antialias: true,
                alpha: true,
                powerPreference: 'high-performance',
            });
            this.renderer.outputEncoding = THREE.sRGBEncoding;
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            this.renderer.setClearColor(0x000000, 0);
            this.renderer.autoClear = false;
            this.scene = new THREE.Scene();
            this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 2000);
            this.camera.position.set(0, 0, CAMERA_Z);
            this.camera.lookAt(0, 0, 0);
            this.resize();
        }

        resize() {
            const width = window.innerWidth;
            const height = window.innerHeight;
            const pixelRatio = Math.min(window.devicePixelRatio, 2);

            if (
                renderState.width !== width ||
                renderState.height !== height ||
                this.renderer.getPixelRatio() !== pixelRatio
            ) {
                renderState.width = width;
                renderState.height = height;
                this.renderer.setPixelRatio(pixelRatio);
                this.renderer.setSize(width, height, false);
                this.camera.aspect = width / Math.max(height, 1);
                this.camera.updateProjectionMatrix();
            }
        }

        render(renderables, globalProgress, time) {
            this.resize();

            const renderer = this.renderer;
            renderer.setScissorTest(false);
            renderer.setViewport(0, 0, renderState.width, renderState.height);
            renderer.clear(true, true, true);
            this.camera.updateMatrixWorld(true);

            if (renderables.length === 0) {
                return;
            }

            renderables.forEach(({ thumb, rect }) => {
                thumb.setVisible(true);
                thumb.update(globalProgress, time, rect);
            });

            renderer.render(this.scene, this.camera);
        }
    }

    // =============================================
    // Point Cloud Thumbnail Class
    // =============================================
    class PointCloudThumbnail {
        constructor(container, spriteId) {
            this.container = container;
            this.spriteId = spriteId;
            this.currentTilt = 0;
            this.currentPanX = 0;
            this.currentPanY = 0;
            this.viewportPosition = 0.5;
            this.pointCount = 0;
            this.currentCoherence = isReducedMotion() ? 1 : 0;
            this.coherenceOverride = null;
            this.opacityOverride = null;
            this.scatterBackBiasOverride = null;
            this.zPushOverride = null;
            this.scatterDepthBoostOverride = null;
            this.currentOpacityMultiplier = 1;
            this.currentScatterBackBias = 0;
            this.currentZPush = 0;
            this.currentScatterDepthBoost = 0;
            this.motionFrozen = false;
            this.renderSuppressed = false;
            this.geometryKey = null;
            this.cachedRect = null;
            this.isRenderable = false;
            this.isInViewportMargin = true;
            this.lastLayoutWidth = -1;
            this.lastLayoutHeight = -1;
            this.lastLayoutLeft = Number.NaN;
            this.lastLayoutTop = Number.NaN;
            this.lastLayoutCanvasWidth = -1;
            this.lastLayoutCanvasHeight = -1;

            this.group = new THREE.Group();
            this.group.visible = false;
            this.motionGroup = new THREE.Group();
            this.motionGroup.matrixAutoUpdate = false;
            this.group.add(this.motionGroup);
            const rendererContext = getSharedRenderer();
            if (rendererContext && rendererContext.scene) {
                rendererContext.scene.add(this.group);
            }

            this.virtualCamera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 2000);
            this.virtualLookTarget = new THREE.Vector3();
        }

        get spriteData() {
            return spriteSets[this.spriteId];
        }

        createPointCloud() {
            const { metadata, rgbTexture, depthTexture } = this.spriteData;
            const res = metadata.resolutions[RESOLUTION];
            const shared = acquireSharedGeometry(res.frame_width, res.frame_height, config.pointDensity);
            this.geometryKey = shared.key;
            const geometry = shared.geometry;
            this.pointCount = geometry.getAttribute('pixelUV').count;

            this.uniforms = {
                rgbAtlas: { value: rgbTexture },
                depthAtlas: { value: depthTexture },
                frameIndex: { value: 0.0 },
                atlasSize: { value: new THREE.Vector2(res.sheet_width, res.sheet_height) },
                frameSize: { value: new THREE.Vector2(res.frame_width, res.frame_height) },
                columns: { value: metadata.columns },
                depthAmount: { value: config.depthAmount },
                pointSize: { value: config.pointSize },
                depthSizing: { value: config.depthSizing },
                attenuationBase: { value: CAMERA_Z / 100 },
                sizeAttenuation: { value: config.sizeAttenuation },
                edgeScatter: { value: config.edgeScatter },
                edgeThreshold: { value: config.edgeThreshold },
                scatterBackBias: { value: 0.0 },
                scatterDepthBoost: { value: 0.0 },
                ambientWaveStrength: { value: config.ambientWaveStrength },
                ambientWaveFrequency: { value: config.ambientWaveFrequency },
                ambientWaveSpeed: { value: config.ambientWaveSpeed },
                ambientWaveDepthInfluence: { value: config.ambientWaveDepthInfluence },
                ambientWaveLateral: { value: config.ambientWaveLateral },
                time: { value: 0.0 },
                opacity: { value: config.opacity },
                depthOpacity: { value: config.depthOpacity },
                pointShape: { value: config.pointShape },
                colorMode: { value: config.colorMode },
                colorGain: { value: config.colorGain },
                opacityBoost: { value: config.opacityBoost },
                showDepth: { value: config.showDepth },
                showEdges: { value: config.showEdges },
                showDensity: { value: config.showDensity },
                dofEnable: { value: config.dofEnable },
                dofFocal: { value: config.dofFocal },
                dofStrength: { value: config.dofStrength },
                alphaClip: { value: config.alphaClip },
                prepassRadius: { value: config.prepassRadius },
            };

            // Pass 1: depth-only prepass for stable self-occlusion
            this.depthMaterial = new THREE.ShaderMaterial({
                vertexShader,
                fragmentShader: depthPrepassFragmentShader,
                uniforms: this.uniforms,
                transparent: false,
                depthTest: true,
                depthWrite: true,
                colorWrite: false,
                blending: THREE.NoBlending,
            });

            // Pass 2: color pass with soft alpha (depth-tested against prepass)
            this.material = new THREE.ShaderMaterial({
                vertexShader,
                fragmentShader,
                uniforms: this.uniforms,
                transparent: true,
                depthTest: true,
                depthWrite: false,
                blending: THREE.NormalBlending,
            });

            this.depthPoints = new THREE.Points(geometry, this.depthMaterial);
            this.depthPoints.frustumCulled = false;
            this.depthPoints.renderOrder = 0;
            this.motionGroup.add(this.depthPoints);

            this.points = new THREE.Points(geometry, this.material);
            this.points.frustumCulled = false;
            this.points.renderOrder = 1;
            this.motionGroup.add(this.points);
        }

        rebuildPointCloud() {
            this.disposePointCloud();
            this.createPointCloud();
        }

        disposePointCloud() {
            if (this.depthPoints) {
                this.motionGroup.remove(this.depthPoints);
                this.depthPoints = null;
            }
            if (this.points) {
                this.motionGroup.remove(this.points);
                this.points = null;
            }
            if (this.depthMaterial) {
                this.depthMaterial.dispose();
                this.depthMaterial = null;
            }
            if (this.material) {
                this.material.dispose();
                this.material = null;
            }
            this.uniforms = null;
            if (this.geometryKey) {
                releaseSharedGeometry(this.geometryKey);
                this.geometryKey = null;
            }
        }

        destroy() {
            this.disposePointCloud();
            const rendererContext = getSharedRenderer();
            if (this.group && rendererContext && rendererContext.scene) {
                rendererContext.scene.remove(this.group);
            }
        }

        updateViewportPosition(rect) {
            const viewportHeight = window.innerHeight;
            const elementCenter = rect.top + rect.height / 2;
            this.viewportPosition = 1 - (elementCenter / viewportHeight);
            this.viewportPosition = Math.max(-0.2, Math.min(1.2, this.viewportPosition));
        }

        calculateNaturalCoherence(rect) {
            if (isReducedMotion()) return 1;
            const viewportHeight = window.innerHeight;
            const elementCenter = rect.top + rect.height / 2;
            const viewportPosition = 1 - (elementCenter / viewportHeight);
            const clampedViewportPos = Math.max(-0.2, Math.min(1.2, viewportPosition));
            const distanceFromCenter = Math.abs((clampedViewportPos - 0.5) * 2);
            const clampedDistance = Math.min(1, Math.max(0, distanceFromCenter));
            const curvedDistance = Math.pow(clampedDistance, config.transitionCurve);
            return 1 - curvedDistance;
        }

        setVisible(isVisible) {
            if (this.group) {
                this.group.visible = isVisible;
            }
        }

        setCoherenceOverride(value) {
            if (value === null || value === undefined) {
                this.coherenceOverride = null;
                return;
            }
            // Allow limited overshoot during transition choreography so inactive
            // thumbnails can scatter beyond the normal edge state.
            this.coherenceOverride = Math.max(-1, Math.min(1, value));
        }

        setOpacityOverride(value) {
            if (value === null || value === undefined) {
                this.opacityOverride = null;
                return;
            }
            this.opacityOverride = Math.max(0, Math.min(1, value));
        }

        setScatterBackBiasOverride(value) {
            if (value === null || value === undefined) {
                this.scatterBackBiasOverride = null;
                return;
            }
            this.scatterBackBiasOverride = Math.max(0, Math.min(1, value));
        }

        setZPushOverride(value) {
            if (value === null || value === undefined) {
                this.zPushOverride = null;
                return;
            }
            this.zPushOverride = Math.max(-120, Math.min(40, value));
        }

        setScatterDepthBoostOverride(value) {
            if (value === null || value === undefined) {
                this.scatterDepthBoostOverride = null;
                return;
            }
            this.scatterDepthBoostOverride = Math.max(0, Math.min(1, value));
        }

        setMotionFrozen(frozen) {
            this.motionFrozen = !!frozen;
        }

        getMotionTargets(respectFreeze = true) {
            const scrollTilt = (this.viewportPosition - 0.5) * 2 * config.tiltRange;

            // Use global mouse position (or device orientation on mobile)
            const inputState = getInputState();
            let inputX = inputState.globalMouseX;
            let inputY = -inputState.globalMouseY; // Invert Y for natural feel

            if (inputState.hasDeviceOrientation) {
                inputX = inputState.deviceX;
                inputY = inputState.deviceY;
            }

            let targetPanX = inputX * config.mouseParallax;
            let targetPanY = inputY * config.mouseParallax * 0.6;
            let targetTilt = scrollTilt;

            if (respectFreeze && this.motionFrozen) {
                targetPanX = 0;
                targetPanY = 0;
                targetTilt = 0;
            }

            return { targetPanX, targetPanY, targetTilt };
        }

        snapMotionToCurrentTargets(rect, options = {}) {
            if (rect) {
                this.updateViewportPosition(rect);
            }
            const respectFreeze = options.respectFreeze !== false;
            const { targetPanX, targetPanY, targetTilt } = this.getMotionTargets(respectFreeze);
            this.currentTilt = targetTilt;
            this.currentPanX = targetPanX;
            this.currentPanY = targetPanY;
        }

        resetTransitionState() {
            this.coherenceOverride = null;
            this.opacityOverride = null;
            this.scatterBackBiasOverride = null;
            this.zPushOverride = null;
            this.scatterDepthBoostOverride = null;
            this.currentOpacityMultiplier = 1;
            this.currentScatterBackBias = 0;
            this.currentZPush = 0;
            this.currentScatterDepthBoost = 0;
            this.motionFrozen = false;
        }

        // Clear coherence override without causing a visual shift by syncing
        // currentCoherence to the auto-calculated value first
        clearCoherenceOverrideSmoothly(rect) {
            if (this.coherenceOverride === null) return;
            // Calculate what autoCoherence would be at this position
            const naturalCoherence = this.calculateNaturalCoherence(rect);
            // Sync currentCoherence to avoid any delta when override clears
            this.currentCoherence = naturalCoherence;
            this.coherenceOverride = null;
        }

        setRenderSuppressed(suppressed) {
            this.renderSuppressed = !!suppressed;
            if (this.renderSuppressed) {
                this.isRenderable = false;
                this.setVisible(false);
            }
        }

        syncLayout(rect) {
            if (!this.group) return;

            const left = Math.floor(rect.left);
            const top = Math.floor(rect.top);
            const width = Math.max(1, Math.ceil(rect.width));
            const height = Math.max(1, Math.ceil(rect.height));

            if (
                this.lastLayoutWidth === width &&
                this.lastLayoutHeight === height &&
                this.lastLayoutLeft === left &&
                this.lastLayoutTop === top &&
                this.lastLayoutCanvasWidth === renderState.width &&
                this.lastLayoutCanvasHeight === renderState.height
            ) {
                return;
            }

            this.lastLayoutWidth = width;
            this.lastLayoutHeight = height;
            this.lastLayoutLeft = left;
            this.lastLayoutTop = top;
            this.lastLayoutCanvasWidth = renderState.width;
            this.lastLayoutCanvasHeight = renderState.height;

            const halfFovRad = THREE.MathUtils.degToRad(CAMERA_FOV * 0.5);
            const visibleHeight = 2 * CAMERA_Z * Math.tan(halfFovRad);
            const pixelsPerWorld = renderState.height / Math.max(visibleHeight, 1e-6);
            const centerX = (left + width / 2 - renderState.width / 2) / pixelsPerWorld;
            const centerY = (renderState.height / 2 - (top + height / 2)) / pixelsPerWorld;
            const scaleX = (width * CLOUD_FILL_FACTOR) / (PLANE_WIDTH * pixelsPerWorld);
            const scaleY = (height * CLOUD_FILL_FACTOR) / (PLANE_HEIGHT * pixelsPerWorld);
            const scaleZ = (scaleX + scaleY) * 0.5;

            this.group.position.set(centerX, centerY, this.currentZPush);
            this.group.scale.set(scaleX, scaleY, scaleZ);
        }

        updateMotionTransform(effectiveDepth) {
            const rendererContext = getSharedRenderer();
            if (!this.motionGroup || !rendererContext || !rendererContext.camera) return;

            const sharedCamera = rendererContext.camera;
            if (Math.abs(this.virtualCamera.aspect - sharedCamera.aspect) > 1e-6) {
                this.virtualCamera.aspect = sharedCamera.aspect;
                this.virtualCamera.updateProjectionMatrix();
            }

            const tiltRad = THREE.MathUtils.degToRad(this.currentTilt);
            const distance = CAMERA_Z;
            const tiltY = Math.sin(tiltRad) * distance * TILT_ORBIT_VERTICAL_SCALE;
            const panY = this.currentPanY * PAN_Y_CAMERA_INFLUENCE;
            this.virtualCamera.position.x = this.currentPanX;
            this.virtualCamera.position.y = tiltY + panY;
            this.virtualCamera.position.z = Math.cos(tiltRad) * distance;
            this.virtualLookTarget.set(
                this.currentPanX * 0.3,
                this.currentPanY * PAN_Y_LOOK_INFLUENCE,
                effectiveDepth / 2
            );
            this.virtualCamera.lookAt(this.virtualLookTarget);
            this.virtualCamera.updateMatrixWorld(true);

            // Convert old per-thumbnail camera view transform into model transform
            // under the shared camera so motion/tilt/parallax matches prior behavior.
            this.motionGroup.matrix
                .copy(sharedCamera.matrixWorld)
                .multiply(this.virtualCamera.matrixWorldInverse);
            this.motionGroup.matrixWorldNeedsUpdate = true;
        }

        update(globalProgress, time, rect) {
            if (!this.material || !this.uniforms) return;

            const { metadata } = this.spriteData;
            let frameIndex = Math.floor(globalProgress) % metadata.frames;
            if (frameIndex < 0) frameIndex += metadata.frames;

            this.updateViewportPosition(rect);

            // =============================================
            // Viewport-aware coherence calculation
            // =============================================
            // distanceFromCenter: 0 at center, 1 at edges
            const distanceFromCenter = Math.abs((this.viewportPosition - 0.5) * 2);
            // Clamp to 0-1 range
            const clampedDistance = Math.min(1, Math.max(0, distanceFromCenter));
            // Apply power curve: <1 = wider center zone, >1 = narrower center zone
            const curvedDistance = Math.pow(clampedDistance, config.transitionCurve);
            // coherence: 1 at center (coherent), 0 at edges (exploded)
            const autoCoherence = isReducedMotion() ? 1 : (1 - curvedDistance);
            const targetCoherence = this.coherenceOverride !== null ? this.coherenceOverride : autoCoherence;
            // Smooth the coherence transition
            const coherenceLerp = isReducedMotion() ? 1 : (this.coherenceOverride !== null ? 0.22 : 0.1);
            this.currentCoherence += (targetCoherence - this.currentCoherence) * coherenceLerp;

            // Interpolate parameters based on coherence.
            // Keep depth/opacity in the normal [0,1] coherence band to avoid
            // transition overdrive pulling clouds toward the camera.
            const clampedCoherence = Math.max(0, Math.min(1, this.currentCoherence));
            const effectiveDepth = config.depthAmountCenter +
                (config.depthAmount - config.depthAmountCenter) * (1 - clampedCoherence);
            const effectiveScatter = config.edgeScatterCenter +
                (config.edgeScatter - config.edgeScatterCenter) * (1 - this.currentCoherence);
            const baseOpacity = config.opacityEdge +
                (config.opacity - config.opacityEdge) * clampedCoherence;
            const coherenceWaveScale = 0.45 + (1 - clampedCoherence) * 0.55;
            const effectiveAmbientWave = config.ambientWaveStrength * coherenceWaveScale;

            // Apply opacity override for fade transitions
            const targetOpacityMultiplier = this.opacityOverride !== null ? this.opacityOverride : 1;
            const opacityLerp = isReducedMotion() ? 1 : 0.15;
            this.currentOpacityMultiplier += (targetOpacityMultiplier - this.currentOpacityMultiplier) * opacityLerp;
            const effectiveOpacity = baseOpacity * this.currentOpacityMultiplier;
            const targetScatterBackBias = this.scatterBackBiasOverride !== null ? this.scatterBackBiasOverride : 0;
            const scatterBackBiasLerp = isReducedMotion() ? 1 : 0.14;
            this.currentScatterBackBias += (targetScatterBackBias - this.currentScatterBackBias) * scatterBackBiasLerp;
            const targetZPush = this.zPushOverride !== null ? this.zPushOverride : 0;
            const zPushLerp = isReducedMotion() ? 1 : (this.zPushOverride !== null ? 0.3 : 0.16);
            this.currentZPush += (targetZPush - this.currentZPush) * zPushLerp;
            const targetScatterDepthBoost = this.scatterDepthBoostOverride !== null ? this.scatterDepthBoostOverride : 0;
            const scatterDepthBoostLerp = isReducedMotion() ? 1 : (this.scatterDepthBoostOverride !== null ? 0.22 : 0.12);
            this.currentScatterDepthBoost += (targetScatterDepthBoost - this.currentScatterDepthBoost) * scatterDepthBoostLerp;

            // =============================================
            // Camera positioning
            // =============================================
            // Keep camera motion freeze explicitly controlled. Coherence overrides
            // should not implicitly zero tilt/pan, otherwise clearing override
            // causes a visible end-of-transition camera snap.
            const { targetPanX, targetPanY, targetTilt } = this.getMotionTargets(true);

            // Smooth interpolation - faster response for mouse, slower for scroll tilt
            const tiltLerp = isReducedMotion() ? 1 : (this.motionFrozen ? 0.25 : 0.12);
            const panLerp = isReducedMotion() ? 1 : (this.motionFrozen ? 0.25 : 0.15);
            this.currentTilt += (targetTilt - this.currentTilt) * tiltLerp;
            this.currentPanX += (targetPanX - this.currentPanX) * panLerp;
            this.currentPanY += (targetPanY - this.currentPanY) * panLerp;

            // =============================================
            // Update uniforms with viewport-aware values
            // =============================================
            const u = this.uniforms;
            u.frameIndex.value = frameIndex;
            u.depthAmount.value = effectiveDepth;
            u.pointSize.value = config.pointSize;
            u.depthSizing.value = config.depthSizing;
            u.sizeAttenuation.value = config.sizeAttenuation;
            u.edgeScatter.value = effectiveScatter;
            u.edgeThreshold.value = config.edgeThreshold;
            u.scatterBackBias.value = this.currentScatterBackBias;
            u.scatterDepthBoost.value = this.currentScatterDepthBoost;
            u.ambientWaveStrength.value = effectiveAmbientWave;
            u.ambientWaveFrequency.value = config.ambientWaveFrequency;
            u.ambientWaveSpeed.value = config.ambientWaveSpeed;
            u.ambientWaveDepthInfluence.value = config.ambientWaveDepthInfluence;
            u.ambientWaveLateral.value = config.ambientWaveLateral;
            u.time.value = time;
            u.opacity.value = effectiveOpacity;
            u.depthOpacity.value = config.depthOpacity;
            u.pointShape.value = config.pointShape;
            u.colorMode.value = config.colorMode;
            u.colorGain.value = config.colorGain;
            u.opacityBoost.value = config.opacityBoost;
            u.showDepth.value = config.showDepth;
            u.showEdges.value = config.showEdges;
            u.showDensity.value = config.showDensity;
            u.dofEnable.value = config.dofEnable;
            u.dofFocal.value = config.dofFocal;
            u.dofStrength.value = config.dofStrength;
            u.alphaClip.value = config.alphaClip;
            u.prepassRadius.value = config.prepassRadius;
            this.syncLayout(rect);
            this.group.position.z = this.currentZPush;
            this.updateMotionTransform(effectiveDepth);
        }
    }

    // =============================================
    // Initialization
    // =============================================
    function withVersion(url, version) {
        if (!version) return url;
        const separator = url.includes('?') ? '&' : '?';
        return `${url}${separator}v=${encodeURIComponent(version)}`;
    }

    async function loadSpriteSet(spriteId) {
        const spritePath = `${SPRITE_BASE_PATH}/${spriteId}`;

        let metadata;
        try {
            const metadataUrl = withVersion(`${spritePath}/metadata.json`, `${spriteId}-${SPRITE_REQUEST_VERSION}`);
            const response = await fetch(metadataUrl, { cache: 'no-store' });
            metadata = await response.json();
        } catch (err) {
            console.error(`Failed to load metadata for ${spriteId}:`, err);
            return null;
        }

        const loader = new THREE.TextureLoader();
        const res = metadata.resolutions[RESOLUTION];

        const atlasVersion = String(
            metadata.atlas_version ||
            `${spriteId}-${metadata.frames}-${metadata.columns}-${metadata.rows}-${res.sheet_width}x${res.sheet_height}`
        );
        const [rgbTexture, depthTexture] = await Promise.all([
            loadTexture(loader, withVersion(`${spritePath}/${res.rgb_file}`, atlasVersion)),
            loadTexture(loader, withVersion(`${spritePath}/${res.depth_file}`, atlasVersion)),
        ]);

        [rgbTexture, depthTexture].forEach(tex => {
            tex.minFilter = THREE.LinearFilter;
            tex.magFilter = THREE.LinearFilter;
            tex.generateMipmaps = false;
            tex.flipY = false;
            tex.wrapS = THREE.ClampToEdgeWrapping;
            tex.wrapT = THREE.ClampToEdgeWrapping;
        });
        rgbTexture.encoding = THREE.sRGBEncoding;
        depthTexture.encoding = THREE.LinearEncoding;

        const expectedWidth = res.sheet_width;
        const expectedHeight = res.sheet_height;
        const rgbWidth = rgbTexture.image?.width;
        const rgbHeight = rgbTexture.image?.height;
        const depthWidth = depthTexture.image?.width;
        const depthHeight = depthTexture.image?.height;
        if (
            rgbWidth !== expectedWidth ||
            rgbHeight !== expectedHeight ||
            depthWidth !== expectedWidth ||
            depthHeight !== expectedHeight
        ) {
            console.warn(`Atlas dimension mismatch for ${spriteId}`, {
                expectedWidth,
                expectedHeight,
                rgbWidth,
                rgbHeight,
                depthWidth,
                depthHeight,
            });
        }

        console.log(`Loaded sprite set: ${spriteId} (${metadata.frames} frames)`);
        return { metadata, rgbTexture, depthTexture };
    }

    function loadTexture(loader, url) {
        return new Promise((resolve, reject) => {
            loader.load(url, resolve, undefined, reject);
        });
    }

    function activateNoWebGLFallback(message, error = null) {
        setHasWebGL(false);
        document.body.classList.add('no-webgl');
        if (error) {
            console.error(message, error);
        } else {
            console.warn(message);
        }
    }


        return {
            SharedRenderer,
            PointCloudThumbnail,
            withVersion,
            loadSpriteSet,
            activateNoWebGLFallback,
        };
    }

    window.TestPageThumbnailRendererModule = Object.freeze({ create });
})();

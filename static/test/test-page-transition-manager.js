// Shared project transition manager runtime for the /test scene.
(function() {
    'use strict';

    function create(deps) {
        const {
            addManagedEventListener,
            thumbnailBySlug,
            getCurrentScrollY,
            setScrollTopImmediate,
            markRectsNeedUpdate,
            bumpTransitionRectRefresh,
            refreshRenderableThumbnails,
            isReducedMotion,
            isDebugEnabled,
        } = deps;

    class ProjectTransitionManager {
        constructor() {
            this.contextBySlug = new Map();
            this.promotedStates = new Map();
            this.mainFlowCleanupBySlug = new Map();
            this.currentOpenSlug = null;
            this.openSession = null;
            this.scrollTweenRafId = null;
            this.scrollTweenTarget = null;
            this.scrollTweenResolve = null;
            this.transitionToken = 0;
            this.transitionInFlight = false;
            this.fetchController = null;
            this.hlsScriptPromise = null;
            this.prefetchBySlug = new Map();
            this.prefetchAbortBySlug = new Map();
            this.detailsHtmlCache = new Map();
            this.manifestWarmupByUrl = new Map();
            this.preconnectedOrigins = new Set();
            this.hlsWarmupRequested = false;
            this.listSceneEl = document.getElementById('pc-list-scene');
            this.testBasePath = this.listSceneEl?.dataset.testBasePath || '/test';
            this.initialProjectSlug = this.listSceneEl?.dataset.initialProjectSlug || '';
            this.initialProjectDirectEntry = this.listSceneEl?.dataset.initialProjectDirectEntry === 'true';
            this.projectQueryParam = 'project';
            this.transitionPhase = 'idle';
            this.transitionStartTime = 0;
            this.phaseStartTime = 0;
            this.debugEnabled = typeof isDebugEnabled === 'function' && isDebugEnabled();
            this.boundCaptureClick = this.handleCaptureClick.bind(this);
            this.boundKeyDown = this.handleKeyDown.bind(this);
            this.boundPrefetchIntent = this.handlePrefetchIntent.bind(this);
            this.boundPopState = this.handlePopState.bind(this);
        }

        init() {
            this.rebuildContextMap();
            this.syncDetailModeClass(false);
            addManagedEventListener(document, 'click', this.boundCaptureClick, true);
            addManagedEventListener(document, 'keydown', this.boundKeyDown);
            addManagedEventListener(document, 'pointerover', this.boundPrefetchIntent, true);
            addManagedEventListener(document, 'pointerdown', this.boundPrefetchIntent, true);
            addManagedEventListener(document, 'focusin', this.boundPrefetchIntent, true);
            addManagedEventListener(document, 'touchstart', this.boundPrefetchIntent, { passive: true, capture: true });
            this.ensureHistoryStateFromLocation();
            addManagedEventListener(window, 'popstate', this.boundPopState);
            this.warmHlsScript();
            document.querySelectorAll('.pc-project[data-hls-url]').forEach((item) => {
                this.ensurePreconnectForUrl(item.dataset.hlsUrl || '');
            });
            this.openInitialProjectIfNeeded();
        }

        destroy() {
            this.abortPendingFetch();
            this.prefetchAbortBySlug.forEach((controller) => controller.abort());
            this.prefetchAbortBySlug.clear();
            this.prefetchBySlug.clear();
            this.detailsHtmlCache.clear();
            this.manifestWarmupByUrl.clear();
            this.preconnectedOrigins.clear();
            this.mainFlowCleanupBySlug.forEach((cleanup) => cleanup());
            this.mainFlowCleanupBySlug.clear();
            this.promotedStates.forEach((_state, slug) => {
                const context = this.contextBySlug.get(slug);
                if (context) {
                    this.restoreContainer(context, false);
                    context.thumbnail.setRenderSuppressed(false);
                    this.destroyVideoInContext(context);
                }
            });
            this.promotedStates.clear();
            this.contextBySlug.clear();
            this.currentOpenSlug = null;
            this.openSession = null;
            this.cancelManagedScrollTween();
            if (this.listSceneEl) {
                this.listSceneEl.classList.remove('pc-single-project-mode');
                this.listSceneEl.classList.remove('pc-single-project-compact');
                this.listSceneEl.removeAttribute('data-active-slug');
            }
            document.body.classList.remove('pc-header-collapsed');
            document.body.classList.remove('pc-header-prehidden');
            this.syncDetailModeClass(false);
            this.transitionInFlight = false;
        }

        destroyVideosExcept(keepSlug = null) {
            this.contextBySlug.forEach((context, slug) => {
                if (keepSlug && slug === keepSlug) return;
                this.destroyVideoInContext(context);
                this.setHeroSlotVisibility(context, false);
                context.heroSlot.innerHTML = '';
                this.resetProjectVisualState(context);
                context.container.classList.remove('thumb-hidden');
                context.thumbnail.setRenderSuppressed(false);
            });
        }

        rebuildContextMap() {
            this.contextBySlug.clear();
            document.querySelectorAll('.pc-project[data-slug]').forEach((item) => {
                const slug = item.dataset.slug;
                if (!slug) return;
                const container = item.querySelector('.pc-thumbnail-container');
                const heroSlot = item.querySelector(`#hero-${slug}`);
                const details = item.querySelector(`#details-${slug}`);
                const closeButton = item.querySelector('.pc-close-project');
                const thumbnail = thumbnailBySlug.get(slug);
                if (!container || !heroSlot || !details || !closeButton || !thumbnail) return;
                this.contextBySlug.set(slug, {
                    slug,
                    item,
                    container,
                    heroSlot,
                    details,
                    closeButton,
                    thumbnail,
                });
            });
        }

        setHeroSlotVisibility(ctx, slotVisible, videoVisible = false) {
            ctx.heroSlot.classList.toggle('slot-visible', !!slotVisible);
            ctx.heroSlot.classList.toggle('video-visible', !!videoVisible);
            ctx.heroSlot.setAttribute('aria-hidden', slotVisible ? 'false' : 'true');
        }

        restoreDefaultStageAspectRatio(ctx) {
            const rawRatio = ctx.item.dataset.stageAspectRatio;
            const resolvedRatio = Number.parseFloat(rawRatio || '');
            if (Number.isFinite(resolvedRatio) && resolvedRatio > 0.35 && resolvedRatio < 4.5) {
                ctx.item.style.setProperty('--pc-stage-aspect-ratio', resolvedRatio.toString());
                return;
            }
            ctx.item.style.removeProperty('--pc-stage-aspect-ratio');
        }

        resetProjectVisualState(ctx) {
            this.stopMainFlowShift(ctx);
            this.clearPinnedCloseButton(ctx);
            ctx.item.classList.remove('pc-has-hero-video');
            ctx.item.classList.remove('pc-hero-expanded');
            ctx.item.classList.remove('pc-closing');
            this.restoreDefaultStageAspectRatio(ctx);
            ctx.item.style.top = '';
            ctx.item.style.left = '';
            ctx.item.style.width = '';
        }

        syncDetailModeClass(isDetailOpen) {
            document.body.classList.toggle('pc-test-detail-mode', !!isDetailOpen);
        }

        debugRect(rect) {
            if (!rect) return null;
            return {
                top: Number(rect.top.toFixed(2)),
                left: Number(rect.left.toFixed(2)),
                width: Number(rect.width.toFixed(2)),
                height: Number(rect.height.toFixed(2)),
                bottom: Number(rect.bottom.toFixed(2)),
                right: Number(rect.right.toFixed(2)),
            };
        }

        readViewportMetrics() {
            const viewport = window.visualViewport;
            return {
                scrollY: Number(getCurrentScrollY().toFixed(2)),
                innerWidth: window.innerWidth,
                innerHeight: window.innerHeight,
                viewportWidth: Number((viewport?.width ?? window.innerWidth).toFixed(2)),
                viewportHeight: Number((viewport?.height ?? window.innerHeight).toFixed(2)),
                viewportOffsetTop: Number((viewport?.offsetTop ?? 0).toFixed(2)),
                viewportOffsetLeft: Number((viewport?.offsetLeft ?? 0).toFixed(2)),
                viewportScale: Number((viewport?.scale ?? 1).toFixed(3)),
            };
        }

        debugLog(eventName, payload = {}) {
            if (!this.debugEnabled) return;
            const now = performance.now();
            const transitionElapsed = this.transitionStartTime > 0
                ? Number((now - this.transitionStartTime).toFixed(2))
                : 0;
            const phaseElapsed = this.phaseStartTime > 0
                ? Number((now - this.phaseStartTime).toFixed(2))
                : 0;
            console.log('[pc-transition]', eventName, {
                token: this.transitionToken,
                phase: this.transitionPhase,
                transitionElapsedMs: transitionElapsed,
                phaseElapsedMs: phaseElapsed,
                ...payload,
            });
        }

        setPhase(nextPhase, token, payload = {}) {
            if (!this.isTokenActive(token)) return;
            this.transitionPhase = nextPhase;
            this.phaseStartTime = performance.now();
            this.debugLog('phase', {
                nextPhase,
                ...payload,
            });
        }

        captureListSourceState(ctx) {
            return {
                sourceRect: ctx.container.getBoundingClientRect(),
                sourceScrollY: window.pageYOffset || document.documentElement.scrollTop || 0,
            };
        }

        setSingleProjectMode(slug, sourceState, options = {}) {
            if (!this.listSceneEl) return;
            const context = this.contextBySlug.get(slug);
            if (!context) return;

            this.listSceneEl.classList.remove('pc-single-project-compact');
            this.listSceneEl.classList.add('pc-single-project-mode');
            this.listSceneEl.setAttribute('data-active-slug', slug);
            document.body.classList.remove('pc-header-collapsed');
            // Prevent any header/nav flash when entering detail mode before compaction commits.
            document.body.classList.add('pc-header-prehidden');
            this.syncDetailModeClass(true);

            const token = Number.isFinite(options.token) ? options.token : this.transitionToken;
            const prefersInstant = options.prefersInstant === true || isReducedMotion();
            const inactiveExplodeCoherence = prefersInstant
                ? 0
                : Math.max(-1, Math.min(1, Number(options.inactiveExplodeCoherence) || -0.4));
            const inactiveExplodeBackBias = prefersInstant
                ? 0
                : Math.max(0, Math.min(1, Number(options.inactiveExplodeBackBias) || 0.75));
            const inactiveExplodeZPush = prefersInstant
                ? 0
                : Math.max(-80, Math.min(0, Number(options.inactiveExplodeZPush) || -18));
            const inactiveExplodeScatterDepthBoost = prefersInstant
                ? 0
                : Math.max(0, Math.min(1, Number(options.inactiveExplodeScatterDepthBoost) || 0.65));
            const inactiveTransitionDurationMs = prefersInstant
                ? 0
                : Math.max(0, Number(options.inactiveTransitionDurationMs) || 620);

            // Dissipate inactive thumbnails via WebGL while the list collapses.
            this.contextBySlug.forEach((ctx, ctxSlug) => {
                if (ctxSlug !== slug && ctx.thumbnail) {
                    if (inactiveTransitionDurationMs <= 0) {
                        ctx.thumbnail.setCoherenceOverride(inactiveExplodeCoherence);
                        ctx.thumbnail.setScatterBackBiasOverride(inactiveExplodeBackBias);
                        ctx.thumbnail.setZPushOverride(inactiveExplodeZPush);
                        ctx.thumbnail.setScatterDepthBoostOverride(inactiveExplodeScatterDepthBoost);
                        ctx.thumbnail.setOpacityOverride(0);
                        return;
                    }
                    const rect = ctx.thumbnail.cachedRect || ctx.container.getBoundingClientRect();
                    const startCoherence = ctx.thumbnail.calculateNaturalCoherence(rect);
                    ctx.thumbnail.setCoherenceOverride(startCoherence);
                    ctx.thumbnail.setScatterBackBiasOverride(inactiveExplodeBackBias);
                    ctx.thumbnail.setScatterDepthBoostOverride(0);
                    ctx.thumbnail.setOpacityOverride(1);
                    this.animateCoherence(
                        ctx.thumbnail,
                        inactiveExplodeCoherence,
                        inactiveTransitionDurationMs,
                        token,
                        { easing: 'inOut' }
                    );
                    this.animateOpacity(
                        ctx.thumbnail,
                        0,
                        inactiveTransitionDurationMs,
                        token,
                        { easing: 'inOut' }
                    );
                    this.animateZPush(
                        ctx.thumbnail,
                        inactiveExplodeZPush,
                        inactiveTransitionDurationMs,
                        token,
                        { easing: 'out' }
                    );
                    this.animateScatterDepthBoost(
                        ctx.thumbnail,
                        inactiveExplodeScatterDepthBoost,
                        inactiveTransitionDurationMs,
                        token,
                        { easing: 'out' }
                    );
                }
            });

            this.openSession = {
                slug,
                origin: options.origin || 'list',
                sourceRect: sourceState?.sourceRect || null,
                sourceScrollY: Number.isFinite(sourceState?.sourceScrollY) ? sourceState.sourceScrollY : null,
            };
        }

        readStableViewportTop(element) {
            if (!element) return 0;
            const rect = element.getBoundingClientRect();
            const offsetTop = window.visualViewport?.offsetTop;
            return rect.top - (Number.isFinite(offsetTop) ? offsetTop : 0);
        }

        isTouchLikeDevice() {
            return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
        }

        waitForAnimationFrames(frameCount = 1, token = this.transitionToken) {
            const steps = Math.max(1, Number(frameCount) || 1);
            return new Promise((resolve) => {
                let remaining = steps;
                const tick = () => {
                    if (!this.isTokenActive(token)) {
                        resolve();
                        return;
                    }
                    remaining -= 1;
                    if (remaining <= 0) {
                        resolve();
                        return;
                    }
                    requestAnimationFrame(tick);
                };
                requestAnimationFrame(tick);
            });
        }

        waitForDuration(durationMs = 0, token = this.transitionToken) {
            const totalMs = Math.max(0, Number(durationMs) || 0);
            if (totalMs <= 0) return Promise.resolve();
            return new Promise((resolve) => {
                const startedAt = performance.now();
                const step = (now) => {
                    if (!this.isTokenActive(token)) {
                        resolve();
                        return;
                    }
                    if ((now - startedAt) >= totalMs) {
                        resolve();
                        return;
                    }
                    requestAnimationFrame(step);
                };
                requestAnimationFrame(step);
            });
        }

        async applyAnchoredLayoutMutation(slug, token, mutateLayout, options = {}) {
            const context = this.contextBySlug.get(slug);
            if (!context || typeof mutateLayout !== 'function') {
                if (typeof mutateLayout === 'function') mutateLayout();
                return;
            }

            const reason = options.reason || 'layout-mutation';
            const maxFrames = Math.max(1, Number(options.maxFrames) || 8);
            const anchorTop = this.readStableViewportTop(context.item);
            const startScrollY = getCurrentScrollY();
            const corrections = [];

            mutateLayout();
            markRectsNeedUpdate();
            refreshRenderableThumbnails();

            for (let frame = 0; frame < maxFrames; frame += 1) {
                await this.waitForAnimationFrames(1, token);
                if (!this.isTokenActive(token)) return;
                const currentTop = this.readStableViewportTop(context.item);
                const delta = currentTop - anchorTop;
                if (Math.abs(delta) <= 0.5) {
                    if (frame >= 1) break;
                    continue;
                }
                const nextScroll = getCurrentScrollY() + delta;
                setScrollTopImmediate(nextScroll);
                corrections.push({
                    frame,
                    delta: Number(delta.toFixed(3)),
                    nextScrollY: Number(nextScroll.toFixed(2)),
                });
            }

            this.debugLog('anchor-layout-mutation', {
                slug,
                reason,
                fromScrollY: Number(startScrollY.toFixed(2)),
                toScrollY: Number(getCurrentScrollY().toFixed(2)),
                anchorTop: Number(anchorTop.toFixed(3)),
                corrections,
                viewport: this.readViewportMetrics(),
            });
        }

        async setCompactionState(slug, shouldCompact, token, reason) {
            if (!this.listSceneEl) return;
            const compactEnabled = this.listSceneEl.classList.contains('pc-single-project-compact');
            if (compactEnabled === shouldCompact) {
                this.debugLog('compaction-skip', {
                    slug,
                    reason,
                    shouldCompact,
                    compactEnabled,
                });
                return;
            }

            this.debugLog('compaction-start', {
                slug,
                reason,
                shouldCompact,
                compactEnabled,
                viewport: this.readViewportMetrics(),
            });

            await this.applyAnchoredLayoutMutation(slug, token, () => {
                this.listSceneEl.classList.toggle('pc-single-project-compact', shouldCompact);
                document.body.classList.toggle('pc-header-collapsed', shouldCompact);
            }, {
                reason,
                maxFrames: shouldCompact ? 10 : 8,
            });
            if (!this.isTokenActive(token)) return;

            bumpTransitionRectRefresh(320);
            this.debugLog('compaction-complete', {
                slug,
                reason,
                shouldCompact,
                compactEnabled: this.listSceneEl.classList.contains('pc-single-project-compact'),
                viewport: this.readViewportMetrics(),
            });
        }

        async settleProjectTop(slug, token, desiredTop = 0, options = {}) {
            const ctx = this.contextBySlug.get(slug);
            if (!ctx?.item) return;
            const maxFrames = Math.max(1, Number(options.maxFrames) || 4);
            const settleReason = options.reason || 'settle-project-top';
            const corrections = [];
            const startTop = this.readStableViewportTop(ctx.item);
            const startScrollY = getCurrentScrollY();

            for (let frame = 0; frame < maxFrames; frame += 1) {
                await this.waitForAnimationFrames(1, token);
                if (!this.isTokenActive(token)) return;
                const currentTop = this.readStableViewportTop(ctx.item);
                const delta = currentTop - desiredTop;
                if (Math.abs(delta) <= 0.5) {
                    if (frame >= 1) break;
                    continue;
                }
                const nextScroll = getCurrentScrollY() + delta;
                setScrollTopImmediate(nextScroll);
                corrections.push({
                    frame,
                    delta: Number(delta.toFixed(3)),
                    nextScrollY: Number(nextScroll.toFixed(2)),
                });
            }

            if (this.isTouchLikeDevice()) {
                await this.waitForDuration(120, token);
                if (!this.isTokenActive(token)) return;
                const lateTop = this.readStableViewportTop(ctx.item);
                const lateDelta = lateTop - desiredTop;
                if (Math.abs(lateDelta) > 0.5) {
                    const nextScroll = getCurrentScrollY() + lateDelta;
                    setScrollTopImmediate(nextScroll);
                    corrections.push({
                        frame: 'late',
                        delta: Number(lateDelta.toFixed(3)),
                        nextScrollY: Number(nextScroll.toFixed(2)),
                    });
                }
            }

            this.debugLog('open-top-settle', {
                slug,
                reason: settleReason,
                desiredTop: Number(desiredTop.toFixed(3)),
                startTop: Number(startTop.toFixed(3)),
                endTop: Number(this.readStableViewportTop(ctx.item).toFixed(3)),
                startScrollY: Number(startScrollY.toFixed(2)),
                endScrollY: Number(getCurrentScrollY().toFixed(2)),
                corrections,
                viewport: this.readViewportMetrics(),
            });
        }

        cancelManagedScrollTween() {
            if (this.scrollTweenRafId !== null) {
                cancelAnimationFrame(this.scrollTweenRafId);
                this.scrollTweenRafId = null;
            }
            this.scrollTweenTarget = null;
            if (typeof this.scrollTweenResolve === 'function') {
                const resolve = this.scrollTweenResolve;
                this.scrollTweenResolve = null;
                resolve();
            }
        }

        startManagedScrollTween(targetTop, durationMs, token) {
            this.cancelManagedScrollTween();

            const startY = getCurrentScrollY();
            const clampedTarget = Math.max(0, Number(targetTop) || 0);
            this.scrollTweenTarget = clampedTarget;
            const delta = clampedTarget - startY;
            if (Math.abs(delta) < 0.5 || durationMs <= 0) {
                setScrollTopImmediate(clampedTarget);
                this.scrollTweenTarget = null;
                return Promise.resolve();
            }

            return new Promise((resolve) => {
                this.scrollTweenResolve = resolve;
                const startTime = performance.now();
                const step = (now) => {
                    if (!this.isTokenActive(token)) {
                        this.cancelManagedScrollTween();
                        return;
                    }

                    const t = Math.min(1, (now - startTime) / durationMs);
                    const eased = 1 - Math.pow(1 - t, 3);
                    setScrollTopImmediate(startY + delta * eased);

                    if (t < 1) {
                        this.scrollTweenRafId = requestAnimationFrame(step);
                        return;
                    }

                    this.cancelManagedScrollTween();
                };
                this.scrollTweenRafId = requestAnimationFrame(step);
            });
        }

        clearSingleProjectMode(options = {}) {
            if (this.listSceneEl) {
                this.listSceneEl.classList.remove('pc-single-project-mode');
                this.listSceneEl.classList.remove('pc-single-project-compact');
                this.listSceneEl.removeAttribute('data-active-slug');
            }
            document.body.classList.remove('pc-header-collapsed');
            document.body.classList.remove('pc-header-prehidden');
            this.syncDetailModeClass(false);
            const keepOpacityOverrides = options.keepOpacityOverrides === true;
            const keepScatterBackBiasOverrides = options.keepScatterBackBiasOverrides === true;
            const keepZPushOverrides = options.keepZPushOverrides === true;
            const keepScatterDepthBoostOverrides = options.keepScatterDepthBoostOverrides === true;

            // Reset opacity overrides and fixed positioning so inactive projects restore
            this.contextBySlug.forEach((ctx) => {
                ctx.item.style.top = '';
                ctx.item.style.left = '';
                ctx.item.style.width = '';
                if (ctx.thumbnail && !keepOpacityOverrides) {
                    ctx.thumbnail.setOpacityOverride(null);
                }
                if (ctx.thumbnail && !keepScatterBackBiasOverrides) {
                    ctx.thumbnail.setScatterBackBiasOverride(null);
                }
                if (ctx.thumbnail && !keepZPushOverrides) {
                    ctx.thumbnail.setZPushOverride(null);
                }
                if (ctx.thumbnail && !keepScatterDepthBoostOverrides) {
                    ctx.thumbnail.setScatterDepthBoostOverride(null);
                }
            });

            if (Number.isFinite(options.restoreScrollY)) {
                setScrollTopImmediate(options.restoreScrollY);
            }
            if (!options.keepSession) {
                this.openSession = null;
            }
        }

        waitForCloseThumbnailReady(ctx, token, maxFrames = 6) {
            if (!ctx?.thumbnail) return Promise.resolve(false);
            markRectsNeedUpdate();
            bumpTransitionRectRefresh(220);
            return new Promise((resolve) => {
                let frames = 0;
                const step = () => {
                    if (!this.isTokenActive(token)) {
                        resolve(false);
                        return;
                    }

                    const thumb = ctx.thumbnail;
                    const ready = !!thumb.group?.visible && thumb.isRenderable;
                    if (ready) {
                        requestAnimationFrame(() => resolve(true));
                        return;
                    }

                    frames += 1;
                    if (frames >= maxFrames) {
                        resolve(false);
                        return;
                    }

                    requestAnimationFrame(step);
                };
                requestAnimationFrame(step);
            });
        }

        async toggleProject(slug) {
            if (!slug || this.transitionInFlight) return;
            this.transitionInFlight = true;
            try {
                if (this.currentOpenSlug && this.currentOpenSlug !== slug) {
                    await this.closeProject(this.currentOpenSlug, { updateUrl: false });
                }

                if (this.currentOpenSlug === slug) {
                    await this.closeProject(slug);
                } else {
                    await this.openProject(slug, { origin: 'list' });
                }
            } finally {
                this.transitionInFlight = false;
            }
        }

        async openProject(slug, options = {}) {
            const ctx = this.contextBySlug.get(slug);
            if (!ctx) return;
            const token = this.beginTransition();
            const openOrigin = options.origin || 'list';
            const shouldUpdateUrl = options.updateUrl !== false;
            const historyMode = options.historyMode === 'replace' ? 'replace' : 'push';
            const sourceState = openOrigin === 'list' ? this.captureListSourceState(ctx) : null;
            const prefersInstant = isReducedMotion() || options.instant === true;
            const shouldScrollToProject = options.skipScroll !== true;
            const shouldSettleOpenTop = shouldScrollToProject && openOrigin === 'list';
            const serializeCompactionAfterScroll = shouldSettleOpenTop && this.isTouchLikeDevice() && !prefersInstant;
            this.setPhase('open.prepare', token, { slug, origin: openOrigin, prefersInstant });
            this.debugLog('open-source-state', {
                slug,
                sourceRect: this.debugRect(sourceState?.sourceRect || null),
                sourceScrollY: sourceState?.sourceScrollY ?? null,
                viewport: this.readViewportMetrics(),
            });

            this.destroyVideosExcept(slug);
            this.destroyVideoInContext(ctx);
            const detailsHtmlPromise = this.fetchProjectDetailsHTML(slug, token);

            ctx.thumbnail.setRenderSuppressed(false);
            ctx.thumbnail.setOpacityOverride(null);
            ctx.thumbnail.setCoherenceOverride(null);
            ctx.thumbnail.setScatterBackBiasOverride(null);
            ctx.thumbnail.setZPushOverride(null);
            ctx.thumbnail.setScatterDepthBoostOverride(null);
            ctx.item.classList.add('pc-open');
            ctx.item.classList.remove('pc-content-visible');
            this.resetProjectVisualState(ctx);
            ctx.details.hidden = true;
            ctx.details.innerHTML = '';
            this.setHeroSlotVisibility(ctx, false);
            ctx.heroSlot.innerHTML = '';
            ctx.closeButton.disabled = true;
            ctx.container.classList.remove('thumb-hidden');

            ctx.thumbnail.setMotionFrozen(true);

            let html = '';
            try {
                html = await detailsHtmlPromise;
            } catch (err) {
                if (!this.isTokenActive(token)) return;
                console.error(`Failed to load ${slug}:`, err);
                ctx.item.classList.remove('pc-open');
                ctx.closeButton.disabled = false;
                ctx.thumbnail.resetTransitionState();
                return;
            }

            if (!this.isTokenActive(token)) return;
            const hasHeroVideo = this.populateProjectContent(ctx, html);
            if (hasHeroVideo) {
                ctx.item.classList.add('pc-has-hero-video');
                this.syncStageAspectRatioFromHero(ctx);
            }

            // For animated hero path, ensure a paint occurs at opacity: 1 before
            // triggering the CSS transition to opacity: 0. Without this, the reflow
            // caused by getBoundingClientRect() later would compute opacity: 0 before
            // any paint occurs at opacity: 1, causing the transition to be skipped.
            if (hasHeroVideo && !prefersInstant) {
                await new Promise(resolve => requestAnimationFrame(resolve));
                if (!this.isTokenActive(token)) return;
            }

            this.setPhase('open.detail-mode', token, { slug });
            this.setSingleProjectMode(slug, sourceState, {
                origin: openOrigin,
                token,
                prefersInstant,
            });

            let heroMorphStartRect = null;
            if (hasHeroVideo && !prefersInstant) {
                heroMorphStartRect = ctx.container.getBoundingClientRect();
                this.promoteContainer(ctx);
                this.setContainerRect(ctx.container, heroMorphStartRect);
                this.debugLog('open-precompact-start-rect', {
                    slug,
                    startRect: this.debugRect(heroMorphStartRect),
                    viewport: this.readViewportMetrics(),
                });
            }

            const scrollOpenProjectIntoView = (durationMs) => {
                if (!shouldScrollToProject) {
                    return Promise.resolve();
                }
                const targetTop = getCurrentScrollY() + ctx.item.getBoundingClientRect().top;
                this.debugLog('open-scroll-target', {
                    slug,
                    durationMs,
                    targetTop: Number(targetTop.toFixed(2)),
                    viewport: this.readViewportMetrics(),
                });
                if (prefersInstant || durationMs <= 0) {
                    setScrollTopImmediate(targetTop);
                    return Promise.resolve();
                }
                return this.startManagedScrollTween(targetTop, durationMs, token);
            };

            const compactionLeadInNoHeroMs = prefersInstant ? 0 : 170;
            const compactionLeadInHeroMs = prefersInstant ? 0 : 220;
            const commitOpenCompaction = (leadInMs, reason) => {
                const delayMs = Math.max(0, Number(leadInMs) || 0);
                this.debugLog('open-compaction-queued', {
                    slug,
                    reason,
                    leadInMs: delayMs,
                });
                // Keep one continuous visual motion: start fade/morph first, then
                // compact once the transition is already in flight.
                return this.waitForDuration(delayMs, token).then(async () => {
                    if (!this.isTokenActive(token)) return;
                    await this.setCompactionState(slug, true, token, reason);
                });
            };

            if (!hasHeroVideo) {
                this.setPhase('open.no-hero', token, { slug });
                const noHeroDuration = prefersInstant ? 0 : 320;
                const noHeroScrollPromise = scrollOpenProjectIntoView(noHeroDuration);
                const noHeroCompactionPromise = serializeCompactionAfterScroll
                    ? noHeroScrollPromise.then(() => {
                        if (!this.isTokenActive(token)) return;
                        return commitOpenCompaction(0, 'open-compact-no-hero-after-scroll');
                    })
                    : commitOpenCompaction(compactionLeadInNoHeroMs, 'open-compact-no-hero');
                await Promise.all([
                    this.animateCoherence(ctx.thumbnail, 1, noHeroDuration, token, { easing: 'inOut' }),
                    noHeroScrollPromise,
                    noHeroCompactionPromise,
                ]);
                if (!this.isTokenActive(token)) return;
                if (shouldSettleOpenTop) {
                    await this.settleProjectTop(slug, token, 0, { reason: 'open-no-hero-final' });
                    if (!this.isTokenActive(token)) return;
                }

                requestAnimationFrame(() => {
                    if (!this.isTokenActive(token)) return;
                    ctx.item.classList.add('pc-content-visible');
                });
                ctx.closeButton.disabled = false;
                this.currentOpenSlug = slug;
                ctx.thumbnail.resetTransitionState();
                ctx.thumbnail.setRenderSuppressed(false);
                this.setHeroSlotVisibility(ctx, false);
                if (shouldUpdateUrl) {
                    this.syncOpenUrlState(slug, openOrigin, historyMode);
                }
                this.setPhase('open.complete', token, { slug, hasHeroVideo: false });
                return;
            }

            if (prefersInstant) {
                this.setPhase('open.hero-instant', token, { slug });
                const heroVideo = ctx.heroSlot.querySelector('video');
                await Promise.all([
                    scrollOpenProjectIntoView(0),
                    commitOpenCompaction(0, 'open-compact-hero-instant'),
                ]);
                if (!this.isTokenActive(token)) return;
                if (shouldSettleOpenTop) {
                    await this.settleProjectTop(slug, token, 0, { reason: 'open-hero-instant-final' });
                    if (!this.isTokenActive(token)) return;
                }
                ctx.item.classList.add('pc-hero-expanded');
                this.setHeroSlotVisibility(ctx, true);
                ctx.thumbnail.setCoherenceOverride(1);
                ctx.container.classList.add('thumb-hidden');
                ctx.thumbnail.setRenderSuppressed(true);
                ctx.item.classList.add('pc-content-visible');
                ctx.closeButton.disabled = false;
                this.currentOpenSlug = slug;
                ctx.thumbnail.resetTransitionState();
                if (shouldUpdateUrl) {
                    this.syncOpenUrlState(slug, openOrigin, historyMode);
                }

                if (heroVideo) {
                    this.prepareHeroVideoReady(heroVideo, ctx, token)
                        .then((ready) => {
                            if (!this.isTokenActive(token)) return;
                            if (ready) {
                                this.setHeroSlotVisibility(ctx, true, true);
                            }
                        })
                        .catch(() => {});
                }
                this.setPhase('open.complete', token, { slug, hasHeroVideo: true, instant: true });
                return;
            }

            this.setPhase('open.hero-morph', token, { slug });
            const heroVideo = ctx.heroSlot.querySelector('video');
            const heroVideoReadyPromise = heroVideo
                ? this.prepareHeroVideoReady(heroVideo, ctx, token)
                : Promise.resolve(false);

            const morphDuration = 640;
            const openScrollPromise = scrollOpenProjectIntoView(morphDuration);
            const openCompactionPromise = serializeCompactionAfterScroll
                ? openScrollPromise.then(() => {
                    if (!this.isTokenActive(token)) return;
                    return commitOpenCompaction(0, 'open-compact-hero-morph-after-scroll');
                })
                : commitOpenCompaction(compactionLeadInHeroMs, 'open-compact-hero-morph');
            const startRect = heroMorphStartRect || ctx.container.getBoundingClientRect();
            this.setContainerRect(ctx.container, startRect);
            this.animateMainFlowShift(ctx, morphDuration, token, () => {
                ctx.item.classList.add('pc-hero-expanded');
            });

            const targetRect = ctx.heroSlot.getBoundingClientRect();
            const hasTarget = targetRect.width > 0 && targetRect.height > 0;
            this.debugLog('open-morph-rects', {
                slug,
                startRect: this.debugRect(startRect),
                targetRect: this.debugRect(targetRect),
                viewport: this.readViewportMetrics(),
            });
            const flattenPromise = this.animateCoherence(ctx.thumbnail, 1, morphDuration, token, { easing: 'inOut' });
            const rectPromise = hasTarget
                ? this.animateRect(ctx.container, startRect, targetRect, morphDuration, token, {
                    getTargetRect: () => ctx.heroSlot.getBoundingClientRect(),
                })
                : Promise.resolve();
            await Promise.all([flattenPromise, rectPromise, openScrollPromise, openCompactionPromise]);
            if (!this.isTokenActive(token)) return;
            if (shouldSettleOpenTop) {
                await this.settleProjectTop(slug, token, 0, { reason: 'open-hero-final' });
                if (!this.isTokenActive(token)) return;
            }

            const videoIsReady = await heroVideoReadyPromise;

            if (videoIsReady) {
                this.setHeroSlotVisibility(ctx, true, true);
                this.restoreContainer(ctx, true);
                ctx.thumbnail.setRenderSuppressed(true);
            } else {
                this.setHeroSlotVisibility(ctx, false);
                this.animateMainFlowShift(ctx, 280, token, () => {
                    ctx.item.classList.remove('pc-hero-expanded');
                });
                this.restoreContainer(ctx, false);
                ctx.thumbnail.setRenderSuppressed(false);
            }

            requestAnimationFrame(() => {
                if (!this.isTokenActive(token)) return;
                ctx.item.classList.add('pc-content-visible');
            });

            ctx.closeButton.disabled = false;
            this.currentOpenSlug = slug;
            if (shouldUpdateUrl) {
                this.syncOpenUrlState(slug, openOrigin, historyMode);
            }
            this.setPhase('open.complete', token, { slug, hasHeroVideo: true, instant: false });
        }

        async closeProject(slug, options = {}) {
            const ctx = this.contextBySlug.get(slug);
            if (!ctx) return;
            const shouldUpdateUrl = options.updateUrl !== false;
            const historyMode = options.historyMode === 'replace' ? 'replace' : 'push';
            const isPopState = options.fromPopState === true;
            const session = this.openSession && this.openSession.slug === slug
                ? this.openSession
                : null;
            if (session?.origin === 'direct' && shouldUpdateUrl && !isPopState) {
                this.navigateToListScene();
                return;
            }

            const token = this.beginTransition();
            const prefersInstant = isReducedMotion() || options.instant === true;
            this.setPhase('close.prepare', token, { slug, prefersInstant });
            ctx.closeButton.disabled = true;
            const hadHeroVideo = ctx.item.classList.contains('pc-has-hero-video');
            const heroRect = hadHeroVideo
                ? ctx.heroSlot.getBoundingClientRect()
                : ctx.container.getBoundingClientRect();
            ctx.item.classList.add('pc-closing');
            this.pinCloseButton(ctx);

            ctx.thumbnail.setRenderSuppressed(false);
            ctx.thumbnail.setMotionFrozen(true);
            const thumbReadyPromise = prefersInstant
                ? Promise.resolve(true)
                : this.waitForCloseThumbnailReady(ctx, token);
            if (!prefersInstant) {
                ctx.container.classList.remove('thumb-hidden');
            }

            if (prefersInstant) {
                await this.setCompactionState(slug, false, token, 'close-instant-expand');
                if (!this.isTokenActive(token)) return;
                this.restoreContainer(ctx, false);
                ctx.container.classList.remove('thumb-hidden');
                this.setHeroSlotVisibility(ctx, false);
                this.destroyVideoInContext(ctx);
                ctx.heroSlot.innerHTML = '';
                ctx.details.innerHTML = '';
                ctx.details.hidden = true;
                ctx.item.classList.remove('pc-content-visible');
                ctx.item.classList.remove('pc-open');
                this.resetProjectVisualState(ctx);
                ctx.thumbnail.setCoherenceOverride(0);
                ctx.thumbnail.resetTransitionState();
                ctx.closeButton.disabled = false;
                this.currentOpenSlug = null;
                this.destroyVideosExcept(null);
                this.clearSingleProjectMode();
                if (shouldUpdateUrl) {
                    this.syncListUrlState(historyMode);
                }
                this.setPhase('close.complete', token, { slug, instant: true });
                return;
            }

            this.setPhase('close-prime-thumb', token, { slug });
            ctx.thumbnail.setCoherenceOverride(1);
            await this.animateCoherence(ctx.thumbnail, 1, 120, token);
            if (!this.isTokenActive(token)) {
                ctx.item.classList.remove('pc-closing');
                this.clearPinnedCloseButton(ctx);
                ctx.closeButton.disabled = false;
                return;
            }

            await thumbReadyPromise;
            if (!this.isTokenActive(token)) {
                ctx.item.classList.remove('pc-closing');
                this.clearPinnedCloseButton(ctx);
                ctx.closeButton.disabled = false;
                return;
            }
            this.setHeroSlotVisibility(ctx, false);
            // Unfreeze camera motion before the morph-back timeline so tilt/pan
            // can settle during the close transition rather than after it.
            ctx.thumbnail.setMotionFrozen(false);

            // Collapse stage sizing before measuring target so close animates to the true thumbnail footprint.
            const closeDuration = 420;
            this.animateMainFlowShift(ctx, closeDuration, token, () => {
                ctx.item.classList.remove('pc-hero-expanded');
            });
            await this.setCompactionState(slug, false, token, 'close-expand');
            if (!this.isTokenActive(token)) {
                ctx.item.classList.remove('pc-closing');
                this.clearPinnedCloseButton(ctx);
                ctx.closeButton.disabled = false;
                return;
            }
            const targetRect = this.measureContainerOriginRect(ctx);
            this.debugLog('close-morph-rects', {
                slug,
                heroRect: this.debugRect(heroRect),
                targetRect: this.debugRect(targetRect),
                viewport: this.readViewportMetrics(),
            });

            this.promoteContainer(ctx);
            this.setContainerRect(ctx.container, heroRect);
            ctx.container.classList.remove('thumb-hidden');
            ctx.container.style.opacity = '1';

            ctx.item.classList.remove('pc-content-visible');

            // Calculate natural coherence at target position so thumbnail ends
            // in its proper viewport-based state (no "pop" when transition ends)
            const naturalCoherence = ctx.thumbnail.calculateNaturalCoherence(targetRect);

            // Animate rect and coherence in parallel (mirroring the open transition)
            const rectPromise = this.animateRect(ctx.container, heroRect, targetRect, closeDuration, token, {
                getTargetRect: () => this.measureContainerOriginRect(ctx),
            });
            const coherencePromise = this.animateCoherence(ctx.thumbnail, naturalCoherence, closeDuration, token);
            await Promise.all([rectPromise, coherencePromise]);

            if (!this.isTokenActive(token)) {
                ctx.item.classList.remove('pc-closing');
                this.clearPinnedCloseButton(ctx);
                ctx.closeButton.disabled = false;
                return;
            }

            this.restoreContainer(ctx, false);
            this.destroyVideoInContext(ctx);
            ctx.heroSlot.innerHTML = '';
            ctx.details.innerHTML = '';
            ctx.details.hidden = true;
            ctx.item.classList.remove('pc-open');
            this.resetProjectVisualState(ctx);
            ctx.closeButton.disabled = false;
            const inactiveExplodeCoherence = -0.4;
            const inactiveExplodeBackBias = 0.75;
            const inactiveExplodeZPush = -18;
            const inactiveExplodeScatterDepthBoost = 0.65;

            // Release inactive projects from fixed positioning. Start them in a
            // scattered/transparent state and animate back to natural coherence.
            const otherThumbnails = [];
            this.contextBySlug.forEach((otherCtx, otherSlug) => {
                if (otherSlug !== slug) {
                    if (otherCtx.thumbnail) {
                        otherCtx.thumbnail.setMotionFrozen(false);
                        otherCtx.thumbnail.setCoherenceOverride(inactiveExplodeCoherence);
                        otherCtx.thumbnail.setScatterBackBiasOverride(inactiveExplodeBackBias);
                        otherCtx.thumbnail.setZPushOverride(inactiveExplodeZPush);
                        otherCtx.thumbnail.setScatterDepthBoostOverride(inactiveExplodeScatterDepthBoost);
                        otherCtx.thumbnail.setOpacityOverride(0);
                        otherThumbnails.push(otherCtx);
                    }
                }
            });

            // Keep rect sampling active through the entire inactive-thumb coherence
            // animation so override release uses up-to-date viewport positions.
            bumpTransitionRectRefresh(760);

            // Animate other thumbnails to their natural coherence and opacity.
            const otherRevealPromises = otherThumbnails.map((otherCtx) => {
                const otherRect = otherCtx.container.getBoundingClientRect();
                const otherNaturalCoherence = otherCtx.thumbnail.calculateNaturalCoherence(otherRect);
                return Promise.all([
                    this.animateCoherence(otherCtx.thumbnail, otherNaturalCoherence, 540, token, { easing: 'inOut' }),
                    this.animateOpacity(otherCtx.thumbnail, 1, 320, token, { easing: 'inOut' }),
                    this.animateScatterBackBias(otherCtx.thumbnail, 0, 540, token, { easing: 'inOut' }),
                    this.animateZPush(otherCtx.thumbnail, 0, 540, token, { easing: 'inOut' }),
                    this.animateScatterDepthBoost(otherCtx.thumbnail, 0, 540, token, { easing: 'inOut' }),
                ]);
            });

            // Clear coherence/opacity overrides for other thumbnails after animation
            // Use clearCoherenceOverrideSmoothly to sync currentCoherence with
            // the auto-calculated value first, preventing any visual shift
            Promise.all(otherRevealPromises).then(() => {
                if (!this.isTokenActive(token)) return;
                // Force a rect refresh immediately before releasing overrides so
                // coherence handoff and the next render frame read the same rect basis.
                markRectsNeedUpdate();
                refreshRenderableThumbnails();
                otherThumbnails.forEach((otherCtx) => {
                    const rect = otherCtx.thumbnail.cachedRect || otherCtx.container.getBoundingClientRect();
                    otherCtx.thumbnail.snapMotionToCurrentTargets(rect, { respectFreeze: false });
                    otherCtx.thumbnail.clearCoherenceOverrideSmoothly(rect);
                    otherCtx.thumbnail.setOpacityOverride(null);
                    otherCtx.thumbnail.setScatterBackBiasOverride(null);
                    otherCtx.thumbnail.setZPushOverride(null);
                    otherCtx.thumbnail.setScatterDepthBoostOverride(null);
                });
            });

            // Clear main thumbnail transition overrides.
            // Use smooth clearing to sync currentCoherence with auto-calculated
            // value, preventing any visual shift when override is removed.
            const finalRect = ctx.thumbnail.cachedRect || ctx.container.getBoundingClientRect();
            ctx.thumbnail.snapMotionToCurrentTargets(finalRect, { respectFreeze: false });
            ctx.thumbnail.clearCoherenceOverrideSmoothly(finalRect);
            ctx.thumbnail.setOpacityOverride(null);
            ctx.thumbnail.setScatterBackBiasOverride(null);
            ctx.thumbnail.setZPushOverride(null);
            ctx.thumbnail.setScatterDepthBoostOverride(null);

            if (!this.isTokenActive(token)) return;
            this.currentOpenSlug = null;
            this.destroyVideosExcept(null);
            this.clearSingleProjectMode({
                keepOpacityOverrides: true,
                keepScatterBackBiasOverrides: true,
                keepZPushOverrides: true,
                keepScatterDepthBoostOverrides: true,
            });
            if (shouldUpdateUrl) {
                this.syncListUrlState(historyMode);
            }
            this.setPhase('close.complete', token, { slug, instant: false });
        }

        handleCaptureClick(event) {
            const closeBtn = event.target.closest('.pc-close-project');
            if (closeBtn) {
                const item = closeBtn.closest('.pc-project[data-slug]');
                const slug = item?.dataset.slug;
                if (!slug) return;
                event.preventDefault();
                event.stopPropagation();
                this.toggleProject(slug);
                return;
            }

            const trigger = event.target.closest('.pc-project-header, .pc-thumbnail-container, .pc-stage');
            if (!trigger) return;

            const item = trigger.closest('.pc-project[data-slug]');
            const slug = item?.dataset.slug;
            if (!slug) return;

            if (slug === this.currentOpenSlug) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            this.prefetchProject(slug, item.dataset.hlsUrl || '');
            this.toggleProject(slug);
        }

        handleKeyDown(event) {
            if (event.key !== 'Escape') return;
            if (!this.currentOpenSlug || this.transitionInFlight) return;
            event.preventDefault();
            this.toggleProject(this.currentOpenSlug);
        }

        handlePrefetchIntent(event) {
            const target = event.target instanceof Element ? event.target : null;
            if (!target) return;

            const item = target.closest('.pc-project[data-slug]');
            if (!item) return;

            if (event.type === 'pointerover') {
                const from = event.relatedTarget;
                if (from instanceof Element && item.contains(from)) {
                    return;
                }
            }

            const slug = item.dataset.slug;
            if (!slug) return;
            this.prefetchProject(slug, item.dataset.hlsUrl || '');
        }

        beginTransition() {
            this.transitionToken += 1;
            this.abortPendingFetch();
            this.cancelManagedScrollTween();
            this.transitionStartTime = performance.now();
            this.phaseStartTime = this.transitionStartTime;
            this.transitionPhase = 'begin';
            this.debugLog('transition-begin', { viewport: this.readViewportMetrics() });
            return this.transitionToken;
        }

        isTokenActive(token) {
            return token === this.transitionToken;
        }

        applyDraftModeParam(url) {
            const params = new URLSearchParams(window.location.search);
            if (params.get('show_drafts') === 'true' || sessionStorage.getItem('bb_show_drafts') === 'true') {
                url.searchParams.set('show_drafts', 'true');
            }
            return url;
        }

        getProjectSlugFromURL(sourceUrl = window.location.href) {
            let parsedUrl = null;
            try {
                parsedUrl = sourceUrl instanceof URL
                    ? sourceUrl
                    : new URL(sourceUrl, window.location.origin);
            } catch {
                return '';
            }

            const querySlug = (parsedUrl.searchParams.get(this.projectQueryParam) || '').trim();
            if (querySlug) {
                return querySlug;
            }

            const rawBasePath = this.testBasePath || '/test';
            const normalizedBasePath = rawBasePath.endsWith('/')
                ? rawBasePath.slice(0, -1)
                : rawBasePath;
            if (!normalizedBasePath || parsedUrl.pathname === normalizedBasePath) {
                return '';
            }

            if (!parsedUrl.pathname.startsWith(`${normalizedBasePath}/`)) {
                return '';
            }

            const remainder = parsedUrl.pathname.slice(normalizedBasePath.length + 1);
            if (!remainder) {
                return '';
            }

            const firstSegment = remainder.split('/')[0];
            try {
                return decodeURIComponent(firstSegment).trim();
            } catch {
                return firstSegment.trim();
            }
        }

        buildProjectURL(slug) {
            return this.applyDraftModeParam(new URL(`/${slug}`, window.location.origin)).toString();
        }

        buildProjectSceneURL(slug) {
            const url = this.applyDraftModeParam(new URL(this.testBasePath || '/test', window.location.origin));
            url.searchParams.set(this.projectQueryParam, slug);
            return url.toString();
        }

        buildListURL() {
            return this.applyDraftModeParam(new URL(this.testBasePath || '/test', window.location.origin)).toString();
        }

        ensureHistoryStateFromLocation() {
            const slugFromUrl = this.getProjectSlugFromURL();
            if (slugFromUrl && this.contextBySlug.has(slugFromUrl)) {
                history.replaceState(
                    {
                        projectSlug: slugFromUrl,
                        isOpen: true,
                        origin: this.initialProjectDirectEntry ? 'direct' : 'list',
                    },
                    '',
                    this.buildProjectSceneURL(slugFromUrl)
                );
                return;
            }

            history.replaceState(
                {
                    projectSlug: null,
                    isOpen: false,
                    origin: 'list',
                },
                '',
                this.buildListURL()
            );
        }

        syncOpenUrlState(slug, origin = 'list', mode = 'push') {
            const method = mode === 'replace' ? 'replaceState' : 'pushState';
            history[method](
                {
                    projectSlug: slug,
                    isOpen: true,
                    origin: origin === 'direct' ? 'direct' : 'list',
                },
                '',
                this.buildProjectSceneURL(slug)
            );
        }

        syncListUrlState(mode = 'push') {
            const method = mode === 'replace' ? 'replaceState' : 'pushState';
            history[method](
                {
                    projectSlug: null,
                    isOpen: false,
                    origin: 'list',
                },
                '',
                this.buildListURL()
            );
        }

        navigateToListScene() {
            window.location.assign(this.buildListURL());
        }

        handlePopState(event) {
            const state = event.state || {};
            const slugFromUrl = this.getProjectSlugFromURL();
            const hasTargetProject = !!slugFromUrl && this.contextBySlug.has(slugFromUrl);
            const targetOrigin = state?.origin === 'direct' ? 'direct' : 'list';

            if (this.transitionInFlight) return;
            this.transitionInFlight = true;

            Promise.resolve()
                .then(async () => {
                    if (hasTargetProject) {
                        if (this.currentOpenSlug === slugFromUrl) {
                            return;
                        }

                        if (this.currentOpenSlug && this.currentOpenSlug !== slugFromUrl) {
                            await this.closeProject(this.currentOpenSlug, {
                                updateUrl: false,
                                fromPopState: true,
                                instant: true,
                            });
                        }

                        await this.openProject(slugFromUrl, {
                            origin: targetOrigin,
                            updateUrl: false,
                            instant: true,
                            skipScroll: targetOrigin === 'direct',
                        });
                        return;
                    }

                    if (this.currentOpenSlug) {
                        await this.closeProject(this.currentOpenSlug, {
                            updateUrl: false,
                            fromPopState: true,
                            instant: true,
                        });
                    }
                })
                .catch((err) => {
                    console.error('Failed to process /test popstate:', err);
                })
                .finally(() => {
                    this.transitionInFlight = false;
                });
        }

        openInitialProjectIfNeeded() {
            const slugFromUrl = this.getProjectSlugFromURL();
            const slug = (slugFromUrl || this.initialProjectSlug || '').trim();
            if (!slug || this.transitionInFlight) return;

            const context = this.contextBySlug.get(slug);
            if (!context) {
                console.warn(`Initial /test project slug not found: ${slug}`);
                return;
            }

            const isDirectEntry = !!slugFromUrl || this.initialProjectDirectEntry;
            this.transitionInFlight = true;
            this.openProject(slug, {
                origin: isDirectEntry ? 'direct' : 'list',
                instant: true,
                skipScroll: isDirectEntry,
                historyMode: 'replace',
            })
                .catch((err) => {
                    console.error(`Failed to initialize /test project view for ${slug}:`, err);
                })
                .finally(() => {
                    this.transitionInFlight = false;
                });
        }

        async fetchProjectDetailsHTML(slug, token) {
            if (this.detailsHtmlCache.has(slug)) {
                return this.detailsHtmlCache.get(slug);
            }

            const pendingPrefetch = this.prefetchBySlug.get(slug);
            if (pendingPrefetch) {
                try {
                    const prefetched = await pendingPrefetch;
                    if (prefetched) {
                        return prefetched;
                    }
                } catch {
                    // Fall through to direct fetch.
                }
            }

            const controller = new AbortController();
            this.fetchController = controller;
            try {
                const response = await fetch(this.buildProjectURL(slug), {
                    method: 'GET',
                    headers: {
                        'X-Requested-With': 'XMLHttpRequest',
                        'Accept': 'text/html',
                    },
                    signal: controller.signal,
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const html = await response.text();
                if (!this.isTokenActive(token)) {
                    throw new Error('Stale transition token');
                }
                this.detailsHtmlCache.set(slug, html);
                return html;
            } finally {
                if (this.fetchController === controller) {
                    this.fetchController = null;
                }
            }
        }

        abortPendingFetch() {
            if (!this.fetchController) return;
            this.fetchController.abort();
            this.fetchController = null;
        }

        prefetchProject(slug, hlsUrl) {
            if (!slug) return;

            this.ensurePreconnectForUrl(hlsUrl);
            this.warmHlsScript();
            if (hlsUrl) {
                this.warmHlsManifest(hlsUrl);
            }

            if (this.detailsHtmlCache.has(slug) || this.prefetchBySlug.has(slug)) return;

            const controller = new AbortController();
            this.prefetchAbortBySlug.set(slug, controller);
            const request = fetch(this.buildProjectURL(slug), {
                method: 'GET',
                headers: {
                    'X-Requested-With': 'XMLHttpRequest',
                    'Accept': 'text/html',
                },
                signal: controller.signal,
            })
                .then((response) => {
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                    }
                    return response.text();
                })
                .then((html) => {
                    this.detailsHtmlCache.set(slug, html);
                    return html;
                })
                .catch((err) => {
                    if (err && err.name === 'AbortError') {
                        return '';
                    }
                    console.warn(`Prefetch failed for ${slug}:`, err);
                    return '';
                })
                .finally(() => {
                    this.prefetchBySlug.delete(slug);
                    this.prefetchAbortBySlug.delete(slug);
                });

            this.prefetchBySlug.set(slug, request);
        }

        warmHlsScript() {
            if (window.Hls || this.hlsScriptPromise || this.hlsWarmupRequested) return;
            this.hlsWarmupRequested = true;
            const trigger = () => {
                if (window.Hls || this.hlsScriptPromise) return;
                this.loadHlsScript().catch(() => {});
            };

            if (document.visibilityState === 'visible') {
                window.setTimeout(trigger, 80);
            } else if (typeof window.requestIdleCallback === 'function') {
                window.requestIdleCallback(trigger, { timeout: 400 });
            } else {
                window.setTimeout(trigger, 180);
            }
        }

        warmHlsManifest(hlsUrl) {
            if (!hlsUrl || this.manifestWarmupByUrl.has(hlsUrl)) return;
            this.ensurePreconnectForUrl(hlsUrl);
            const controller = new AbortController();
            const timeoutId = window.setTimeout(() => controller.abort(), 3500);
            const request = fetch(hlsUrl, {
                method: 'GET',
                mode: 'no-cors',
                credentials: 'omit',
                signal: controller.signal,
            })
                .catch(() => {})
                .finally(() => {
                    clearTimeout(timeoutId);
                });
            this.manifestWarmupByUrl.set(hlsUrl, request);
        }

        ensurePreconnectForUrl(resourceUrl) {
            if (!resourceUrl) return;
            let origin = '';
            try {
                origin = new URL(resourceUrl, window.location.origin).origin;
            } catch {
                return;
            }
            if (!origin || this.preconnectedOrigins.has(origin)) return;
            this.preconnectedOrigins.add(origin);

            const preconnect = document.createElement('link');
            preconnect.rel = 'preconnect';
            preconnect.href = origin;
            preconnect.crossOrigin = 'anonymous';
            document.head.appendChild(preconnect);
        }

        syncStageAspectRatioFromHero(ctx) {
            const heroVideo = ctx.heroSlot.querySelector('video');
            if (!heroVideo) {
                this.restoreDefaultStageAspectRatio(ctx);
                return;
            }

            let resolvedRatio = Number.NaN;
            if (heroVideo.videoWidth > 0 && heroVideo.videoHeight > 0) {
                resolvedRatio = heroVideo.videoWidth / heroVideo.videoHeight;
            } else {
                const rawRatio = heroVideo.dataset?.videoAspectRatio;
                resolvedRatio = Number.parseFloat(rawRatio || '');
            }

            if (Number.isFinite(resolvedRatio) && resolvedRatio > 0.35 && resolvedRatio < 4.5) {
                ctx.item.style.setProperty('--pc-stage-aspect-ratio', resolvedRatio.toString());
            } else {
                this.restoreDefaultStageAspectRatio(ctx);
            }
        }

        populateProjectContent(ctx, html) {
            const temp = document.createElement('div');
            temp.innerHTML = html;

            const videoContainer = temp.querySelector('.video-container');
            const projectContent = temp.querySelector('.project-content');

            ctx.heroSlot.innerHTML = '';
            ctx.details.innerHTML = '';
            this.setHeroSlotVisibility(ctx, false);

            if (videoContainer) {
                ctx.heroSlot.appendChild(videoContainer);
            }
            if (projectContent) {
                ctx.details.appendChild(projectContent);
                ctx.details.hidden = false;
            } else {
                ctx.details.hidden = true;
            }
            return !!videoContainer;
        }

        promoteContainer(ctx) {
            if (this.promotedStates.has(ctx.slug)) return;

            const parent = ctx.container.parentElement;
            if (!parent) return;

            const nextSibling = ctx.container.nextSibling;
            const rect = ctx.container.getBoundingClientRect();

            const placeholder = document.createElement('div');
            placeholder.className = 'pc-thumb-placeholder';
            placeholder.style.width = `${rect.width}px`;
            placeholder.style.height = `${rect.height}px`;

            parent.insertBefore(placeholder, ctx.container);
            document.body.appendChild(ctx.container);
            ctx.container.classList.add('transition-overlay');

            this.promotedStates.set(ctx.slug, {
                parent,
                nextSibling,
                placeholder,
            });
            this.setContainerRect(ctx.container, rect);
            bumpTransitionRectRefresh(700);
        }

        restoreContainer(ctx, hidden) {
            const promoted = this.promotedStates.get(ctx.slug);
            if (promoted) {
                if (promoted.nextSibling && promoted.nextSibling.parentNode === promoted.parent) {
                    promoted.parent.insertBefore(ctx.container, promoted.nextSibling);
                } else {
                    promoted.parent.appendChild(ctx.container);
                }
                promoted.placeholder.remove();
                this.promotedStates.delete(ctx.slug);
            }

            ctx.container.classList.remove('transition-overlay');
            ctx.container.style.position = '';
            ctx.container.style.left = '';
            ctx.container.style.top = '';
            ctx.container.style.width = '';
            ctx.container.style.height = '';
            ctx.container.style.opacity = '';
            ctx.container.style.zIndex = '';
            ctx.container.style.transform = '';
            if (hidden) {
                ctx.container.classList.add('thumb-hidden');
            } else {
                ctx.container.classList.remove('thumb-hidden');
            }
            bumpTransitionRectRefresh(260);
        }

        stopMainFlowShift(ctx) {
            if (!ctx || !ctx.slug) return;
            const cleanup = this.mainFlowCleanupBySlug.get(ctx.slug);
            if (cleanup) {
                cleanup();
                return;
            }

            const main = ctx.item?.querySelector('.pc-project-main');
            if (!main) return;
            main.style.transition = '';
            main.style.transform = '';
            main.style.willChange = '';
        }

        animateMainFlowShift(ctx, durationMs, token, mutateLayout) {
            if (typeof mutateLayout !== 'function') return;
            const main = ctx.item.querySelector('.pc-project-main');
            if (!main) {
                mutateLayout();
                return;
            }

            this.stopMainFlowShift(ctx);

            if (durationMs <= 0 || isReducedMotion()) {
                mutateLayout();
                return;
            }

            const beforeRect = main.getBoundingClientRect();
            mutateLayout();
            const afterRect = main.getBoundingClientRect();
            const deltaY = beforeRect.top - afterRect.top;

            if (Math.abs(deltaY) < 0.5) {
                return;
            }

            main.style.transition = 'none';
            main.style.transform = `translateY(${deltaY}px)`;
            main.style.willChange = 'transform';
            main.getBoundingClientRect();

            if (!this.isTokenActive(token)) {
                main.style.transition = '';
                main.style.transform = '';
                main.style.willChange = '';
                return;
            }

            let timeoutId = null;
            let cleaned = false;
            const onTransitionEnd = (event) => {
                if (event.target !== main || event.propertyName !== 'transform') return;
                cleanup();
            };
            const cleanup = () => {
                if (cleaned) return;
                cleaned = true;
                if (timeoutId !== null) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                }
                main.removeEventListener('transitionend', onTransitionEnd);
                main.style.transition = '';
                main.style.transform = '';
                main.style.willChange = '';
                this.mainFlowCleanupBySlug.delete(ctx.slug);
            };

            this.mainFlowCleanupBySlug.set(ctx.slug, cleanup);
            main.addEventListener('transitionend', onTransitionEnd);
            timeoutId = window.setTimeout(cleanup, durationMs + 120);

            main.style.transition = `transform ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1)`;
            main.style.transform = 'translateY(0)';
        }

        pinCloseButton(ctx) {
            const button = ctx?.closeButton;
            if (!button) return;
            const rect = button.getBoundingClientRect();
            if (rect.width < 1 || rect.height < 1) return;

            button.classList.add('pc-close-pinned');
            button.style.left = `${rect.left}px`;
            button.style.top = `${rect.top}px`;
            button.style.width = `${rect.width}px`;
            button.style.height = `${rect.height}px`;
        }

        clearPinnedCloseButton(ctx) {
            const button = ctx?.closeButton;
            if (!button) return;
            button.classList.remove('pc-close-pinned');
            button.style.left = '';
            button.style.top = '';
            button.style.width = '';
            button.style.height = '';
        }

        measureContainerOriginRect(ctx) {
            const isPromoted = this.promotedStates.has(ctx.slug)
                || ctx.container.classList.contains('transition-overlay');
            if (isPromoted) {
                const promoted = this.promotedStates.get(ctx.slug);
                const placeholder = promoted?.placeholder;
                if (placeholder) {
                    const placeholderRect = placeholder.getBoundingClientRect();
                    if (placeholderRect.width > 0 && placeholderRect.height > 0) {
                        return new DOMRect(
                            placeholderRect.left,
                            placeholderRect.top,
                            placeholderRect.width,
                            placeholderRect.height
                        );
                    }
                }
                const promotedStage = ctx.item.querySelector('.pc-stage');
                if (promotedStage) {
                    const promotedStageRect = promotedStage.getBoundingClientRect();
                    if (promotedStageRect.width > 0 && promotedStageRect.height > 0) {
                        return new DOMRect(
                            promotedStageRect.left,
                            promotedStageRect.top,
                            promotedStageRect.width,
                            promotedStageRect.height
                        );
                    }
                }
            }

            const rect = ctx.container.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                return rect;
            }

            const stage = ctx.item.querySelector('.pc-stage');
            if (stage) {
                const stageRect = stage.getBoundingClientRect();
                if (stageRect.width > 0 && stageRect.height > 0) {
                    return new DOMRect(stageRect.left, stageRect.top, stageRect.width, stageRect.height);
                }
            }

            const header = ctx.item.querySelector('.pc-project-header');
            if (!header) return rect;
            const fallback = header.getBoundingClientRect();
            return new DOMRect(fallback.left, fallback.top, Math.max(1, fallback.width), Math.max(1, fallback.height));
        }

        setContainerRect(container, rect) {
            container.style.left = `${rect.left}px`;
            container.style.top = `${rect.top}px`;
            container.style.width = `${rect.width}px`;
            container.style.height = `${rect.height}px`;
            bumpTransitionRectRefresh(180);
        }

        animateRect(container, fromRect, toRect, durationMs, token, options = {}) {
            if (durationMs <= 0 || isReducedMotion()) {
                this.setContainerRect(container, toRect);
                return Promise.resolve();
            }

            const getTargetRect = () => {
                if (typeof options.getTargetRect === 'function') {
                    const next = options.getTargetRect();
                    if (next && next.width > 0 && next.height > 0) {
                        return next;
                    }
                }
                return toRect;
            };

            return new Promise((resolve) => {
                const start = performance.now();
                const step = (now) => {
                    if (!this.isTokenActive(token)) {
                        resolve();
                        return;
                    }

                    const t = Math.min(1, (now - start) / durationMs);
                    const eased = 1 - Math.pow(1 - t, 3);
                    const targetRect = getTargetRect();
                    const interpolated = new DOMRect(
                        fromRect.left + (targetRect.left - fromRect.left) * eased,
                        fromRect.top + (targetRect.top - fromRect.top) * eased,
                        fromRect.width + (targetRect.width - fromRect.width) * eased,
                        fromRect.height + (targetRect.height - fromRect.height) * eased
                    );
                    this.setContainerRect(container, interpolated);

                    if (t < 1) {
                        requestAnimationFrame(step);
                    } else {
                        resolve();
                    }
                };
                requestAnimationFrame(step);
            });
        }

        animateCoherence(thumbnail, targetValue, durationMs, token, options = {}) {
            if (durationMs <= 0 || isReducedMotion()) {
                thumbnail.setCoherenceOverride(targetValue);
                thumbnail.currentCoherence = targetValue;
                return Promise.resolve();
            }

            const easing = options.easing || 'out';
            const easeValue = (t) => {
                if (easing === 'in') {
                    return t * t * t;
                }
                if (easing === 'inOut') {
                    return t < 0.5
                        ? 4 * t * t * t
                        : 1 - Math.pow(-2 * t + 2, 3) / 2;
                }
                return 1 - Math.pow(1 - t, 3);
            };
            const startValue = thumbnail.coherenceOverride !== null ? thumbnail.coherenceOverride : thumbnail.currentCoherence;
            return new Promise((resolve) => {
                const start = performance.now();
                const step = (now) => {
                    if (!this.isTokenActive(token)) {
                        resolve();
                        return;
                    }
                    const t = Math.min(1, (now - start) / durationMs);
                    const eased = easeValue(t);
                    const value = startValue + (targetValue - startValue) * eased;
                    thumbnail.setCoherenceOverride(value);
                    thumbnail.currentCoherence = value;
                    if (t < 1) {
                        requestAnimationFrame(step);
                    } else {
                        thumbnail.setCoherenceOverride(targetValue);
                        thumbnail.currentCoherence = targetValue;
                        resolve();
                    }
                };
                requestAnimationFrame(step);
            });
        }

        animateOpacity(thumbnail, targetValue, durationMs, token, options = {}) {
            if (durationMs <= 0 || isReducedMotion()) {
                thumbnail.setOpacityOverride(targetValue);
                thumbnail.currentOpacityMultiplier = targetValue;
                return Promise.resolve();
            }

            const easing = options.easing || 'out';
            const easeValue = (t) => {
                if (easing === 'in') {
                    return t * t * t;
                }
                if (easing === 'inOut') {
                    return t < 0.5
                        ? 4 * t * t * t
                        : 1 - Math.pow(-2 * t + 2, 3) / 2;
                }
                return 1 - Math.pow(1 - t, 3);
            };
            const startValue = thumbnail.opacityOverride !== null
                ? thumbnail.opacityOverride
                : thumbnail.currentOpacityMultiplier;
            return new Promise((resolve) => {
                const start = performance.now();
                const step = (now) => {
                    if (!this.isTokenActive(token)) {
                        resolve();
                        return;
                    }
                    const t = Math.min(1, (now - start) / durationMs);
                    const eased = easeValue(t);
                    const value = startValue + (targetValue - startValue) * eased;
                    thumbnail.setOpacityOverride(value);
                    thumbnail.currentOpacityMultiplier = value;
                    if (t < 1) {
                        requestAnimationFrame(step);
                    } else {
                        thumbnail.setOpacityOverride(targetValue);
                        thumbnail.currentOpacityMultiplier = targetValue;
                        resolve();
                    }
                };
                requestAnimationFrame(step);
            });
        }

        animateScatterBackBias(thumbnail, targetValue, durationMs, token, options = {}) {
            if (durationMs <= 0 || isReducedMotion()) {
                thumbnail.setScatterBackBiasOverride(targetValue);
                thumbnail.currentScatterBackBias = targetValue;
                return Promise.resolve();
            }

            const easing = options.easing || 'out';
            const easeValue = (t) => {
                if (easing === 'in') {
                    return t * t * t;
                }
                if (easing === 'inOut') {
                    return t < 0.5
                        ? 4 * t * t * t
                        : 1 - Math.pow(-2 * t + 2, 3) / 2;
                }
                return 1 - Math.pow(1 - t, 3);
            };
            const startValue = thumbnail.scatterBackBiasOverride !== null
                ? thumbnail.scatterBackBiasOverride
                : thumbnail.currentScatterBackBias;
            return new Promise((resolve) => {
                const start = performance.now();
                const step = (now) => {
                    if (!this.isTokenActive(token)) {
                        resolve();
                        return;
                    }
                    const t = Math.min(1, (now - start) / durationMs);
                    const eased = easeValue(t);
                    const value = startValue + (targetValue - startValue) * eased;
                    thumbnail.setScatterBackBiasOverride(value);
                    thumbnail.currentScatterBackBias = value;
                    if (t < 1) {
                        requestAnimationFrame(step);
                    } else {
                        thumbnail.setScatterBackBiasOverride(targetValue);
                        thumbnail.currentScatterBackBias = targetValue;
                        resolve();
                    }
                };
                requestAnimationFrame(step);
            });
        }

        animateZPush(thumbnail, targetValue, durationMs, token, options = {}) {
            if (durationMs <= 0 || isReducedMotion()) {
                thumbnail.setZPushOverride(targetValue);
                thumbnail.currentZPush = targetValue;
                return Promise.resolve();
            }

            const easing = options.easing || 'out';
            const easeValue = (t) => {
                if (easing === 'in') {
                    return t * t * t;
                }
                if (easing === 'inOut') {
                    return t < 0.5
                        ? 4 * t * t * t
                        : 1 - Math.pow(-2 * t + 2, 3) / 2;
                }
                return 1 - Math.pow(1 - t, 3);
            };
            const startValue = thumbnail.zPushOverride !== null
                ? thumbnail.zPushOverride
                : thumbnail.currentZPush;
            return new Promise((resolve) => {
                const start = performance.now();
                const step = (now) => {
                    if (!this.isTokenActive(token)) {
                        resolve();
                        return;
                    }
                    const t = Math.min(1, (now - start) / durationMs);
                    const eased = easeValue(t);
                    const value = startValue + (targetValue - startValue) * eased;
                    thumbnail.setZPushOverride(value);
                    thumbnail.currentZPush = value;
                    if (t < 1) {
                        requestAnimationFrame(step);
                    } else {
                        thumbnail.setZPushOverride(targetValue);
                        thumbnail.currentZPush = targetValue;
                        resolve();
                    }
                };
                requestAnimationFrame(step);
            });
        }

        animateScatterDepthBoost(thumbnail, targetValue, durationMs, token, options = {}) {
            if (durationMs <= 0 || isReducedMotion()) {
                thumbnail.setScatterDepthBoostOverride(targetValue);
                thumbnail.currentScatterDepthBoost = targetValue;
                return Promise.resolve();
            }

            const easing = options.easing || 'out';
            const easeValue = (t) => {
                if (easing === 'in') {
                    return t * t * t;
                }
                if (easing === 'inOut') {
                    return t < 0.5
                        ? 4 * t * t * t
                        : 1 - Math.pow(-2 * t + 2, 3) / 2;
                }
                return 1 - Math.pow(1 - t, 3);
            };
            const startValue = thumbnail.scatterDepthBoostOverride !== null
                ? thumbnail.scatterDepthBoostOverride
                : thumbnail.currentScatterDepthBoost;
            return new Promise((resolve) => {
                const start = performance.now();
                const step = (now) => {
                    if (!this.isTokenActive(token)) {
                        resolve();
                        return;
                    }
                    const t = Math.min(1, (now - start) / durationMs);
                    const eased = easeValue(t);
                    const value = startValue + (targetValue - startValue) * eased;
                    thumbnail.setScatterDepthBoostOverride(value);
                    thumbnail.currentScatterDepthBoost = value;
                    if (t < 1) {
                        requestAnimationFrame(step);
                    } else {
                        thumbnail.setScatterDepthBoostOverride(targetValue);
                        thumbnail.currentScatterDepthBoost = targetValue;
                        resolve();
                    }
                };
                requestAnimationFrame(step);
            });
        }

        async prepareHeroVideoReady(video, ctx, token) {
            if (!video) return false;

            video.muted = true;
            video.playsInline = true;
            video.preload = 'auto';
            video.setAttribute('playsinline', '');
            video.setAttribute('muted', '');

            try {
                this.syncStageAspectRatioFromHero(ctx);
                await this.setupHeroVideo(video, true, token);
                if (!this.isTokenActive(token)) return false;
                await this.waitForFirstVideoFrame(video, token, 7000);
                if (!this.isTokenActive(token)) return false;
                this.syncStageAspectRatioFromHero(ctx);
                return true;
            } catch (err) {
                if (this.isTokenActive(token)) {
                    console.warn('Hero video was not ready before reveal window:', err);
                }
                return false;
            }
        }

        async setupHeroVideo(video, autoplay, token) {
            if (!this.isTokenActive(token)) {
                throw new Error('Transition cancelled');
            }
            const streamUrl = video.dataset.hlsUrl;
            if (!streamUrl) return;

            const canPlayNative = !!video.canPlayType('application/vnd.apple.mpegurl');
            const startPlayback = async () => {
                if (!autoplay || !this.isTokenActive(token)) return;
                try {
                    await video.play();
                } catch {
                    // Ignore autoplay failures (browser policy/network races).
                }
            };

            const attachNative = async () => {
                if (!this.isTokenActive(token)) {
                    throw new Error('Transition cancelled');
                }
                video.src = streamUrl;
                await startPlayback();
            };

            const attachHlsJs = async () => {
                if (!this.isTokenActive(token)) {
                    throw new Error('Transition cancelled');
                }
                if (!window.Hls || !Hls.isSupported()) {
                    throw new Error('HLS.js is not supported in this browser');
                }

                if (video.hlsInstance) {
                    video.hlsInstance.destroy();
                    video.hlsInstance = null;
                }

                await new Promise((resolve, reject) => {
                    if (!this.isTokenActive(token)) {
                        reject(new Error('Transition cancelled'));
                        return;
                    }
                    const hls = new Hls({
                        abrEwmaDefaultEstimate: 5000000,
                        capLevelToPlayerSize: true,
                    });

                    video.hlsInstance = hls;
                    hls.loadSource(streamUrl);
                    hls.attachMedia(video);
                    hls.on(Hls.Events.MEDIA_ATTACHED, () => {
                        startPlayback();
                    });
                    hls.on(Hls.Events.MANIFEST_PARSED, () => {
                        if (!this.isTokenActive(token)) {
                            if (video.hlsInstance) {
                                video.hlsInstance.destroy();
                                video.hlsInstance = null;
                            }
                            reject(new Error('Transition cancelled'));
                            return;
                        }
                        resolve();
                    });
                    hls.on(Hls.Events.ERROR, (_event, data) => {
                        if (data?.fatal) {
                            reject(new Error(data.details || 'Fatal HLS.js error'));
                        }
                    });
                });

                if (!this.isTokenActive(token)) {
                    if (video.hlsInstance) {
                        video.hlsInstance.destroy();
                        video.hlsInstance = null;
                    }
                    throw new Error('Transition cancelled');
                }

                await startPlayback();
            };

            if (window.Hls && Hls.isSupported()) {
                await attachHlsJs();
                return;
            }

            try {
                await this.loadHlsScript();
                if (!this.isTokenActive(token)) {
                    throw new Error('Transition cancelled');
                }
                if (window.Hls && Hls.isSupported()) {
                    await attachHlsJs();
                    return;
                }
            } catch (err) {
                console.warn('Failed to load HLS.js for /test transition:', err);
            }

            if (canPlayNative) {
                await attachNative();
                return;
            }

            throw new Error('No supported HLS playback path for hero video');
        }

        loadHlsScript() {
            if (window.Hls) {
                return Promise.resolve();
            }
            if (this.hlsScriptPromise) {
                return this.hlsScriptPromise;
            }

            const src = document.body.dataset.hlsJsSrc || 'https://cdn.jsdelivr.net/npm/hls.js@1.5.12';
            this.hlsScriptPromise = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = src;
                script.async = true;
                script.onload = () => resolve();
                script.onerror = () => reject(new Error('Failed to load HLS.js'));
                document.head.appendChild(script);
            });
            return this.hlsScriptPromise;
        }

        waitForFirstVideoFrame(video, token, timeoutMs = 7000) {
            return new Promise((resolve, reject) => {
                let done = false;
                let frameCallbackId = null;
                let tokenWatcherId = null;

                const finish = (ok, error) => {
                    if (done) return;
                    done = true;
                    clearTimeout(timeoutId);
                    if (tokenWatcherId !== null) {
                        clearInterval(tokenWatcherId);
                    }
                    video.removeEventListener('loadeddata', onMaybeReady);
                    video.removeEventListener('canplay', onMaybeReady);
                    video.removeEventListener('playing', onMaybeReady);
                    video.removeEventListener('timeupdate', onMaybeReady);
                    video.removeEventListener('error', onError);
                    if (frameCallbackId !== null && typeof video.cancelVideoFrameCallback === 'function') {
                        video.cancelVideoFrameCallback(frameCallbackId);
                    }
                    if (ok) {
                        resolve();
                    } else {
                        reject(error || new Error('Video did not render a first frame in time'));
                    }
                };

                const onMaybeReady = () => {
                    if (!this.isTokenActive(token)) {
                        finish(false, new Error('Transition cancelled'));
                        return;
                    }
                    if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
                        finish(true);
                    }
                };

                const onError = () => {
                    finish(false, new Error('Video error before first frame'));
                };

                const timeoutId = window.setTimeout(() => {
                    finish(false, new Error('Timed out waiting for first video frame'));
                }, timeoutMs);

                tokenWatcherId = window.setInterval(() => {
                    if (!this.isTokenActive(token)) {
                        finish(false, new Error('Transition cancelled'));
                    }
                }, 80);

                video.addEventListener('loadeddata', onMaybeReady);
                video.addEventListener('canplay', onMaybeReady);
                video.addEventListener('playing', onMaybeReady);
                video.addEventListener('timeupdate', onMaybeReady);
                video.addEventListener('error', onError, { once: true });

                if (typeof video.requestVideoFrameCallback === 'function') {
                    frameCallbackId = video.requestVideoFrameCallback(() => {
                        if (!this.isTokenActive(token)) {
                            finish(false, new Error('Transition cancelled'));
                            return;
                        }
                        finish(true);
                    });
                }

                onMaybeReady();
            });
        }

        destroyVideoInContext(ctx) {
            const video = ctx.heroSlot.querySelector('video');
            if (!video) return;

            if (video.hlsInstance) {
                video.hlsInstance.destroy();
                video.hlsInstance = null;
            }

            video.pause();
            if (video.src && video.src.startsWith('blob:')) {
                URL.revokeObjectURL(video.src);
            }
            video.removeAttribute('src');
            video.load();
        }
    }


        return { ProjectTransitionManager };
    }

    window.TestPageTransitionManagerModule = Object.freeze({ create });
})();

// Clean-slate /test-2 transition manager.
// State machine:
// 1) idle:list
// 2) opening:measure -> opening:animate -> open:detail
// 3) closing:measure -> closing:animate -> idle:list
// 4) switching uses close + open under a new token
//
// Boundary commits:
// - open commit: detail scene marked open, URL/state finalized
// - close commit: list scene restored, URL/state finalized
// Any stale token auto-cancels and cannot commit.
(function() {
    'use strict';

    const QUERY_DEBUG_KEY = 't2debug';
    const QUERY_PROJECT_KEY = 'project';
    const QUERY_KEEP_KEYS = ['show_drafts', QUERY_DEBUG_KEY];
    const HLS_JS_URL = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.12';
    const OPEN_DURATION_MS = 340;
    const CLOSE_DURATION_MS = 300;
    const EASING_STANDARD = 'cubic-bezier(0.2, 0.0, 0, 1)';

    function nowMs() {
        return performance.now();
    }

    function waitForAnimationFinish(animation) {
        if (!animation) return Promise.resolve();
        return animation.finished.catch(() => {});
    }

    function parseRect(rect) {
        if (!rect) return null;
        return {
            left: Math.round(rect.left * 100) / 100,
            top: Math.round(rect.top * 100) / 100,
            width: Math.round(rect.width * 100) / 100,
            height: Math.round(rect.height * 100) / 100,
            right: Math.round(rect.right * 100) / 100,
            bottom: Math.round(rect.bottom * 100) / 100,
        };
    }

    function shouldUseReducedMotion() {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function readPositiveNumber(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }

    function buildDebugStore() {
        const params = new URLSearchParams(window.location.search);
        let enabled = params.get(QUERY_DEBUG_KEY) === '1' || window.localStorage.getItem('t2debug') === '1';
        const logs = [];
        const sessions = new Map();

        function write(entry) {
            logs.push(entry);
            if (!enabled) return;
            console.log('[test-2]', entry);
        }

        function start(token, action, slug, meta = {}) {
            const session = {
                token,
                action,
                slug,
                startedAt: nowMs(),
                marks: [],
                meta,
            };
            sessions.set(token, session);
            write({ type: 'start', token, action, slug, meta });
        }

        function mark(token, phase, payload = {}) {
            const session = sessions.get(token);
            const at = nowMs();
            if (session) {
                session.marks.push({
                    phase,
                    at,
                    deltaMs: Math.round((at - session.startedAt) * 100) / 100,
                    payload,
                });
            }
            write({ type: 'phase', token, phase, payload });
        }

        function finish(token, result, payload = {}) {
            const at = nowMs();
            const session = sessions.get(token);
            const durationMs = session ? Math.round((at - session.startedAt) * 100) / 100 : null;
            const entry = { type: result, token, durationMs, payload, session };
            write(entry);
            sessions.delete(token);
        }

        function setEnabled(value) {
            enabled = !!value;
            if (enabled) {
                window.localStorage.setItem('t2debug', '1');
            } else {
                window.localStorage.removeItem('t2debug');
            }
            write({ type: 'debug-enabled', enabled });
        }

        function clear() {
            logs.length = 0;
            sessions.clear();
        }

        window.Test2TransitionDebug = {
            get enabled() {
                return enabled;
            },
            enable() {
                setEnabled(true);
            },
            disable() {
                setEnabled(false);
            },
            clear,
            dump() {
                return logs.slice();
            },
        };

        return { start, mark, finish };
    }

    class Test2TransitionManager {
        constructor(options) {
            this.listScene = options.listScene;
            this.detailScene = options.detailScene;
            this.detailTitle = options.detailTitle;
            this.detailHeroFrame = options.detailHeroFrame;
            this.detailHeroMedia = options.detailHeroMedia;
            this.detailContent = options.detailContent;
            this.transitionLayer = options.transitionLayer;
            this.basePath = options.basePath || '/test-2';
            this.initialSlug = options.initialSlug || '';
            this.initialDirectEntry = !!options.initialDirectEntry;

            this.cardsBySlug = new Map();
            this.detailsHtmlCache = new Map();

            this.openSlug = null;
            this.lastFocusedBeforeOpen = null;
            this.state = 'idle:list';
            this.transitionToken = 0;
            this.activeTransitionToken = null;
            this.activeAnimations = [];
            this.activeFetchController = null;
            this.activeHls = null;
            this.hlsScriptPromise = null;
            this.isDestroying = false;
            this.isHandlingPopState = false;
            this.spriteRuntime = null;

            this.debug = buildDebugStore();

            this.boundOnClick = this.onClick.bind(this);
            this.boundOnKeyDown = this.onKeyDown.bind(this);
            this.boundOnPopState = this.onPopState.bind(this);
        }

        init() {
            this.initSpriteRuntime();
            this.rebuildCardMap();
            document.addEventListener('click', this.boundOnClick, true);
            document.addEventListener('keydown', this.boundOnKeyDown);
            window.addEventListener('popstate', this.boundOnPopState);
            this.ensureHistoryStateFromLocation();
            this.bootstrapInitialState();
        }

        destroy() {
            this.isDestroying = true;
            document.removeEventListener('click', this.boundOnClick, true);
            document.removeEventListener('keydown', this.boundOnKeyDown);
            window.removeEventListener('popstate', this.boundOnPopState);
            this.cancelInFlight('destroy');
            this.resetDetailContent();
            this.clearTransitionLayer();
            this.applyListSceneState({ activeSlug: null, dimmed: false });
            this.applyDetailSceneVisibility(false);
            this.setNavHidden(false);
            this.detailScene.setAttribute('aria-hidden', 'true');
            this.detailScene.setAttribute('data-scene-state', 'closed');
            if (this.spriteRuntime && typeof this.spriteRuntime.destroy === 'function') {
                this.spriteRuntime.destroy();
            }
            this.spriteRuntime = null;
        }

        initSpriteRuntime() {
            if (!window.Test2SpriteRuntime || typeof window.Test2SpriteRuntime.create !== 'function') {
                return;
            }
            this.spriteRuntime = window.Test2SpriteRuntime.create({
                listScene: this.listScene,
            });
            this.spriteRuntime.init();
        }

        rebuildCardMap() {
            this.cardsBySlug.clear();
            const cards = this.listScene.querySelectorAll('[data-project-card]');
            cards.forEach((cardEl) => {
                const slug = cardEl.dataset.slug;
                if (!slug) return;
                const openButton = cardEl.querySelector('[data-open-project]');
                const thumbFrame = cardEl.querySelector('[data-thumb-frame]');
                if (!openButton || !thumbFrame) return;
                const thumbImg = thumbFrame.querySelector('img');
                const spriteAspectRatio = readPositiveNumber(cardEl.dataset.spriteAspectRatio);
                const heroAspectRatio = readPositiveNumber(cardEl.dataset.heroAspectRatio) || spriteAspectRatio;

                this.cardsBySlug.set(slug, {
                    slug,
                    cardEl,
                    openButton,
                    thumbFrame,
                    thumbImg,
                    title: (cardEl.dataset.title || slug).trim(),
                    formattedDate: (cardEl.dataset.formattedDate || '').trim(),
                    thumbnail: (cardEl.dataset.thumbnail || '').trim(),
                    hlsUrl: (cardEl.dataset.hlsUrl || '').trim(),
                    spriteAspectRatio,
                    heroAspectRatio,
                    spriteController: this.spriteRuntime ? this.spriteRuntime.getThumbnail(slug) : null,
                });
            });
        }

        onClick(event) {
            const openTrigger = event.target.closest('[data-open-project]');
            if (openTrigger) {
                const slug = openTrigger.getAttribute('data-open-project');
                if (!slug) return;
                event.preventDefault();
                this.openProject(slug, {
                    reason: 'user-open',
                    pushHistory: true,
                    source: 'list',
                });
                return;
            }

            const closeTrigger = event.target.closest('[data-close-detail]');
            if (closeTrigger && this.openSlug) {
                event.preventDefault();
                this.closeProject({
                    reason: 'user-close',
                    pushHistory: true,
                });
                return;
            }
        }

        onKeyDown(event) {
            if (event.key !== 'Escape') return;
            if (!this.openSlug) return;
            event.preventDefault();
            this.closeProject({
                reason: 'escape',
                pushHistory: true,
            });
        }

        onPopState() {
            this.isHandlingPopState = true;
            const targetSlug = this.extractSlugFromLocation();
            if (!targetSlug) {
                this.closeProject({
                    reason: 'popstate-close',
                    pushHistory: false,
                    preferInstant: false,
                }).finally(() => {
                    this.isHandlingPopState = false;
                });
                return;
            }
            this.openProject(targetSlug, {
                reason: 'popstate-open',
                pushHistory: false,
                source: 'history',
                preferInstant: false,
            }).finally(() => {
                this.isHandlingPopState = false;
            });
        }

        bootstrapInitialState() {
            const urlSlug = this.extractSlugFromLocation();
            const initialSlug = urlSlug || this.initialSlug;
            if (!initialSlug) return;
            this.openProject(initialSlug, {
                reason: this.initialDirectEntry ? 'direct-entry' : 'initial',
                pushHistory: false,
                preferInstant: true,
                source: 'initial',
            });
        }

        ensureHistoryStateFromLocation() {
            const slug = this.extractSlugFromLocation();
            const currentState = window.history.state;
            if (currentState && currentState.test2 === true && currentState.slug === slug) return;
            window.history.replaceState({ test2: true, slug }, '', window.location.href);
        }

        extractSlugFromLocation() {
            const currentUrl = new URL(window.location.href);
            const basePath = this.basePath.replace(/\/+$/, '');
            const pathname = currentUrl.pathname.replace(/\/+$/, '');
            if (pathname.startsWith(`${basePath}/`)) {
                const slug = decodeURIComponent(pathname.slice(basePath.length + 1)).trim();
                return slug || null;
            }
            const querySlug = currentUrl.searchParams.get(QUERY_PROJECT_KEY);
            if (querySlug && querySlug.trim()) return querySlug.trim();
            return null;
        }

        buildUrlForSlug(slug) {
            const base = new URL(`${this.basePath}`, window.location.origin);
            const current = new URL(window.location.href);
            QUERY_KEEP_KEYS.forEach((key) => {
                const value = current.searchParams.get(key);
                if (value != null && value !== '') base.searchParams.set(key, value);
            });
            if (slug) {
                base.pathname = `${this.basePath}/${encodeURIComponent(slug)}`;
            }
            return base.toString();
        }

        pushHistoryState(slug) {
            const nextUrl = this.buildUrlForSlug(slug);
            const currentHref = window.location.href;
            if (currentHref === nextUrl) return;
            window.history.pushState({ test2: true, slug: slug || null }, '', nextUrl);
        }

        replaceHistoryState(slug) {
            const nextUrl = this.buildUrlForSlug(slug);
            window.history.replaceState({ test2: true, slug: slug || null }, '', nextUrl);
        }

        cancelInFlight(reason) {
            this.cancelRunningAnimations();
            this.abortActiveFetch();
            this.clearTransitionLayer();
            if (this.activeTransitionToken !== null) {
                this.debug.finish(this.activeTransitionToken, 'cancel', { reason });
                this.activeTransitionToken = null;
            }
        }

        beginTransition(action, slug, reason) {
            this.cancelInFlight(`superseded:${action}`);
            this.transitionToken += 1;
            const token = this.transitionToken;
            this.activeTransitionToken = token;
            this.debug.start(token, action, slug, { reason });
            return token;
        }

        isTokenActive(token) {
            return token === this.transitionToken && !this.isDestroying;
        }

        abortActiveFetch() {
            if (!this.activeFetchController) return;
            this.activeFetchController.abort();
            this.activeFetchController = null;
        }

        cancelRunningAnimations() {
            this.activeAnimations.forEach((animation) => animation.cancel());
            this.activeAnimations = [];
        }

        trackAnimation(animation) {
            this.activeAnimations.push(animation);
            return animation;
        }

        applyListSceneState({ activeSlug, dimmed }) {
            this.listScene.classList.toggle('t2-list-dimmed', !!dimmed);
            this.cardsBySlug.forEach((card, slug) => {
                card.cardEl.classList.toggle('t2-active-card', slug === activeSlug);
            });
        }

        applyDetailSceneVisibility(visible) {
            this.detailScene.classList.toggle('t2-visible', !!visible);
            this.detailScene.setAttribute('aria-hidden', visible ? 'false' : 'true');
            if ('inert' in this.listScene) {
                this.listScene.inert = !!visible;
            }
        }

        setNavHidden(hidden) {
            document.body.classList.toggle('t2-nav-hidden', !!hidden);
        }

        markSourceVisibility(card, hidden) {
            card.thumbFrame.classList.toggle('t2-source-hidden', !!hidden);
        }

        markTargetVisibility(hidden) {
            this.detailHeroFrame.classList.toggle('t2-target-hidden', !!hidden);
        }

        clearTransitionLayer() {
            this.transitionLayer.classList.remove('t2-active');
            this.transitionLayer.style.left = '0px';
            this.transitionLayer.style.top = '0px';
            this.transitionLayer.style.width = '0px';
            this.transitionLayer.style.height = '0px';
            this.transitionLayer.style.transform = 'none';
            this.transitionLayer.style.opacity = '0';
            this.transitionLayer.innerHTML = '';
        }

        resetDetailContent() {
            this.teardownHeroVideo();
            this.detailHeroMedia.innerHTML = '';
            this.detailContent.innerHTML = '';
            this.detailTitle.textContent = '';
            this.detailHeroFrame.style.setProperty('--t2-fallback-poster', 'none');
            this.detailHeroFrame.style.setProperty('--t2-hero-aspect', (16 / 9).toString());
        }

        setHeroAspectRatio(card) {
            const aspectRatio = card?.heroAspectRatio || card?.spriteAspectRatio || (16 / 9);
            this.detailHeroFrame.style.setProperty('--t2-hero-aspect', aspectRatio.toString());
        }

        createCardPreviewNode(card, options = {}) {
            const className = options.className || '';
            const frameIndex = Number.isFinite(options.frameIndex) ? options.frameIndex : 0;
            if (card.spriteController && typeof card.spriteController.createFrameNode === 'function') {
                return card.spriteController.createFrameNode(frameIndex, {
                    className,
                    width: options.width,
                    height: options.height,
                });
            }

            const thumbSrc = card.thumbnail || card.thumbImg?.currentSrc || card.thumbImg?.src || '';
            if (!thumbSrc) {
                const fallback = document.createElement('div');
                fallback.className = className;
                fallback.style.background = '#141414';
                return fallback;
            }

            const image = document.createElement('img');
            image.className = className;
            image.src = thumbSrc;
            image.alt = '';
            image.decoding = 'sync';
            image.loading = 'eager';
            return image;
        }

        createTransitionNode(card, mode, sourceRect) {
            const wrapper = document.createElement('div');
            wrapper.className = 't2-transition-visual';
            const previewWidth = Math.max(1, Math.round(sourceRect?.width || card.thumbFrame?.clientWidth || 1));
            const previewHeight = Math.max(1, Math.round(sourceRect?.height || card.thumbFrame?.clientHeight || 1));

            const currentFrameIndex = card.spriteController && typeof card.spriteController.getCurrentFrameIndex === 'function'
                ? card.spriteController.getCurrentFrameIndex()
                : 0;
            const openMode = mode !== 'close';
            const sourceFrameIndex = openMode ? currentFrameIndex : 0;
            const targetFrameIndex = openMode ? 0 : currentFrameIndex;

            const sourceNode = this.createCardPreviewNode(card, {
                frameIndex: sourceFrameIndex,
                className: 't2-transition-media-layer t2-transition-source',
                width: previewWidth,
                height: previewHeight,
            });
            const targetNode = this.createCardPreviewNode(card, {
                frameIndex: targetFrameIndex,
                className: 't2-transition-media-layer t2-transition-target',
                width: previewWidth,
                height: previewHeight,
            });

            wrapper.appendChild(sourceNode);
            wrapper.appendChild(targetNode);
            return wrapper;
        }

        mountTransitionLayer(node, rect) {
            this.transitionLayer.innerHTML = '';
            this.transitionLayer.appendChild(node);
            this.transitionLayer.style.left = `${rect.left}px`;
            this.transitionLayer.style.top = `${rect.top}px`;
            this.transitionLayer.style.width = `${rect.width}px`;
            this.transitionLayer.style.height = `${rect.height}px`;
            this.transitionLayer.style.transform = 'translate3d(0px, 0px, 0px) scale(1, 1)';
            this.transitionLayer.style.opacity = '1';
            this.transitionLayer.classList.add('t2-active');
        }

        buildMorphKeyframes(sourceRect, targetRect) {
            const scaleX = sourceRect.width > 0 ? targetRect.width / sourceRect.width : 1;
            const scaleY = sourceRect.height > 0 ? targetRect.height / sourceRect.height : 1;
            const translateX = targetRect.left - sourceRect.left;
            const translateY = targetRect.top - sourceRect.top;
            return [
                {
                    transform: 'translate3d(0px, 0px, 0px) scale(1, 1)',
                    opacity: 1,
                },
                {
                    transform: `translate3d(${translateX}px, ${translateY}px, 0px) scale(${scaleX}, ${scaleY})`,
                    opacity: 1,
                },
            ];
        }

        async runMorphAnimation({ sourceRect, targetRect, durationMs, token, mode }) {
            if (!this.isTokenActive(token)) return;
            const keyframes = this.buildMorphKeyframes(sourceRect, targetRect);
            const animations = [];
            const layerAnimation = this.trackAnimation(
                this.transitionLayer.animate(keyframes, {
                    duration: durationMs,
                    easing: EASING_STANDARD,
                    fill: 'forwards',
                })
            );
            animations.push(layerAnimation);

            const sourceNode = this.transitionLayer.querySelector('.t2-transition-source');
            const targetNode = this.transitionLayer.querySelector('.t2-transition-target');
            if (sourceNode && targetNode) {
                const sourceFrames = mode === 'close'
                    ? [
                        { opacity: 1, transform: 'scale(1)' },
                        { opacity: 1, transform: 'scale(1)', offset: 0.55 },
                        { opacity: 0, transform: 'scale(0.985)' },
                    ]
                    : [
                        { opacity: 1, transform: 'scale(1)' },
                        { opacity: 1, transform: 'scale(1)', offset: 0.4 },
                        { opacity: 0, transform: 'scale(0.982)' },
                    ];
                const targetFrames = mode === 'close'
                    ? [
                        { opacity: 0, transform: 'scale(1.02)' },
                        { opacity: 0.05, transform: 'scale(1.012)', offset: 0.3 },
                        { opacity: 1, transform: 'scale(1)' },
                    ]
                    : [
                        { opacity: 0, transform: 'scale(1.03)' },
                        { opacity: 0.08, transform: 'scale(1.016)', offset: 0.32 },
                        { opacity: 1, transform: 'scale(1)' },
                    ];

                animations.push(
                    this.trackAnimation(sourceNode.animate(sourceFrames, {
                        duration: durationMs,
                        easing: 'linear',
                        fill: 'forwards',
                    }))
                );
                animations.push(
                    this.trackAnimation(targetNode.animate(targetFrames, {
                        duration: durationMs,
                        easing: 'linear',
                        fill: 'forwards',
                    }))
                );
            }

            await Promise.all(animations.map((animation) => waitForAnimationFinish(animation)));
            this.activeAnimations = [];
        }

        measureOpenSnapshot(slug) {
            const card = this.cardsBySlug.get(slug);
            if (!card) return null;
            const sourceRect = card.thumbFrame.getBoundingClientRect();
            const targetRect = this.detailHeroFrame.getBoundingClientRect();
            if (sourceRect.width < 1 || sourceRect.height < 1 || targetRect.width < 1 || targetRect.height < 1) {
                return null;
            }
            return {
                card,
                sourceRect,
                targetRect,
                metrics: {
                    scrollY: window.scrollY || window.pageYOffset || 0,
                    viewportWidth: window.innerWidth,
                    viewportHeight: window.innerHeight,
                    visualViewportHeight: window.visualViewport ? window.visualViewport.height : null,
                    dpr: window.devicePixelRatio || 1,
                },
            };
        }

        measureCloseSnapshot(slug) {
            const card = this.cardsBySlug.get(slug);
            if (!card) return null;
            const targetRect = card.thumbFrame.getBoundingClientRect();
            const sourceRect = this.detailHeroFrame.getBoundingClientRect();
            if (sourceRect.width < 1 || sourceRect.height < 1 || targetRect.width < 1 || targetRect.height < 1) {
                return null;
            }
            return {
                card,
                sourceRect,
                targetRect,
                metrics: {
                    scrollY: window.scrollY || window.pageYOffset || 0,
                    viewportWidth: window.innerWidth,
                    viewportHeight: window.innerHeight,
                    visualViewportHeight: window.visualViewport ? window.visualViewport.height : null,
                    dpr: window.devicePixelRatio || 1,
                },
            };
        }

        async fetchDetailsHtml(slug, token) {
            if (this.detailsHtmlCache.has(slug)) return this.detailsHtmlCache.get(slug);
            this.abortActiveFetch();

            const projectUrl = new URL(`/${slug}`, window.location.origin);
            projectUrl.searchParams.set('_partial', '1');
            const currentUrl = new URL(window.location.href);
            const showDrafts = currentUrl.searchParams.get('show_drafts');
            if (showDrafts === 'true') projectUrl.searchParams.set('show_drafts', 'true');

            const controller = new AbortController();
            this.activeFetchController = controller;

            try {
                this.debug.mark(token, 'fetch:start', { url: projectUrl.toString() });
                const response = await fetch(projectUrl.toString(), {
                    method: 'GET',
                    headers: {
                        Accept: 'text/html',
                        'X-Requested-With': 'XMLHttpRequest',
                    },
                    signal: controller.signal,
                });
                if (!response.ok) {
                    throw new Error(`Failed to fetch project detail (${response.status})`);
                }
                const html = await response.text();
                if (!this.isTokenActive(token)) return '';
                this.detailsHtmlCache.set(slug, html);
                this.debug.mark(token, 'fetch:done', { bytes: html.length });
                return html;
            } finally {
                if (this.activeFetchController === controller) {
                    this.activeFetchController = null;
                }
            }
        }

        teardownHeroVideo() {
            const video = this.detailHeroMedia.querySelector('video');
            if (video) {
                try {
                    video.pause();
                } catch (_error) {
                    // no-op
                }
            }
            if (!this.activeHls) return;
            this.activeHls.destroy();
            this.activeHls = null;
        }

        async ensureHlsScript() {
            if (window.Hls) return;
            if (!this.hlsScriptPromise) {
                this.hlsScriptPromise = new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = HLS_JS_URL;
                    script.async = true;
                    script.onload = resolve;
                    script.onerror = () => reject(new Error('Failed to load hls.js'));
                    document.head.appendChild(script);
                });
            }
            await this.hlsScriptPromise;
        }

        async setupHeroVideo(slug) {
            const video = this.detailHeroMedia.querySelector('video');
            if (!video) return;
            const card = this.cardsBySlug.get(slug);
            if (card && card.thumbnail && !video.poster) {
                video.poster = card.thumbnail;
            }

            const hlsUrl = video.dataset.hlsUrl || card?.hlsUrl || '';
            if (!hlsUrl) return;

            if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = hlsUrl;
                video.load();
                return;
            }

            await this.ensureHlsScript();
            if (!window.Hls || !window.Hls.isSupported()) {
                video.src = hlsUrl;
                video.load();
                return;
            }

            this.activeHls = new window.Hls();
            this.activeHls.loadSource(hlsUrl);
            this.activeHls.attachMedia(video);
        }

        async mountDetail(slug, token) {
            const card = this.cardsBySlug.get(slug);
            if (!card) throw new Error(`Card not found: ${slug}`);

            this.resetDetailContent();
            this.setHeroAspectRatio(card);
            this.detailTitle.textContent = card.title;
            this.detailHeroFrame.style.setProperty(
                '--t2-fallback-poster',
                card.thumbnail ? `url("${card.thumbnail.replace(/"/g, '\\"')}")` : 'none'
            );

            const html = await this.fetchDetailsHtml(slug, token);
            if (!this.isTokenActive(token)) return;

            const parser = document.createElement('div');
            parser.innerHTML = html;
            const heroNode = parser.querySelector('.video-container');
            if (heroNode) {
                heroNode.removeAttribute('id');
                this.detailHeroMedia.appendChild(heroNode);
            } else {
                const fallbackNode = this.createCardPreviewNode(card, {
                    frameIndex: 0,
                    className: 't2-detail-fallback-media',
                });
                this.detailHeroMedia.appendChild(fallbackNode);
            }

            const contentNode = parser.querySelector('.project-content');
            if (card.formattedDate) {
                const metaNode = document.createElement('div');
                metaNode.className = 't2-detail-meta';

                const labelNode = document.createElement('span');
                labelNode.className = 't2-detail-meta-label';
                labelNode.textContent = 'Published';

                const dateNode = document.createElement('time');
                dateNode.className = 't2-detail-date';
                dateNode.textContent = card.formattedDate;

                metaNode.appendChild(labelNode);
                metaNode.appendChild(dateNode);
                this.detailContent.appendChild(metaNode);
            }

            if (contentNode) {
                this.detailContent.appendChild(contentNode);
            } else {
                const fallbackNode = document.createElement('p');
                fallbackNode.textContent = 'Project details unavailable.';
                this.detailContent.appendChild(fallbackNode);
            }

            await this.setupHeroVideo(slug);
        }

        async openProject(slug, options = {}) {
            const historyMode = options.historyMode || (options.pushHistory === true ? 'push' : 'none');
            const preferInstant = options.preferInstant === true;
            const reason = options.reason || 'open';
            const source = options.source || 'list';
            const card = this.cardsBySlug.get(slug);
            if (!card) return;

            if (this.openSlug === slug && this.state === 'open:detail') {
                if (historyMode === 'push') this.pushHistoryState(slug);
                if (historyMode === 'replace') this.replaceHistoryState(slug);
                return;
            }

            if (this.openSlug && this.openSlug !== slug) {
                await this.closeProject({
                    reason: `switch:${this.openSlug}->${slug}`,
                    historyMode: 'none',
                    preferInstant: false,
                });
            }

            if (!this.openSlug) {
                this.lastFocusedBeforeOpen = document.activeElement;
            }

            const token = this.beginTransition('open', slug, reason);
            this.state = 'opening:measure';
            this.detailScene.setAttribute('data-scene-state', this.state);

            try {
                await this.mountDetail(slug, token);
                if (!this.isTokenActive(token)) return;

                // Read phase: capture geometry before any scene class writes.
                const snapshot = this.measureOpenSnapshot(slug);
                this.debug.mark(token, 'measure', {
                    sourceRect: parseRect(snapshot?.sourceRect),
                    targetRect: parseRect(snapshot?.targetRect),
                    metrics: snapshot?.metrics || null,
                    source,
                });

                // Write phase: commit transient visual state for the morph.
                if (card.spriteController && typeof card.spriteController.freeze === 'function') {
                    card.spriteController.freeze();
                }
                this.setNavHidden(true);
                this.applyListSceneState({ activeSlug: slug, dimmed: true });
                this.applyDetailSceneVisibility(true);
                this.markSourceVisibility(card, true);
                this.markTargetVisibility(true);

                if (!snapshot || preferInstant || shouldUseReducedMotion()) {
                    this.commitOpen(token, slug, historyMode, 'open:no-animation');
                    return;
                }

                this.state = 'opening:animate';
                this.detailScene.setAttribute('data-scene-state', this.state);
                this.mountTransitionLayer(this.createTransitionNode(card, 'open', snapshot.sourceRect), snapshot.sourceRect);
                await this.runMorphAnimation({
                    sourceRect: snapshot.sourceRect,
                    targetRect: snapshot.targetRect,
                    durationMs: OPEN_DURATION_MS,
                    token,
                    mode: 'open',
                });
                if (!this.isTokenActive(token)) return;
                this.commitOpen(token, slug, historyMode, 'open:animation-finished');
            } catch (error) {
                if (!this.isTokenActive(token)) return;
                this.rollbackToList(`open-error:${error instanceof Error ? error.message : String(error)}`);
            }
        }

        commitOpen(token, slug, historyMode, reason) {
            if (!this.isTokenActive(token)) return;
            if (!this.cardsBySlug.has(slug)) return;

            this.clearTransitionLayer();
            this.markTargetVisibility(false);
            this.detailScene.classList.add('t2-visible');
            this.detailScene.setAttribute('data-scene-state', 'open:detail');
            this.openSlug = slug;
            this.state = 'open:detail';

            const closeButton = this.detailScene.querySelector('.t2-close-button');
            if (closeButton instanceof HTMLElement) closeButton.focus({ preventScroll: true });

            if (historyMode === 'push' && !this.isHandlingPopState) {
                this.pushHistoryState(slug);
            } else if (historyMode === 'replace') {
                this.replaceHistoryState(slug);
            }

            this.debug.finish(token, 'commit', { reason, slug });
            if (this.activeTransitionToken === token) this.activeTransitionToken = null;
        }

        async closeProject(options = {}) {
            if (!this.openSlug) return;

            const slug = this.openSlug;
            const historyMode = options.historyMode || (options.pushHistory === true ? 'push' : 'none');
            const preferInstant = options.preferInstant === true;
            const reason = options.reason || 'close';
            const card = this.cardsBySlug.get(slug);
            if (!card) {
                this.rollbackToList('close-with-missing-card');
                if (historyMode === 'push') this.pushHistoryState(null);
                if (historyMode === 'replace') this.replaceHistoryState(null);
                return;
            }

            const token = this.beginTransition('close', slug, reason);
            this.state = 'closing:measure';
            this.detailScene.setAttribute('data-scene-state', this.state);

            try {
                // Read phase: capture geometry before any scene class writes.
                const snapshot = this.measureCloseSnapshot(slug);
                this.debug.mark(token, 'measure', {
                    sourceRect: parseRect(snapshot?.sourceRect),
                    targetRect: parseRect(snapshot?.targetRect),
                    metrics: snapshot?.metrics || null,
                });

                // Write phase: commit transient visual state for the morph.
                this.markSourceVisibility(card, true);
                this.markTargetVisibility(true);
                this.applyDetailSceneVisibility(false);

                if (!snapshot || preferInstant || shouldUseReducedMotion()) {
                    this.commitClose(token, historyMode, 'close:no-animation');
                    return;
                }

                this.state = 'closing:animate';
                this.detailScene.setAttribute('data-scene-state', this.state);
                this.mountTransitionLayer(this.createTransitionNode(card, 'close', snapshot.sourceRect), snapshot.sourceRect);
                await this.runMorphAnimation({
                    sourceRect: snapshot.sourceRect,
                    targetRect: snapshot.targetRect,
                    durationMs: CLOSE_DURATION_MS,
                    token,
                    mode: 'close',
                });
                if (!this.isTokenActive(token)) return;
                this.commitClose(token, historyMode, 'close:animation-finished');
            } catch (error) {
                if (!this.isTokenActive(token)) return;
                this.rollbackToList(`close-error:${error instanceof Error ? error.message : String(error)}`);
            }
        }

        commitClose(token, historyMode, reason) {
            if (!this.isTokenActive(token)) return;
            const previousSlug = this.openSlug;

            this.clearTransitionLayer();
            this.resetDetailContent();
            this.markTargetVisibility(false);
            this.applyDetailSceneVisibility(false);
            this.applyListSceneState({ activeSlug: null, dimmed: false });
            this.setNavHidden(false);

            if (previousSlug && this.cardsBySlug.has(previousSlug)) {
                const previousCard = this.cardsBySlug.get(previousSlug);
                this.markSourceVisibility(previousCard, false);
                if (previousCard.spriteController && typeof previousCard.spriteController.unfreeze === 'function') {
                    previousCard.spriteController.unfreeze();
                    previousCard.spriteController.refresh();
                }
            }

            this.openSlug = null;
            this.state = 'idle:list';
            this.detailScene.setAttribute('data-scene-state', 'closed');

            if (this.lastFocusedBeforeOpen instanceof HTMLElement) {
                this.lastFocusedBeforeOpen.focus({ preventScroll: true });
            } else if (previousSlug && this.cardsBySlug.get(previousSlug)?.openButton) {
                this.cardsBySlug.get(previousSlug).openButton.focus({ preventScroll: true });
            }
            this.lastFocusedBeforeOpen = null;

            if (historyMode === 'push' && !this.isHandlingPopState) {
                this.pushHistoryState(null);
            } else if (historyMode === 'replace') {
                this.replaceHistoryState(null);
            }

            this.debug.finish(token, 'commit', { reason });
            if (this.activeTransitionToken === token) this.activeTransitionToken = null;
        }

        rollbackToList(cancelReason) {
            this.cancelRunningAnimations();
            this.clearTransitionLayer();
            this.resetDetailContent();
            this.applyDetailSceneVisibility(false);
            this.applyListSceneState({ activeSlug: null, dimmed: false });
            this.setNavHidden(false);
            this.cardsBySlug.forEach((card) => {
                this.markSourceVisibility(card, false);
                if (card.spriteController && typeof card.spriteController.unfreeze === 'function') {
                    card.spriteController.unfreeze();
                    card.spriteController.refresh();
                }
            });
            this.markTargetVisibility(false);
            this.openSlug = null;
            this.state = 'idle:list';
            this.detailScene.setAttribute('data-scene-state', 'closed');
            if (this.activeTransitionToken !== null) {
                this.debug.mark(this.activeTransitionToken, 'rollback', { cancelReason });
                this.debug.finish(this.activeTransitionToken, 'cancel', { reason: cancelReason });
                this.activeTransitionToken = null;
            }
        }
    }

    window.Test2TransitionManager = {
        create(options) {
            return new Test2TransitionManager(options);
        },
    };
})();

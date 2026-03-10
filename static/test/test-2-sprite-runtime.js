// Sprite-sheet thumbnail runtime for /test-2.
(function() {
    'use strict';

    const PIXELS_PER_FRAME = 3;
    const MAX_ANIMATION_SPEED = 30;
    const BASE_DECELERATION = 15;
    const SPEED_DECAY_FACTOR = 0.1;
    const FRAME_EPSILON = 0.01;

    function readPositiveNumber(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }

    function normalizeFrameIndex(frameIndex, totalFrames) {
        if (!Number.isFinite(totalFrames) || totalFrames <= 0) return 0;
        let normalized = Math.floor(frameIndex) % totalFrames;
        if (normalized < 0) normalized += totalFrames;
        return normalized;
    }

    class SpriteThumbnail {
        constructor(cardEl) {
            this.cardEl = cardEl;
            this.slug = cardEl.dataset.slug || '';
            this.thumbFrame = cardEl.querySelector('[data-thumb-frame]');
            this.thumbMedia = cardEl.querySelector('[data-thumb-media]');
            this.thumbnailUrl = (cardEl.dataset.thumbnail || '').trim();
            this.spriteSheetUrl = (cardEl.dataset.spriteSheet || '').trim();
            this.frames = readPositiveNumber(cardEl.dataset.frames) || 0;
            this.columns = readPositiveNumber(cardEl.dataset.columns) || 1;
            this.rows = readPositiveNumber(cardEl.dataset.rows) || Math.max(1, Math.ceil(this.frames / this.columns));
            this.frameWidth = readPositiveNumber(cardEl.dataset.frameWidth) || 0;
            this.frameHeight = readPositiveNumber(cardEl.dataset.frameHeight) || 0;
            this.spriteAspectRatio = readPositiveNumber(cardEl.dataset.spriteAspectRatio)
                || (this.frameWidth && this.frameHeight ? this.frameWidth / this.frameHeight : null)
                || (16 / 9);
            this.currentFrameIndex = 0;
            this.lastRenderedWidth = -1;
            this.lastRenderedHeight = -1;
            this.isFrozen = false;
            this.frozenFrameIndex = 0;
            this.spriteNode = null;
            this.hasSprite = !!(this.thumbMedia && this.spriteSheetUrl && this.frames > 0);
        }

        init() {
            if (!this.thumbFrame || !this.thumbMedia || !this.hasSprite) return false;

            this.thumbFrame.style.setProperty('--t2-thumb-aspect', this.spriteAspectRatio.toString());
            this.thumbMedia.innerHTML = '';

            const spriteNode = this.createFrameNode(0, {
                className: 't2-sprite-sheet',
                width: this.thumbFrame.clientWidth || this.frameWidth || 1,
                height: this.thumbFrame.clientHeight || Math.max(1, Math.round((this.thumbFrame.clientWidth || this.frameWidth || 1) / this.spriteAspectRatio)),
            });
            this.thumbMedia.appendChild(spriteNode);
            this.spriteNode = spriteNode;
            this.applyFrame(0);
            return true;
        }

        destroy() {
            this.spriteNode = null;
        }

        freeze() {
            this.isFrozen = true;
            this.frozenFrameIndex = this.currentFrameIndex;
            this.applyFrame(this.frozenFrameIndex);
        }

        unfreeze() {
            this.isFrozen = false;
        }

        refresh() {
            this.applyFrame(this.isFrozen ? this.frozenFrameIndex : this.currentFrameIndex);
        }

        getCurrentFrameIndex() {
            return this.isFrozen ? this.frozenFrameIndex : this.currentFrameIndex;
        }

        update(progress) {
            if (!this.spriteNode || !this.hasSprite) return;
            const nextFrameIndex = this.isFrozen
                ? this.frozenFrameIndex
                : normalizeFrameIndex(progress, this.frames);
            this.applyFrame(nextFrameIndex);
        }

        createFrameNode(frameIndex, options = {}) {
            if (!this.hasSprite) {
                const fallback = document.createElement(this.thumbnailUrl ? 'img' : 'div');
                if (fallback instanceof HTMLImageElement) {
                    fallback.src = this.thumbnailUrl;
                    fallback.alt = '';
                    fallback.decoding = 'sync';
                    fallback.loading = 'eager';
                } else {
                    fallback.className = 't2-thumb-empty';
                    fallback.textContent = 'No thumbnail';
                }
                if (options.className) fallback.className = options.className;
                return fallback;
            }

            const width = Math.max(1, Math.round(options.width || this.thumbFrame?.clientWidth || this.frameWidth || 1));
            const height = Math.max(
                1,
                Math.round(options.height || this.thumbFrame?.clientHeight || (width / this.spriteAspectRatio) || this.frameHeight || 1)
            );
            const resolvedFrameIndex = normalizeFrameIndex(frameIndex, this.frames);
            const node = document.createElement('div');
            node.className = options.className || '';
            node.style.backgroundImage = `url("${this.spriteSheetUrl.replace(/"/g, '\\"')}")`;
            node.style.backgroundRepeat = 'no-repeat';
            node.style.backgroundSize = `${width * this.columns}px ${height * this.rows}px`;
            node.style.backgroundPosition = this.buildBackgroundPosition(resolvedFrameIndex, width, height);
            return node;
        }

        applyFrame(frameIndex) {
            if (!this.spriteNode || !this.hasSprite) return;

            const width = Math.max(1, Math.round(this.thumbFrame?.clientWidth || this.frameWidth || 1));
            const height = Math.max(1, Math.round(this.thumbFrame?.clientHeight || (width / this.spriteAspectRatio) || this.frameHeight || 1));
            const resolvedFrameIndex = normalizeFrameIndex(frameIndex, this.frames);
            if (
                resolvedFrameIndex === this.currentFrameIndex &&
                width === this.lastRenderedWidth &&
                height === this.lastRenderedHeight
            ) {
                return;
            }

            this.currentFrameIndex = resolvedFrameIndex;
            this.lastRenderedWidth = width;
            this.lastRenderedHeight = height;
            this.spriteNode.style.backgroundSize = `${width * this.columns}px ${height * this.rows}px`;
            this.spriteNode.style.backgroundPosition = this.buildBackgroundPosition(resolvedFrameIndex, width, height);
        }

        buildBackgroundPosition(frameIndex, width, height) {
            const col = frameIndex % this.columns;
            const row = Math.floor(frameIndex / this.columns);
            return `-${col * width}px -${row * height}px`;
        }
    }

    class Test2SpriteRuntime {
        constructor(options) {
            this.listScene = options.listScene;
            this.thumbnails = new Map();
            this.animationProgress = 0;
            this.animationSpeed = 0;
            this.lastScrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;
            this.lastScrollEventTime = Date.now();
            this.lastAnimationFrameTime = Date.now();
            this.animationFrameId = null;
            this.prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

            this.boundOnScroll = this.onScroll.bind(this);
            this.boundOnResize = this.onResize.bind(this);
            this.boundOnVisibilityChange = this.onVisibilityChange.bind(this);
        }

        init() {
            const cards = this.listScene.querySelectorAll('[data-project-card]');
            cards.forEach((cardEl) => {
                const thumbnail = new SpriteThumbnail(cardEl);
                thumbnail.init();
                this.thumbnails.set(thumbnail.slug, thumbnail);
            });

            this.updateAll();
            window.addEventListener('scroll', this.boundOnScroll, { passive: true });
            window.addEventListener('resize', this.boundOnResize, { passive: true });
            document.addEventListener('visibilitychange', this.boundOnVisibilityChange);
        }

        destroy() {
            this.stopAnimationLoop();
            window.removeEventListener('scroll', this.boundOnScroll);
            window.removeEventListener('resize', this.boundOnResize);
            document.removeEventListener('visibilitychange', this.boundOnVisibilityChange);
            this.thumbnails.forEach((thumbnail) => thumbnail.destroy());
            this.thumbnails.clear();
        }

        getThumbnail(slug) {
            return this.thumbnails.get(slug) || null;
        }

        updateAll() {
            this.thumbnails.forEach((thumbnail) => thumbnail.update(this.animationProgress));
        }

        onResize() {
            this.thumbnails.forEach((thumbnail) => thumbnail.refresh());
        }

        onVisibilityChange() {
            if (document.hidden) {
                this.stopAnimationLoop();
                return;
            }
            if (Math.abs(this.animationSpeed) > FRAME_EPSILON) {
                this.startAnimationLoop();
            } else {
                this.updateAll();
            }
        }

        onScroll() {
            if (this.prefersReducedMotion) return;

            const currentScrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;
            const now = Date.now();
            const deltaTime = (now - this.lastScrollEventTime) / 1000;

            if (deltaTime > 0) {
                const scrollVelocity = (currentScrollTop - this.lastScrollTop) / deltaTime;
                const nextSpeed = scrollVelocity / PIXELS_PER_FRAME;
                this.animationSpeed = Math.max(-MAX_ANIMATION_SPEED, Math.min(MAX_ANIMATION_SPEED, nextSpeed));
            }

            this.lastScrollTop = currentScrollTop;
            this.lastScrollEventTime = now;

            if (Math.abs(this.animationSpeed) > FRAME_EPSILON) {
                this.startAnimationLoop();
            }
        }

        startAnimationLoop() {
            if (this.animationFrameId !== null || document.hidden || this.prefersReducedMotion) return;
            this.lastAnimationFrameTime = Date.now();
            this.animationFrameId = window.requestAnimationFrame(() => this.animationLoop());
        }

        stopAnimationLoop() {
            if (this.animationFrameId === null) return;
            window.cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        animationLoop() {
            if (document.hidden || this.prefersReducedMotion) {
                this.stopAnimationLoop();
                return;
            }

            const now = Date.now();
            const deltaTime = (now - this.lastAnimationFrameTime) / 1000;
            this.lastAnimationFrameTime = now;

            const dynamicDeceleration = BASE_DECELERATION + Math.abs(this.animationSpeed) * SPEED_DECAY_FACTOR;
            if (this.animationSpeed > 0) {
                this.animationSpeed = Math.max(0, this.animationSpeed - dynamicDeceleration * deltaTime);
            } else if (this.animationSpeed < 0) {
                this.animationSpeed = Math.min(0, this.animationSpeed + dynamicDeceleration * deltaTime);
            }

            this.animationProgress += this.animationSpeed * deltaTime;
            if (this.animationProgress > 1e6) this.animationProgress -= 1e6;
            if (this.animationProgress < -1e6) this.animationProgress += 1e6;

            this.updateAll();

            if (Math.abs(this.animationSpeed) > FRAME_EPSILON) {
                this.animationFrameId = window.requestAnimationFrame(() => this.animationLoop());
            } else {
                this.animationSpeed = 0;
                this.animationFrameId = null;
            }
        }
    }

    window.Test2SpriteRuntime = {
        create(options) {
            return new Test2SpriteRuntime(options);
        },
    };
})();

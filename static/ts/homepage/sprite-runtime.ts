const PIXELS_PER_FRAME = 3;
const MAX_ANIMATION_SPEED = 30;
const BASE_DECELERATION = 15;
const SPEED_DECAY_FACTOR = 0.1;
const FRAME_EPSILON = 0.01;

function readPositiveNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeFrameIndex(frameIndex: number, totalFrames: number): number {
  if (!Number.isFinite(totalFrames) || totalFrames <= 0) return 0;
  let normalized = Math.floor(frameIndex) % totalFrames;
  if (normalized < 0) normalized += totalFrames;
  return normalized;
}

export interface SpriteThumbnailHandle {
  slug: string;
  cardEl: HTMLElement;
  thumbFrame: HTMLElement | null;
  createFrameNode(
    frameIndex: number,
    options?: {
      className?: string;
      width?: number;
      height?: number;
    }
  ): HTMLElement;
  freeze(): void;
  unfreeze(): void;
  refresh(): void;
  getCurrentFrameIndex(): number;
  getSourceAspectRatio(): number;
}

class SpriteThumbnail implements SpriteThumbnailHandle {
  slug: string;
  cardEl: HTMLElement;
  thumbFrame: HTMLElement | null;
  private thumbMedia: HTMLElement | null;
  private readonly thumbnailUrl: string;
  private readonly spriteSheetUrl: string;
  private readonly frames: number;
  private readonly columns: number;
  private readonly rows: number;
  private readonly frameWidth: number;
  private readonly frameHeight: number;
  private readonly spriteAspectRatio: number;
  private displayAspectRatio: number;
  private sheetPixelWidth: number | null = null;
  private sheetPixelHeight: number | null = null;
  private currentFrameIndex = 0;
  private lastRenderedWidth = -1;
  private lastRenderedHeight = -1;
  private isFrozen = false;
  private frozenFrameIndex = 0;
  private spriteNode: HTMLElement | null = null;
  private isActivated = false;
  readonly hasSprite: boolean;

  constructor(cardEl: HTMLElement) {
    this.cardEl = cardEl;
    this.slug = cardEl.dataset.slug || '';
    this.thumbFrame = cardEl.querySelector<HTMLElement>('[data-homepage-thumb-frame]');
    this.thumbMedia = cardEl.querySelector<HTMLElement>('[data-homepage-thumb-media]');
    this.thumbnailUrl = (cardEl.dataset.thumbnail || '').trim();
    this.spriteSheetUrl = (cardEl.dataset.spriteSheet || '').trim();
    this.frames = readPositiveNumber(cardEl.dataset.frames) || 0;
    this.columns = readPositiveNumber(cardEl.dataset.columns) || 1;
    this.rows = readPositiveNumber(cardEl.dataset.rows) || Math.max(1, Math.ceil(this.frames / this.columns));
    this.frameWidth = readPositiveNumber(cardEl.dataset.frameWidth) || 0;
    this.frameHeight = readPositiveNumber(cardEl.dataset.frameHeight) || 0;
    this.spriteAspectRatio = readPositiveNumber(cardEl.dataset.spriteAspectRatio)
      || this.readSheetAspectRatioFromDataset()
      || (this.frameWidth && this.frameHeight ? this.frameWidth / this.frameHeight : null)
      || readPositiveNumber(cardEl.dataset.thumbnailAspectRatio)
      || readPositiveNumber(cardEl.dataset.heroAspectRatio)
      || (16 / 9);
    this.hasSprite = !!(this.thumbMedia && this.spriteSheetUrl && this.frames > 0);
    this.displayAspectRatio = readPositiveNumber(cardEl.dataset.thumbnailAspectRatio)
      || (this.hasSprite ? this.spriteAspectRatio : readPositiveNumber(cardEl.dataset.heroAspectRatio))
      || (16 / 9);
  }

  init(): boolean {
    if (!this.thumbFrame || !this.thumbMedia) return false;
    this.applyDisplayAspectRatio();
    this.primeSheetDimensions();
    return true;
  }

  destroy(): void {
    this.spriteNode = null;
  }

  activate(): boolean {
    if (!this.hasSprite || this.isActivated || !this.thumbMedia || !this.thumbFrame) return false;
    this.thumbMedia.innerHTML = '';

    const spriteNode = this.createFrameNode(0, {
      className: 'homepage-sprite-sheet',
      width: this.thumbFrame.clientWidth || this.frameWidth || 1,
      height: this.thumbFrame.clientHeight || Math.max(1, Math.round((this.thumbFrame.clientWidth || this.frameWidth || 1) / this.displayAspectRatio)),
    });
    this.thumbMedia.appendChild(spriteNode);
    this.spriteNode = spriteNode;
    this.isActivated = true;
    this.applyFrame(0);
    return true;
  }

  freeze(): void {
    this.isFrozen = true;
    this.frozenFrameIndex = this.currentFrameIndex;
    this.applyFrame(this.frozenFrameIndex);
  }

  unfreeze(): void {
    this.isFrozen = false;
  }

  refresh(): void {
    this.applyFrame(this.isFrozen ? this.frozenFrameIndex : this.currentFrameIndex);
  }

  getCurrentFrameIndex(): number {
    return this.isFrozen ? this.frozenFrameIndex : this.currentFrameIndex;
  }

  getSourceAspectRatio(): number {
    return this.hasSprite ? this.resolveSourceAspectRatio() : this.displayAspectRatio;
  }

  update(progress: number): void {
    if (!this.spriteNode || !this.hasSprite) return;
    const nextFrameIndex = this.isFrozen
      ? this.frozenFrameIndex
      : normalizeFrameIndex(progress, this.frames);
    this.applyFrame(nextFrameIndex);
  }

  createFrameNode(
    frameIndex: number,
    options: {
      className?: string;
      width?: number;
      height?: number;
    } = {}
  ): HTMLElement {
    if (!this.hasSprite) {
      const fallback = document.createElement(this.thumbnailUrl ? 'img' : 'div');
      if (fallback instanceof HTMLImageElement) {
        fallback.src = this.thumbnailUrl;
        fallback.alt = '';
        fallback.decoding = 'sync';
        fallback.loading = 'eager';
      } else {
        fallback.className = 'homepage-thumb-empty';
        fallback.textContent = 'No thumbnail';
      }
      if (options.className) fallback.className = options.className;
      return fallback;
    }

    const width = Math.max(1, Math.round(options.width || this.thumbFrame?.clientWidth || this.frameWidth || 1));
    const height = Math.max(1, Math.round(options.height || this.resolveDisplayHeight(width)));
    const resolvedFrameIndex = normalizeFrameIndex(frameIndex, this.frames);
    const renderBox = this.resolveSpriteRenderBox(width, height);
    const node = document.createElement('div');
    node.className = options.className || '';
    node.style.backgroundImage = `url("${this.spriteSheetUrl.replace(/"/g, '\\"')}")`;
    node.style.backgroundRepeat = 'no-repeat';
    node.style.backgroundSize = `${renderBox.frameWidth * this.columns}px ${renderBox.frameHeight * this.rows}px`;
    node.style.backgroundPosition = this.buildBackgroundPosition(resolvedFrameIndex, renderBox);
    return node;
  }

  rebindCard(cardEl: HTMLElement): void {
    this.cardEl = cardEl;
    this.thumbFrame = cardEl.querySelector<HTMLElement>('[data-homepage-thumb-frame]');
    this.thumbMedia = cardEl.querySelector<HTMLElement>('[data-homepage-thumb-media]');
  }

  private applyFrame(frameIndex: number): void {
    if (!this.spriteNode || !this.hasSprite) return;

    const width = Math.max(1, Math.round(this.thumbFrame?.clientWidth || this.frameWidth || 1));
    const height = Math.max(1, Math.round(this.thumbFrame?.clientHeight || this.resolveDisplayHeight(width)));
    const resolvedFrameIndex = normalizeFrameIndex(frameIndex, this.frames);
    if (
      resolvedFrameIndex === this.currentFrameIndex
      && width === this.lastRenderedWidth
      && height === this.lastRenderedHeight
    ) {
      return;
    }

    this.currentFrameIndex = resolvedFrameIndex;
    this.lastRenderedWidth = width;
    this.lastRenderedHeight = height;
    const renderBox = this.resolveSpriteRenderBox(width, height);
    this.spriteNode.style.backgroundSize = `${renderBox.frameWidth * this.columns}px ${renderBox.frameHeight * this.rows}px`;
    this.spriteNode.style.backgroundPosition = this.buildBackgroundPosition(resolvedFrameIndex, renderBox);
  }

  private readSheetAspectRatioFromDataset(): number | null {
    if (!this.frameWidth || !this.frameHeight) {
      return null;
    }
    return this.frameWidth / this.frameHeight;
  }

  private primeSheetDimensions(): void {
    if (!this.hasSprite || typeof Image === 'undefined') return;
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return;
      this.sheetPixelWidth = image.naturalWidth;
      this.sheetPixelHeight = image.naturalHeight;
      // The sheet is the authority on frame shape; metadata can be missing or stale.
      const measuredAspectRatio = this.resolveSourceAspectRatio();
      if (Math.abs(measuredAspectRatio - this.displayAspectRatio) > 0.01) {
        this.displayAspectRatio = measuredAspectRatio;
        this.applyDisplayAspectRatio();
      }
      this.refresh();
    };
    image.src = this.spriteSheetUrl;
  }

  private applyDisplayAspectRatio(): void {
    this.thumbFrame?.style.setProperty('--homepage-thumb-aspect', this.displayAspectRatio.toString());
  }

  private resolveDisplayHeight(width: number): number {
    return (width / this.displayAspectRatio) || this.frameHeight || 1;
  }

  private resolveSourceAspectRatio(): number {
    if (this.sheetPixelWidth && this.sheetPixelHeight && this.columns > 0 && this.rows > 0) {
      return (this.sheetPixelWidth / this.columns) / (this.sheetPixelHeight / this.rows);
    }
    return this.spriteAspectRatio;
  }

  private resolveSpriteRenderBox(containerWidth: number, containerHeight: number): {
    frameWidth: number;
    frameHeight: number;
    offsetX: number;
    offsetY: number;
  } {
    const sourceAspectRatio = this.resolveSourceAspectRatio();
    let frameWidth = containerWidth;
    let frameHeight = containerHeight;

    if (sourceAspectRatio > 0) {
      const containerAspectRatio = containerWidth / Math.max(containerHeight, 1);
      if (sourceAspectRatio > containerAspectRatio) {
        frameHeight = containerHeight;
        frameWidth = Math.max(containerWidth, Math.round(containerHeight * sourceAspectRatio));
      } else {
        frameWidth = containerWidth;
        frameHeight = Math.max(containerHeight, Math.round(containerWidth / sourceAspectRatio));
      }
    }

    return {
      frameWidth,
      frameHeight,
      offsetX: Math.round((containerWidth - frameWidth) / 2),
      offsetY: Math.round((containerHeight - frameHeight) / 2),
    };
  }

  private buildBackgroundPosition(
    frameIndex: number,
    renderBox: {
      frameWidth: number;
      frameHeight: number;
      offsetX: number;
      offsetY: number;
    }
  ): string {
    const col = frameIndex % this.columns;
    const row = Math.floor(frameIndex / this.columns);
    return `${renderBox.offsetX - (col * renderBox.frameWidth)}px ${renderBox.offsetY - (row * renderBox.frameHeight)}px`;
  }
}

export interface HomepageSpriteRuntimeApi {
  init(): void;
  destroy(): void;
  getThumbnail(slug: string): SpriteThumbnailHandle | null;
  renameThumbnail(previousSlug: string, nextSlug: string, cardEl: HTMLElement): void;
}

class HomepageSpriteRuntime implements HomepageSpriteRuntimeApi {
  private readonly listScene: HTMLElement;
  private readonly thumbnails = new Map<string, SpriteThumbnail>();
  private animationProgress = 0;
  private animationSpeed = 0;
  private lastScrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;
  private lastScrollEventTime = Date.now();
  private lastAnimationFrameTime = Date.now();
  private animationFrameId: number | null = null;
  private readonly prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private activationObserver: IntersectionObserver | null = null;
  private readonly boundOnScroll = this.onScroll.bind(this);
  private readonly boundOnResize = this.onResize.bind(this);
  private readonly boundOnVisibilityChange = this.onVisibilityChange.bind(this);

  constructor(listScene: HTMLElement) {
    this.listScene = listScene;
  }

  init(): void {
    const cards = this.listScene.querySelectorAll<HTMLElement>('[data-homepage-project-card]');
    cards.forEach((cardEl) => {
      const thumbnail = new SpriteThumbnail(cardEl);
      thumbnail.init();
      if (thumbnail.hasSprite && !cardEl.dataset.thumbnail) {
        thumbnail.activate();
      }
      this.thumbnails.set(thumbnail.slug, thumbnail);
    });

    this.initActivationObserver();
    this.updateAll();
    window.addEventListener('scroll', this.boundOnScroll, { passive: true });
    window.addEventListener('resize', this.boundOnResize, { passive: true });
    document.addEventListener('visibilitychange', this.boundOnVisibilityChange);
  }

  destroy(): void {
    this.stopAnimationLoop();
    window.removeEventListener('scroll', this.boundOnScroll);
    window.removeEventListener('resize', this.boundOnResize);
    document.removeEventListener('visibilitychange', this.boundOnVisibilityChange);
    this.activationObserver?.disconnect();
    this.activationObserver = null;
    this.thumbnails.forEach((thumbnail) => thumbnail.destroy());
    this.thumbnails.clear();
  }

  getThumbnail(slug: string): SpriteThumbnailHandle | null {
    return this.thumbnails.get(slug) || null;
  }

  renameThumbnail(previousSlug: string, nextSlug: string, cardEl: HTMLElement): void {
    if (!previousSlug || !nextSlug || previousSlug === nextSlug) return;
    const thumbnail = this.thumbnails.get(previousSlug);
    if (!thumbnail) return;

    this.thumbnails.delete(previousSlug);
    thumbnail.slug = nextSlug;
    thumbnail.rebindCard(cardEl);
    this.thumbnails.set(nextSlug, thumbnail);
  }

  private updateAll(): void {
    this.thumbnails.forEach((thumbnail) => thumbnail.update(this.animationProgress));
  }

  private initActivationObserver(): void {
    if (!('IntersectionObserver' in window)) {
      this.thumbnails.forEach((thumbnail) => thumbnail.activate());
      return;
    }

    this.activationObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const cardEl = entry.target as HTMLElement;
        const slug = cardEl.dataset.slug || '';
        const thumbnail = this.thumbnails.get(slug);
        thumbnail?.activate();
        observer.unobserve(cardEl);
      });
    }, {
      rootMargin: '200px 0px 200px 0px',
      threshold: 0.01,
    });

    this.thumbnails.forEach((thumbnail) => {
      if (!thumbnail.cardEl || !thumbnail.hasSprite) return;
      this.activationObserver?.observe(thumbnail.cardEl);
    });
  }

  private onResize(): void {
    this.thumbnails.forEach((thumbnail) => thumbnail.refresh());
  }

  private onVisibilityChange(): void {
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

  private onScroll(): void {
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

  private startAnimationLoop(): void {
    if (this.animationFrameId !== null || document.hidden || this.prefersReducedMotion) return;
    this.lastAnimationFrameTime = Date.now();
    this.animationFrameId = window.requestAnimationFrame(() => this.animationLoop());
  }

  private stopAnimationLoop(): void {
    if (this.animationFrameId === null) return;
    window.cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = null;
  }

  private animationLoop(): void {
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

export function createHomepageSpriteRuntime(options: { listScene: HTMLElement }): HomepageSpriteRuntimeApi {
  return new HomepageSpriteRuntime(options.listScene);
}

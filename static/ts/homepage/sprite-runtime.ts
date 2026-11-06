import { prefersReducedMotion } from './flight';

const PIXELS_PER_FRAME = 3;
const MAX_ANIMATION_SPEED = 30;
const BASE_DECELERATION = 15;
const SPEED_DECAY_FACTOR = 0.1;
const FRAME_EPSILON = 0.01;

function normalizeFrameIndex(frameIndex: number, totalFrames: number): number {
  if (!Number.isFinite(totalFrames) || totalFrames <= 0) return 0;
  let normalized = Math.floor(frameIndex) % totalFrames;
  if (normalized < 0) normalized += totalFrames;
  return normalized;
}

export interface SpriteSheet {
  url: string;
  frames: number;
  columns: number;
  rows: number;
  aspectRatio: number;
}

interface SpriteThumbnailSource {
  cardEl: HTMLElement;
  thumbFrame: HTMLElement;
  thumbMedia: HTMLElement;
  thumbnailUrl: string;
  sheet: SpriteSheet | null;
  displayAspectRatio: number;
}

interface FrameNodeOptions {
  className?: string;
  width?: number;
  height?: number;
}

/** A card's picture: its sprite sheet when it has one, otherwise its still thumbnail. */
export class SpriteThumbnail {
  readonly cardEl: HTMLElement;
  readonly hasSprite: boolean;
  private readonly thumbFrame: HTMLElement;
  private readonly thumbMedia: HTMLElement;
  private readonly thumbnailUrl: string;
  private readonly sheet: SpriteSheet | null;
  private readonly displayAspectRatio: number;
  private sheetPixelWidth: number | null = null;
  private sheetPixelHeight: number | null = null;
  private currentFrameIndex = 0;
  private lastRenderedWidth = -1;
  private lastRenderedHeight = -1;
  private isFrozen = false;
  private frozenFrameIndex = 0;
  private spriteNode: HTMLElement | null = null;

  constructor(source: SpriteThumbnailSource) {
    this.cardEl = source.cardEl;
    this.thumbFrame = source.thumbFrame;
    this.thumbMedia = source.thumbMedia;
    this.thumbnailUrl = source.thumbnailUrl;
    this.sheet = source.sheet;
    this.displayAspectRatio = source.displayAspectRatio;
    this.hasSprite = source.sheet !== null;
  }

  activate(): void {
    if (!this.hasSprite || this.spriteNode) return;
    this.thumbMedia.innerHTML = '';

    const spriteNode = this.createFrameNode(0, { className: 'homepage-sprite-sheet' });
    this.thumbMedia.appendChild(spriteNode);
    this.spriteNode = spriteNode;
    this.applyFrame(0);
    this.measureSheet();
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
    this.applyFrame(this.getCurrentFrameIndex());
  }

  getCurrentFrameIndex(): number {
    return this.isFrozen ? this.frozenFrameIndex : this.currentFrameIndex;
  }

  /** Aspect ratio of the media this card shows, before any frame crops it. */
  getSourceAspectRatio(): number {
    if (!this.sheet) return this.displayAspectRatio;
    if (this.sheetPixelWidth && this.sheetPixelHeight) {
      return (this.sheetPixelWidth / this.sheet.columns) / (this.sheetPixelHeight / this.sheet.rows);
    }
    return this.sheet.aspectRatio;
  }

  update(progress: number): void {
    if (!this.sheet) return;
    this.applyFrame(this.isFrozen ? this.frozenFrameIndex : normalizeFrameIndex(progress, this.sheet.frames));
  }

  createFrameNode(frameIndex: number, options: FrameNodeOptions = {}): HTMLElement {
    if (!this.sheet) {
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

    const width = Math.max(1, Math.round(options.width || this.thumbFrame.clientWidth || 1));
    const height = Math.max(1, Math.round(options.height || this.thumbFrame.clientHeight || width / this.displayAspectRatio));
    const node = document.createElement('div');
    node.className = options.className || '';
    node.style.backgroundImage = `url("${this.sheet.url.replace(/"/g, '\\"')}")`;
    node.style.backgroundRepeat = 'no-repeat';
    this.paintFrame(node, this.sheet, normalizeFrameIndex(frameIndex, this.sheet.frames), width, height);
    return node;
  }

  /** The sheet's real shape replaces data-sprite-aspect-ratio once it has loaded. */
  private measureSheet(): void {
    if (!this.sheet) return;
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return;
      this.sheetPixelWidth = image.naturalWidth;
      this.sheetPixelHeight = image.naturalHeight;
      this.lastRenderedWidth = -1;
      this.refresh();
    };
    image.src = this.sheet.url;
  }

  private applyFrame(frameIndex: number): void {
    if (!this.spriteNode || !this.sheet) return;

    const width = Math.max(1, Math.round(this.thumbFrame.clientWidth || 1));
    const height = Math.max(1, Math.round(this.thumbFrame.clientHeight || width / this.displayAspectRatio));
    const resolvedFrameIndex = normalizeFrameIndex(frameIndex, this.sheet.frames);
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
    this.paintFrame(this.spriteNode, this.sheet, resolvedFrameIndex, width, height);
  }

  private paintFrame(node: HTMLElement, sheet: SpriteSheet, frameIndex: number, width: number, height: number): void {
    const box = this.resolveSpriteRenderBox(width, height);
    const col = frameIndex % sheet.columns;
    const row = Math.floor(frameIndex / sheet.columns);
    node.style.backgroundSize = `${box.frameWidth * sheet.columns}px ${box.frameHeight * sheet.rows}px`;
    node.style.backgroundPosition = `${box.offsetX - (col * box.frameWidth)}px ${box.offsetY - (row * box.frameHeight)}px`;
  }

  private resolveSpriteRenderBox(containerWidth: number, containerHeight: number): {
    frameWidth: number;
    frameHeight: number;
    offsetX: number;
    offsetY: number;
  } {
    const sourceAspectRatio = this.getSourceAspectRatio();
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
}

/** Scrubs every card's sprite with scroll velocity, activating each as it nears the viewport. */
export class HomepageSpriteRuntime {
  private readonly thumbnails: SpriteThumbnail[];
  private animationProgress = 0;
  private animationSpeed = 0;
  private lastScrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;
  private lastScrollEventTime = Date.now();
  private lastAnimationFrameTime = Date.now();
  private animationFrameId: number | null = null;
  private readonly prefersReducedMotion = prefersReducedMotion();
  private activationObserver: IntersectionObserver | null = null;
  private readonly boundOnScroll = this.onScroll.bind(this);
  private readonly boundOnResize = this.onResize.bind(this);
  private readonly boundOnVisibilityChange = this.onVisibilityChange.bind(this);

  constructor(thumbnails: SpriteThumbnail[]) {
    this.thumbnails = thumbnails;
  }

  init(): void {
    this.initActivationObserver();
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
  }

  private updateAll(): void {
    this.thumbnails.forEach((thumbnail) => thumbnail.update(this.animationProgress));
  }

  private initActivationObserver(): void {
    const byCard = new Map(this.thumbnails.map((thumbnail) => [thumbnail.cardEl as Element, thumbnail]));

    this.activationObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        byCard.get(entry.target)?.activate();
        observer.unobserve(entry.target);
      });
    }, {
      rootMargin: '200px 0px 200px 0px',
      threshold: 0.01,
    });

    this.thumbnails.forEach((thumbnail) => {
      if (thumbnail.hasSprite) {
        this.activationObserver?.observe(thumbnail.cardEl);
      }
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

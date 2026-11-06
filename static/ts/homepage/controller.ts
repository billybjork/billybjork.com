import type { HomepageRuntimeApi } from '../core/runtime-registry';
import { cleanupProjectDetail, hydrateProjectDetail, prepareHeroVideo, syncDetailScroll } from '../project/detail-runtime';
import { isEditingActive } from '../core/edit-state';
import { currentProjectSlug, pushProjectUrl, replaceProjectUrl } from './history';
import { buildMorphKeyframes, coverBox, type Box } from './morph';
import {
  createHomepageSpriteRuntime,
  type HomepageSpriteRuntimeApi,
  type SpriteThumbnailHandle,
} from './sprite-runtime';

const OPEN_DURATION_MS = 340;
const CLOSE_DURATION_MS = 300;
const HERO_BRIDGE_FADE_MS = 180;
const EASING_STANDARD = 'cubic-bezier(0.2, 0.0, 0, 1)';

type SceneState = 'closed' | 'opening' | 'open' | 'closing';

interface HomepageControllerOptions {
  listScene: HTMLElement;
  detailScene: HTMLElement;
  detailScroll: HTMLElement;
  detailDate: HTMLElement;
  detailTitle: HTMLElement;
  detailHeroFrame: HTMLElement;
  detailHeroMedia: HTMLElement;
  detailContent: HTMLElement;
  transitionLayer: HTMLElement;
}

interface HomepageProjectCard {
  slug: string;
  cardEl: HTMLElement;
  openButton: HTMLElement;
  thumbFrame: HTMLElement;
  thumbImg: HTMLImageElement | null;
  heading: HTMLElement | null;
  title: string;
  formattedDate: string;
  thumbnail: string;
  thumbnailAspectRatio: number | null;
  spriteAspectRatio: number | null;
  heroAspectRatio: number | null;
  spriteController: SpriteThumbnailHandle | null;
}

interface HeadingEnd {
  el: HTMLElement;
  rect: DOMRect;
}

interface TransitionSnapshot {
  card: HomepageProjectCard;
  sourceRect: DOMRect;
  targetRect: DOMRect;
  sourceHeading: HeadingEnd | null;
  targetHeading: HeadingEnd | null;
}

type HistoryMode = 'none' | 'push' | 'replace';

interface ReadyWaiter {
  requestedSlug: string | null;
  resolve: (slug: string | null) => void;
  timeoutId: number;
}

function waitForAnimationFinish(animation: Animation | null): Promise<void> {
  if (!animation) return Promise.resolve();
  return animation.finished.then(() => undefined).catch(() => undefined);
}

function shouldUseReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function readPositiveNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function measureHeading(el: HTMLElement | null): HeadingEnd | null {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return rect.width >= 1 && rect.height >= 1 ? { el, rect } : null;
}

/**
 * Pins each node of a heading clone to its source's resolved type metrics, so
 * the clone lays out identically outside the source's cascade. Pinning only
 * the root would hand its resolved px line-height to smaller children (the
 * date), stretching their lines and offsetting the clone from the real heading.
 */
export function pinFlightTypography(source: HTMLElement, clone: HTMLElement): void {
  const sources = [source, ...source.querySelectorAll<HTMLElement>('*')];
  const clones = [clone, ...clone.querySelectorAll<HTMLElement>('*')];
  sources.forEach((sourceNode, index) => {
    const cloneNode = clones[index];
    if (!cloneNode) return;
    const computed = window.getComputedStyle(sourceNode);
    cloneNode.style.fontFamily = computed.fontFamily;
    cloneNode.style.fontSize = computed.fontSize;
    cloneNode.style.fontWeight = computed.fontWeight;
    cloneNode.style.lineHeight = computed.lineHeight;
    cloneNode.style.letterSpacing = computed.letterSpacing;
  });
}

export class HomepageController implements HomepageRuntimeApi {
  private readonly listScene: HTMLElement;
  private readonly detailScene: HTMLElement;
  private readonly detailDate: HTMLElement;
  private readonly detailTitle: HTMLElement;
  private readonly detailHeading: HTMLElement;
  private readonly detailScroll: HTMLElement;
  private readonly detailHeroFrame: HTMLElement;
  private readonly detailHeroMedia: HTMLElement;
  private readonly detailContent: HTMLElement;
  private readonly transitionLayer: HTMLElement;
  private readonly cardsBySlug = new Map<string, HomepageProjectCard>();
  private readonly detailsHtmlCache = new Map<string, string>();
  private readonly readyWaiters = new Set<ReadyWaiter>();
  private spriteRuntime: HomepageSpriteRuntimeApi | null = null;
  private openSlug: string | null = null;
  private lastFocusedBeforeOpen: Element | null = null;
  private state: SceneState = 'closed';
  private transition = new AbortController();
  private activeAnimations: Animation[] = [];
  private headingFlights: HTMLElement[] = [];
  private activeHeroVideoReadyPromise: Promise<boolean> = Promise.resolve(false);
  private readonly boundOnClick = this.onClick.bind(this);
  private readonly boundOnKeyDown = this.onKeyDown.bind(this);
  private readonly boundOnPopState = this.onPopState.bind(this);

  constructor(options: HomepageControllerOptions) {
    this.listScene = options.listScene;
    this.detailScene = options.detailScene;
    this.detailDate = options.detailDate;
    this.detailTitle = options.detailTitle;
    this.detailHeading = options.detailTitle.closest<HTMLElement>('.homepage-detail-heading') ?? options.detailTitle;
    this.detailScroll = options.detailScroll;
    this.detailHeroFrame = options.detailHeroFrame;
    this.detailHeroMedia = options.detailHeroMedia;
    this.detailContent = options.detailContent;
    this.transitionLayer = options.transitionLayer;
  }

  init(): void {
    this.spriteRuntime = createHomepageSpriteRuntime({ listScene: this.listScene });
    this.spriteRuntime.init();
    this.rebuildCardMap();
    document.addEventListener('click', this.boundOnClick, true);
    document.addEventListener('keydown', this.boundOnKeyDown);
    window.addEventListener('popstate', this.boundOnPopState);
    this.bootstrapInitialState();
  }

  destroy(): void {
    document.removeEventListener('click', this.boundOnClick, true);
    document.removeEventListener('keydown', this.boundOnKeyDown);
    window.removeEventListener('popstate', this.boundOnPopState);
    this.cancelInFlight();
    this.resetDetailContent();
    this.clearTransitionLayer();
    this.applyListSceneState({ activeSlug: null, dimmed: false });
    this.applyDetailSceneVisibility(false);
    this.setNavHidden(false);
    this.syncSceneProjectSlug(null);
    this.spriteRuntime?.destroy();
    this.spriteRuntime = null;
    this.flushReadyWaiters(true);
  }

  getOpenProjectSlug(): string | null {
    return this.openSlug;
  }

  waitForProjectReady(slug: string | null = this.getOpenProjectSlug(), timeoutMs: number = 2000): Promise<string | null> {
    const readySlug = this.getReadySlug();
    if (readySlug && (!slug || slug === readySlug)) {
      return Promise.resolve(readySlug);
    }

    return new Promise((resolve) => {
      const waiter: ReadyWaiter = {
        requestedSlug: slug,
        resolve: (resolvedSlug) => {
          this.readyWaiters.delete(waiter);
          resolve(resolvedSlug);
        },
        timeoutId: window.setTimeout(() => {
          const timeoutReadySlug = this.getReadySlug();
          if (timeoutReadySlug && (!slug || slug === timeoutReadySlug)) {
            waiter.resolve(timeoutReadySlug);
            return;
          }
          waiter.resolve(null);
        }, timeoutMs),
      };

      this.readyWaiters.add(waiter);
    });
  }

  renameProjectSlug(previousSlug: string, nextSlug: string): void {
    const resolvedPreviousSlug = previousSlug.trim();
    const resolvedNextSlug = nextSlug.trim();
    if (!resolvedPreviousSlug || !resolvedNextSlug || resolvedPreviousSlug === resolvedNextSlug) {
      return;
    }

    const card = this.cardsBySlug.get(resolvedPreviousSlug);
    if (card) {
      this.cardsBySlug.delete(resolvedPreviousSlug);
      card.slug = resolvedNextSlug;
      card.cardEl.dataset.slug = resolvedNextSlug;
      card.cardEl.querySelectorAll('[data-open-project]').forEach((trigger) => {
        trigger.setAttribute('data-open-project', resolvedNextSlug);
      });
      this.cardsBySlug.set(resolvedNextSlug, card);
      this.spriteRuntime?.renameThumbnail(resolvedPreviousSlug, resolvedNextSlug, card.cardEl);
    }

    const cachedHtml = this.detailsHtmlCache.get(resolvedPreviousSlug);
    if (cachedHtml) {
      this.detailsHtmlCache.delete(resolvedPreviousSlug);
      this.detailsHtmlCache.set(resolvedNextSlug, cachedHtml);
    }

    if (this.openSlug === resolvedPreviousSlug) {
      this.openSlug = resolvedNextSlug;
      this.syncSceneProjectSlug(resolvedNextSlug);
      replaceProjectUrl(resolvedNextSlug, { preserveHash: true });
      this.flushReadyWaiters();
    }
  }

  private rebuildCardMap(): void {
    this.cardsBySlug.clear();
    const cards = this.listScene.querySelectorAll<HTMLElement>('[data-homepage-project-card]');
    cards.forEach((cardEl) => {
      const slug = cardEl.dataset.slug;
      if (!slug) return;

      const openButton = cardEl.querySelector<HTMLElement>('button[data-open-project]');
      const thumbFrame = cardEl.querySelector<HTMLElement>('[data-homepage-thumb-frame]');
      if (!openButton || !thumbFrame) return;

      const thumbImg = thumbFrame.querySelector<HTMLImageElement>('img');
      const thumbnailAspectRatio = readPositiveNumber(cardEl.dataset.thumbnailAspectRatio);
      const spriteAspectRatio = readPositiveNumber(cardEl.dataset.spriteAspectRatio);
      const heroAspectRatio = readPositiveNumber(cardEl.dataset.heroAspectRatio)
        || thumbnailAspectRatio
        || spriteAspectRatio;

      this.cardsBySlug.set(slug, {
        slug,
        cardEl,
        openButton,
        thumbFrame,
        thumbImg,
        heading: cardEl.querySelector<HTMLElement>('.homepage-card-heading'),
        title: (cardEl.dataset.title || slug).trim(),
        formattedDate: (cardEl.dataset.formattedDate || '').trim(),
        thumbnail: (cardEl.dataset.thumbnail || '').trim(),
        thumbnailAspectRatio,
        spriteAspectRatio,
        heroAspectRatio,
        spriteController: this.spriteRuntime?.getThumbnail(slug) || null,
      });
    });
  }

  private onClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const openTrigger = target.closest<HTMLElement>('[data-open-project]');
    if (openTrigger) {
      const slug = openTrigger.getAttribute('data-open-project');
      if (!slug) return;
      event.preventDefault();
      void this.openProject(slug, 'push');
      return;
    }

    if (target.closest('[data-close-detail]') && this.openSlug) {
      event.preventDefault();
      void this.closeProject('push');
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.defaultPrevented || isEditingActive() || !this.openSlug) {
      return;
    }
    event.preventDefault();
    void this.closeProject('push');
  }

  private onPopState(): void {
    const targetSlug = currentProjectSlug();
    if (targetSlug) {
      void this.openProject(targetSlug, 'none');
    } else {
      void this.closeProject('none');
    }
  }

  private bootstrapInitialState(): void {
    const initialSlug = currentProjectSlug();
    if (initialSlug) {
      void this.openProject(initialSlug, 'replace');
    }
  }

  private syncHashScrollAfterNavigation(slug: string): void {
    if (currentProjectSlug() !== slug) {
      return;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (this.openSlug === slug && this.state === 'open') {
          syncDetailScroll(this.detailScroll);
        }
      });
    });
  }

  private beginTransition(): AbortSignal {
    this.cancelInFlight();
    this.transition = new AbortController();
    return this.transition.signal;
  }

  private cancelInFlight(): void {
    this.transition.abort();
    this.cancelRunningAnimations();
    this.clearTransitionLayer();
  }

  private cancelRunningAnimations(): void {
    this.activeAnimations.forEach((animation) => animation.cancel());
    this.activeAnimations = [];
  }

  private trackAnimation(animation: Animation): Animation {
    this.activeAnimations.push(animation);
    return animation;
  }

  private applyListSceneState(options: { activeSlug: string | null; dimmed: boolean }): void {
    this.listScene.classList.toggle('homepage-list-dimmed', options.dimmed);
    this.cardsBySlug.forEach((card, slug) => {
      card.cardEl.classList.toggle('homepage-active-card', slug === options.activeSlug);
    });
  }

  private applyDetailSceneVisibility(visible: boolean): void {
    this.detailScene.classList.toggle('homepage-visible', visible);
    this.detailScene.setAttribute('aria-hidden', visible ? 'false' : 'true');
    if ('inert' in this.listScene) {
      this.listScene.inert = visible;
    }
  }

  private setNavHidden(hidden: boolean): void {
    document.body.classList.toggle('homepage-nav-hidden', hidden);
  }

  private markSourceVisibility(card: HomepageProjectCard | null | undefined, hidden: boolean): void {
    card?.thumbFrame.classList.toggle('homepage-source-hidden', hidden);
    card?.heading?.classList.toggle('homepage-source-hidden', hidden);
  }

  private markTargetVisibility(hidden: boolean): void {
    this.detailHeroFrame.classList.toggle('homepage-target-hidden', hidden);
    this.detailHeading.classList.toggle('homepage-target-hidden', hidden);
  }

  private clearTransitionLayer(): void {
    this.transitionLayer.classList.remove('homepage-active');
    this.transitionLayer.style.left = '0px';
    this.transitionLayer.style.top = '0px';
    this.transitionLayer.style.width = '0px';
    this.transitionLayer.style.height = '0px';
    this.transitionLayer.style.transform = 'none';
    this.transitionLayer.style.clipPath = '';
    this.transitionLayer.style.opacity = '0';
    this.transitionLayer.innerHTML = '';
    this.headingFlights.forEach((flight) => flight.remove());
    this.headingFlights = [];
  }

  private resetDetailContent(): void {
    cleanupProjectDetail(this.detailScene);
    this.clearHeroBridge();
    this.activeHeroVideoReadyPromise = Promise.resolve(false);
    this.detailHeroMedia.innerHTML = '';
    this.detailContent.innerHTML = '';
    this.detailDate.textContent = '';
    this.detailTitle.textContent = '';
    this.detailHeroFrame.style.setProperty('--homepage-fallback-poster', 'none');
    this.detailHeroFrame.style.setProperty('--homepage-hero-aspect', (16 / 9).toString());
    this.syncSceneProjectSlug(null);
  }

  private setHeroAspectRatio(card: HomepageProjectCard | null): void {
    const aspectRatio = card?.heroAspectRatio || card?.thumbnailAspectRatio || card?.spriteAspectRatio || (16 / 9);
    this.detailHeroFrame.style.setProperty('--homepage-hero-aspect', aspectRatio.toString());
  }

  private syncSceneProjectSlug(slug: string | null): void {
    const resolvedSlug = slug?.trim() || '';
    const editButton = this.detailScene.querySelector<HTMLElement>('[data-homepage-edit-project]');
    if (editButton) {
      editButton.dataset.projectSlug = resolvedSlug;
    }
  }

  private createCardPreviewNode(
    card: HomepageProjectCard,
    options: {
      className?: string;
      frameIndex?: number;
      width?: number;
      height?: number;
    } = {}
  ): HTMLElement {
    const frameIndex = typeof options.frameIndex === 'number' ? options.frameIndex : 0;
    if (card.spriteController) {
      return card.spriteController.createFrameNode(frameIndex, {
        className: options.className,
        width: options.width,
        height: options.height,
      });
    }

    const thumbSrc = card.thumbnail || card.thumbImg?.currentSrc || card.thumbImg?.src || '';
    if (!thumbSrc) {
      const fallback = document.createElement('div');
      fallback.className = options.className || '';
      fallback.style.background = '#141414';
      return fallback;
    }

    const image = document.createElement('img');
    image.className = options.className || '';
    image.src = thumbSrc;
    image.alt = '';
    image.decoding = 'sync';
    image.loading = 'eager';
    return image;
  }

  private getTransitionFrameIndex(card: HomepageProjectCard | null | undefined): number {
    return card?.spriteController?.getCurrentFrameIndex() ?? 0;
  }

  private createHeroBridgeNode(card: HomepageProjectCard, frameIndex: number): HTMLElement {
    const width = Math.max(1, Math.round(this.detailHeroFrame.clientWidth || 1));
    const height = Math.max(1, Math.round(this.detailHeroFrame.clientHeight || 1));
    const node = this.createCardPreviewNode(card, {
      frameIndex,
      className: 'homepage-hero-bridge',
      width,
      height,
    });
    node.setAttribute('aria-hidden', 'true');
    return node;
  }

  private clearHeroBridge(): void {
    this.detailHeroFrame.querySelector('.homepage-hero-bridge')?.remove();
  }

  private installHeroBridge(card: HomepageProjectCard, frameIndex: number): void {
    this.clearHeroBridge();
    this.detailHeroFrame.appendChild(this.createHeroBridgeNode(card, frameIndex));
  }

  private async fadeOutHeroBridge(signal: AbortSignal, durationMs: number = HERO_BRIDGE_FADE_MS): Promise<void> {
    const bridge = this.detailHeroFrame.querySelector<HTMLElement>('.homepage-hero-bridge');
    if (!bridge) return;

    if (shouldUseReducedMotion() || durationMs <= 0) {
      bridge.remove();
      return;
    }

    const animation = this.trackAnimation(
      bridge.animate(
        [{ opacity: 1 }, { opacity: 0 }],
        {
          duration: durationMs,
          easing: EASING_STANDARD,
          fill: 'forwards',
        }
      )
    );
    await waitForAnimationFinish(animation);
    if (signal.aborted) return;
    bridge.remove();
  }

  private async revealHeroVideoWhenReady(card: HomepageProjectCard, signal: AbortSignal, frameIndex: number): Promise<void> {
    if (signal.aborted) return;
    const video = this.detailHeroMedia.querySelector('video');
    if (!video) {
      this.clearHeroBridge();
      return;
    }

    this.installHeroBridge(card, frameIndex);
    const isReady = await this.activeHeroVideoReadyPromise.catch(() => false);
    if (signal.aborted) return;
    if (!isReady) {
      this.clearHeroBridge();
      return;
    }

    await this.fadeOutHeroBridge(signal);
  }

  /** Aspect ratio of the media the transition layer shows, before any frame crops it. */
  private resolveTransitionMediaAspectRatio(card: HomepageProjectCard): number {
    if (card.spriteController) {
      return card.spriteController.getSourceAspectRatio();
    }
    const thumbImg = card.thumbImg;
    if (thumbImg && thumbImg.naturalWidth > 0 && thumbImg.naturalHeight > 0) {
      return thumbImg.naturalWidth / thumbImg.naturalHeight;
    }
    return card.thumbnailAspectRatio || card.heroAspectRatio || (16 / 9);
  }

  private createTransitionNode(card: HomepageProjectCard, mediaBox: Box, frameIndex: number): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'homepage-transition-visual';
    wrapper.appendChild(this.createCardPreviewNode(card, {
      frameIndex,
      className: 'homepage-transition-media-layer',
      width: Math.max(1, Math.round(mediaBox.width)),
      height: Math.max(1, Math.round(mediaBox.height)),
    }));
    return wrapper;
  }

  private mountTransitionLayer(node: HTMLElement, mediaBox: Box, initialKeyframe: Keyframe | undefined): void {
    this.transitionLayer.innerHTML = '';
    this.transitionLayer.appendChild(node);
    this.transitionLayer.style.left = `${mediaBox.left}px`;
    this.transitionLayer.style.top = `${mediaBox.top}px`;
    this.transitionLayer.style.width = `${mediaBox.width}px`;
    this.transitionLayer.style.height = `${mediaBox.height}px`;
    this.transitionLayer.style.transform = String(initialKeyframe?.transform ?? 'none');
    this.transitionLayer.style.clipPath = String(initialKeyframe?.clipPath ?? '');
    this.transitionLayer.style.opacity = '1';
    this.transitionLayer.classList.add('homepage-active');
  }

  private mountHeadingFlight(end: HeadingEnd): HTMLElement {
    const flight = end.el.cloneNode(true) as HTMLElement;
    flight.removeAttribute('id');
    flight.removeAttribute('data-open-project');
    flight.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
    flight.classList.remove('homepage-source-hidden', 'homepage-target-hidden');
    flight.classList.add('homepage-heading-flight');
    flight.setAttribute('aria-hidden', 'true');

    flight.style.left = `${end.rect.left}px`;
    flight.style.top = `${end.rect.top}px`;
    flight.style.width = `${end.rect.width}px`;
    pinFlightTypography(end.el, flight);

    document.body.appendChild(flight);
    this.headingFlights.push(flight);
    return flight;
  }

  /**
   * Flies the date and title between the list card and the detail header on
   * the media morph's timing. Headings that wrap the same way move as one
   * layer; when the wider detail header rewraps the title, the two layouts
   * cross-fade along the same path instead of snapping at the end.
   */
  private startHeadingFlight(source: HeadingEnd | null, target: HeadingEnd | null, durationMs: number): Animation[] {
    if (!source || !target) return [];

    const dx = target.rect.left - source.rect.left;
    const dy = target.rect.top - source.rect.top;
    const sameLayout = Math.abs(source.rect.height - target.rect.height) < 1;
    const fromColor = window.getComputedStyle(source.el).color;
    const toColor = window.getComputedStyle(target.el).color;
    const timing: KeyframeAnimationOptions = {
      duration: durationMs,
      easing: EASING_STANDARD,
      fill: 'forwards',
    };

    const animations = [
      this.mountHeadingFlight(source).animate([
        { transform: 'translate3d(0px, 0px, 0px)', color: fromColor, opacity: 1 },
        { transform: `translate3d(${dx}px, ${dy}px, 0px)`, color: toColor, opacity: sameLayout ? 1 : 0 },
      ], timing),
    ];
    if (!sameLayout) {
      animations.push(this.mountHeadingFlight(target).animate([
        { transform: `translate3d(${-dx}px, ${-dy}px, 0px)`, color: fromColor, opacity: 0 },
        { transform: 'translate3d(0px, 0px, 0px)', color: toColor, opacity: 1 },
      ], timing));
    }
    return animations.map((animation) => this.trackAnimation(animation));
  }

  private async runMorphTransition(options: {
    card: HomepageProjectCard;
    sourceRect: DOMRect;
    targetRect: DOMRect;
    sourceHeading: HeadingEnd | null;
    targetHeading: HeadingEnd | null;
    frameIndex: number;
    durationMs: number;
    signal: AbortSignal;
  }): Promise<void> {
    if (options.signal.aborted) return;

    const mediaAspectRatio = this.resolveTransitionMediaAspectRatio(options.card);
    const keyframes = buildMorphKeyframes(options.sourceRect, options.targetRect, mediaAspectRatio);
    const sourceMedia = coverBox(options.sourceRect, mediaAspectRatio);
    this.mountTransitionLayer(
      this.createTransitionNode(options.card, sourceMedia, options.frameIndex),
      sourceMedia,
      keyframes[0]
    );

    const headingAnimations = this.startHeadingFlight(options.sourceHeading, options.targetHeading, options.durationMs);
    const animation = this.trackAnimation(
      this.transitionLayer.animate(keyframes, {
        duration: options.durationMs,
        easing: EASING_STANDARD,
        fill: 'forwards',
      })
    );
    await Promise.all([animation, ...headingAnimations].map(waitForAnimationFinish));
    this.activeAnimations = [];
  }

  private measureOpenSnapshot(slug: string): TransitionSnapshot | null {
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
      sourceHeading: measureHeading(card.heading),
      targetHeading: measureHeading(this.detailHeading),
    };
  }

  private measureCloseSnapshot(slug: string): TransitionSnapshot | null {
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
      sourceHeading: measureHeading(this.detailHeading),
      targetHeading: measureHeading(card.heading),
    };
  }

  private async fetchDetailsHtml(slug: string, signal: AbortSignal): Promise<string> {
    const cached = this.detailsHtmlCache.get(slug);
    if (cached) {
      return cached;
    }

    const projectUrl = new URL(`/${slug}`, window.location.origin);
    projectUrl.searchParams.set('_partial', '1');
    if (new URL(window.location.href).searchParams.get('show_drafts') === 'true') {
      projectUrl.searchParams.set('show_drafts', 'true');
    }

    const response = await fetch(projectUrl.toString(), { signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch project detail (${response.status})`);
    }

    const html = await response.text();
    this.detailsHtmlCache.set(slug, html);
    return html;
  }

  private async mountDetail(slug: string, signal: AbortSignal, frameIndex: number): Promise<void> {
    const card = this.cardsBySlug.get(slug);
    if (!card) {
      throw new Error(`Card not found: ${slug}`);
    }

    this.resetDetailContent();
    this.setHeroAspectRatio(card);
    this.detailDate.textContent = card.formattedDate || '';
    this.detailTitle.textContent = card.title;
    this.syncSceneProjectSlug(slug);
    this.detailHeroFrame.style.setProperty(
      '--homepage-fallback-poster',
      card.thumbnail ? `url("${card.thumbnail.replace(/"/g, '\\"')}")` : 'none'
    );

    const html = await this.fetchDetailsHtml(slug, signal);
    if (signal.aborted) return;

    const parser = document.createElement('div');
    parser.innerHTML = html;

    const heroNode = parser.querySelector<HTMLElement>('.video-container');
    if (heroNode) {
      this.detailHeroMedia.appendChild(heroNode);
    } else {
      this.detailHeroMedia.appendChild(this.createCardPreviewNode(card, {
        frameIndex,
        className: 'homepage-detail-fallback-media',
      }));
    }

    const contentNode = parser.querySelector<HTMLElement>('.project-content');
    if (contentNode) {
      this.detailContent.appendChild(contentNode);
    } else {
      const fallbackNode = document.createElement('p');
      fallbackNode.textContent = 'Project details unavailable.';
      this.detailContent.appendChild(fallbackNode);
    }

    hydrateProjectDetail(this.detailScene);
    this.startHeroVideo(card, signal);
  }

  private startHeroVideo(card: HomepageProjectCard, signal: AbortSignal): void {
    const video = this.detailHeroMedia.querySelector('video');
    if (!video) return;

    if (card.thumbnail && !video.poster) {
      video.poster = card.thumbnail;
    }
    this.activeHeroVideoReadyPromise = prepareHeroVideo(video, signal).then((ready) => {
      if (ready) {
        this.detailHeroFrame.style.setProperty('--homepage-fallback-poster', 'none');
      }
      return ready;
    });
  }

  async openProject(slug: string, historyMode: HistoryMode = 'none'): Promise<void> {
    const card = this.cardsBySlug.get(slug);
    if (!card) return;

    if (this.openSlug === slug && this.state === 'open') {
      if (historyMode === 'push') pushProjectUrl(slug);
      if (historyMode === 'replace') replaceProjectUrl(slug, { preserveHash: true });
      this.syncHashScrollAfterNavigation(slug);
      return;
    }

    if (this.openSlug && this.openSlug !== slug) {
      await this.closeProject('none');
    }

    if (!this.openSlug) {
      this.lastFocusedBeforeOpen = document.activeElement;
    }

    const signal = this.beginTransition();
    this.state = 'opening';
    const transitionFrameIndex = this.getTransitionFrameIndex(card);

    try {
      await this.mountDetail(slug, signal, transitionFrameIndex);
      if (signal.aborted) return;

      const snapshot = this.measureOpenSnapshot(slug);
      card.spriteController?.freeze();
      this.setNavHidden(true);
      this.applyListSceneState({ activeSlug: slug, dimmed: true });
      this.applyDetailSceneVisibility(true);
      this.markSourceVisibility(card, true);
      this.markTargetVisibility(true);

      // A direct entry (replace) lands open, with nothing on screen to fly from.
      if (snapshot && historyMode !== 'replace' && !shouldUseReducedMotion()) {
        await this.runMorphTransition({
          card,
          sourceRect: snapshot.sourceRect,
          targetRect: snapshot.targetRect,
          sourceHeading: snapshot.sourceHeading,
          targetHeading: snapshot.targetHeading,
          frameIndex: transitionFrameIndex,
          durationMs: OPEN_DURATION_MS,
          signal,
        });
        if (signal.aborted) return;
      }

      this.commitOpen(signal, slug, historyMode, transitionFrameIndex);
    } catch (error) {
      if (signal.aborted) return;
      console.error('Failed to open homepage project detail:', error);
      this.rollbackToList();
    }
  }

  private commitOpen(signal: AbortSignal, slug: string, historyMode: HistoryMode, frameIndex: number): void {
    const card = this.cardsBySlug.get(slug);
    if (!card) return;

    this.clearTransitionLayer();
    this.markTargetVisibility(false);
    this.openSlug = slug;
    this.syncSceneProjectSlug(slug);
    this.state = 'open';
    this.flushReadyWaiters();

    void this.revealHeroVideoWhenReady(card, signal, frameIndex);

    this.detailScene.querySelector<HTMLElement>('.homepage-close-button')?.focus({ preventScroll: true });

    if (historyMode === 'push') {
      pushProjectUrl(slug);
    } else if (historyMode === 'replace') {
      replaceProjectUrl(slug, { preserveHash: true });
    }

    this.syncHashScrollAfterNavigation(slug);
  }

  async closeProject(historyMode: 'none' | 'push' = 'none'): Promise<void> {
    if (!this.openSlug) {
      return;
    }

    const slug = this.openSlug;
    const card = this.cardsBySlug.get(slug);
    if (!card) {
      this.rollbackToList();
      if (historyMode === 'push') pushProjectUrl(null);
      return;
    }

    const signal = this.beginTransition();
    this.state = 'closing';

    try {
      const snapshot = this.measureCloseSnapshot(slug);
      this.markSourceVisibility(card, true);
      this.markTargetVisibility(true);
      this.applyDetailSceneVisibility(false);

      if (snapshot && !shouldUseReducedMotion()) {
        await this.runMorphTransition({
          card,
          sourceRect: snapshot.sourceRect,
          targetRect: snapshot.targetRect,
          sourceHeading: snapshot.sourceHeading,
          targetHeading: snapshot.targetHeading,
          frameIndex: this.getTransitionFrameIndex(card),
          durationMs: CLOSE_DURATION_MS,
          signal,
        });
        if (signal.aborted) return;
      }

      this.commitClose(historyMode);
    } catch (error) {
      if (signal.aborted) return;
      console.error('Failed to close homepage project detail:', error);
      this.rollbackToList();
    }
  }

  private commitClose(historyMode: 'none' | 'push'): void {
    const previousSlug = this.openSlug;
    const previousCard = previousSlug ? this.cardsBySlug.get(previousSlug) : null;

    this.clearTransitionLayer();
    this.resetDetailContent();
    this.markTargetVisibility(false);
    this.applyDetailSceneVisibility(false);
    this.applyListSceneState({ activeSlug: null, dimmed: false });
    this.setNavHidden(false);
    this.markSourceVisibility(previousCard, false);
    previousCard?.spriteController?.unfreeze();
    previousCard?.spriteController?.refresh();

    this.openSlug = null;
    this.syncSceneProjectSlug(null);
    this.state = 'closed';
    this.flushReadyWaiters(true);

    if (this.lastFocusedBeforeOpen instanceof HTMLElement) {
      this.lastFocusedBeforeOpen.focus({ preventScroll: true });
    } else {
      previousCard?.openButton.focus?.({ preventScroll: true });
    }
    this.lastFocusedBeforeOpen = null;

    if (historyMode === 'push') {
      pushProjectUrl(null);
    }
  }

  private rollbackToList(): void {
    this.cancelRunningAnimations();
    this.clearTransitionLayer();
    this.resetDetailContent();
    this.applyDetailSceneVisibility(false);
    this.applyListSceneState({ activeSlug: null, dimmed: false });
    this.setNavHidden(false);
    this.cardsBySlug.forEach((card) => {
      this.markSourceVisibility(card, false);
      card.spriteController?.unfreeze();
      card.spriteController?.refresh();
    });
    this.markTargetVisibility(false);
    this.openSlug = null;
    this.syncSceneProjectSlug(null);
    this.state = 'closed';
    this.flushReadyWaiters(true);
  }

  private getReadySlug(): string | null {
    if (this.state !== 'open' || !this.openSlug) {
      return null;
    }
    return this.detailContent.querySelector('.project-content') ? this.openSlug : null;
  }

  private flushReadyWaiters(forceNull: boolean = false): void {
    const readySlug = this.getReadySlug();
    this.readyWaiters.forEach((waiter) => {
      if (readySlug && (!waiter.requestedSlug || waiter.requestedSlug === readySlug)) {
        clearTimeout(waiter.timeoutId);
        waiter.resolve(readySlug);
        return;
      }
      if (forceNull) {
        clearTimeout(waiter.timeoutId);
        waiter.resolve(null);
      }
    });
  }
}

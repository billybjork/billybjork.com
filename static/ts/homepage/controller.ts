import type { HomepageRuntimeApi } from '../core/runtime-registry';
import { projectDetailRuntime } from '../project/detail-runtime';
import { scrollToHashTarget } from '../project/hash-scroll';
import {
  createHomepageSpriteRuntime,
  type HomepageSpriteRuntimeApi,
  type SpriteThumbnailHandle,
} from './sprite-runtime';

const QUERY_KEEP_KEYS = ['show_drafts'];
const OPEN_DURATION_MS = 340;
const CLOSE_DURATION_MS = 300;
const HERO_BRIDGE_FADE_MS = 180;
const EASING_STANDARD = 'cubic-bezier(0.2, 0.0, 0, 1)';

type SceneState =
  | 'idle:list'
  | 'opening:measure'
  | 'opening:animate'
  | 'open:detail'
  | 'closing:measure'
  | 'closing:animate';

interface HomepageControllerOptions {
  listScene: HTMLElement;
  detailScene: HTMLElement;
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
  title: string;
  formattedDate: string;
  thumbnail: string;
  hlsUrl: string;
  thumbnailAspectRatio: number | null;
  spriteAspectRatio: number | null;
  heroAspectRatio: number | null;
  spriteController: SpriteThumbnailHandle | null;
}

interface TransitionSnapshot {
  card: HomepageProjectCard;
  sourceRect: DOMRect;
  targetRect: DOMRect;
}

interface OpenProjectOptions {
  reason?: string;
  pushHistory?: boolean;
  historyMode?: 'none' | 'push' | 'replace';
  preferInstant?: boolean;
}

interface CloseProjectOptions {
  reason?: string;
  pushHistory?: boolean;
  historyMode?: 'none' | 'push' | 'replace';
  preferInstant?: boolean;
}

interface ReadyWaiter {
  requestedSlug: string | null;
  resolve: (slug: string | null) => void;
  timeoutId: number;
}

type FrameAwareVideoElement = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (...args: unknown[]) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

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

export class HomepageController implements HomepageRuntimeApi {
  private readonly listScene: HTMLElement;
  private readonly detailScene: HTMLElement;
  private readonly detailDate: HTMLElement;
  private readonly detailTitle: HTMLElement;
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
  private state: SceneState = 'idle:list';
  private transitionToken = 0;
  private activeTransitionToken: number | null = null;
  private activeAnimations: Animation[] = [];
  private activeFetchController: AbortController | null = null;
  private isDestroying = false;
  private isHandlingPopState = false;
  private activeHeroVideoReadyPromise: Promise<boolean> = Promise.resolve(false);
  private readonly boundOnClick = this.onClick.bind(this);
  private readonly boundOnKeyDown = this.onKeyDown.bind(this);
  private readonly boundOnPopState = this.onPopState.bind(this);

  constructor(options: HomepageControllerOptions) {
    this.listScene = options.listScene;
    this.detailScene = options.detailScene;
    this.detailDate = options.detailDate;
    this.detailTitle = options.detailTitle;
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
    this.ensureHistoryStateFromLocation();
    this.bootstrapInitialState();
  }

  destroy(): void {
    this.isDestroying = true;
    document.removeEventListener('click', this.boundOnClick, true);
    document.removeEventListener('keydown', this.boundOnKeyDown);
    window.removeEventListener('popstate', this.boundOnPopState);
    this.cancelInFlight();
    this.resetDetailContent();
    this.clearTransitionLayer();
    this.applyListSceneState({ activeSlug: null, dimmed: false });
    this.applyDetailSceneVisibility(false);
    this.setNavHidden(false);
    this.detailScene.setAttribute('aria-hidden', 'true');
    this.detailScene.dataset.sceneState = 'closed';
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
      card.openButton.setAttribute('data-open-project', resolvedNextSlug);
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
      this.replaceHistoryState(resolvedNextSlug, { preserveHash: true });
      this.flushReadyWaiters();
    }
  }

  private rebuildCardMap(): void {
    this.cardsBySlug.clear();
    const cards = this.listScene.querySelectorAll<HTMLElement>('[data-homepage-project-card]');
    cards.forEach((cardEl) => {
      const slug = cardEl.dataset.slug;
      if (!slug) return;

      const openButton = cardEl.querySelector<HTMLElement>('[data-open-project]');
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
        title: (cardEl.dataset.title || slug).trim(),
        formattedDate: (cardEl.dataset.formattedDate || '').trim(),
        thumbnail: (cardEl.dataset.thumbnail || '').trim(),
        hlsUrl: (cardEl.dataset.hlsUrl || '').trim(),
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
      void this.openProject(slug, {
        reason: 'user-open',
        pushHistory: true,
      });
      return;
    }

    const closeTrigger = target.closest<HTMLElement>('[data-close-detail]');
    if (closeTrigger && this.openSlug) {
      event.preventDefault();
      void this.closeProject({
        reason: 'user-close',
        pushHistory: true,
      });
      return;
    }

    const siteTitle = target.closest<HTMLAnchorElement>('a.site-title');
    if (!siteTitle || !this.openSlug) {
      return;
    }

    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    if (siteTitle.target && siteTitle.target !== '_self') {
      return;
    }

    let destination: URL;
    try {
      destination = new URL(siteTitle.href, window.location.origin);
    } catch {
      return;
    }
    if (destination.origin !== window.location.origin || destination.pathname !== '/') {
      return;
    }

    event.preventDefault();
    void this.closeProject({
      reason: 'site-title-close',
      pushHistory: true,
    });
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !this.openSlug) {
      return;
    }
    event.preventDefault();
    void this.closeProject({
      reason: 'escape',
      pushHistory: true,
    });
  }

  private onPopState(): void {
    this.isHandlingPopState = true;
    const targetSlug = this.extractSlugFromLocation();
    if (targetSlug && targetSlug === this.openSlug && this.state === 'open:detail') {
      this.syncHashScrollAfterNavigation(targetSlug);
      this.isHandlingPopState = false;
      return;
    }

    if (!targetSlug) {
      if (!this.openSlug) {
        this.isHandlingPopState = false;
        return;
      }
      void this.closeProject({
        reason: 'popstate-close',
        historyMode: 'none',
      }).finally(() => {
        this.isHandlingPopState = false;
      });
      return;
    }

    void this.openProject(targetSlug, {
      reason: 'popstate-open',
      historyMode: 'none',
    }).finally(() => {
      this.isHandlingPopState = false;
    });
  }

  private bootstrapInitialState(): void {
    const initialSlug = this.extractSlugFromLocation();
    if (!initialSlug) return;

    void this.openProject(initialSlug, {
      reason: 'initial-route',
      historyMode: 'replace',
      preferInstant: true,
    });
  }

  private ensureHistoryStateFromLocation(): void {
    const slug = this.extractSlugFromLocation();
    const currentState = window.history.state;
    if (currentState && currentState.homepage === true && currentState.slug === slug) {
      return;
    }
    window.history.replaceState({ homepage: true, slug }, '', window.location.href);
  }

  private extractSlugFromPathname(pathnameValue: string): string | null {
    const pathname = pathnameValue.replace(/\/+$/, '');
    if (!pathname || pathname === '/') return null;
    if (!pathname.startsWith('/')) return null;

    const slug = decodeURIComponent(pathname.slice(1)).trim();
    if (!slug || slug.includes('/')) return null;
    return slug;
  }

  private extractSlugFromLocation(): string | null {
    return this.extractSlugFromPathname(window.location.pathname);
  }

  private buildUrlForSlug(slug: string | null, options: { preserveHash?: boolean } = {}): string {
    const base = new URL('/', window.location.origin);
    const current = new URL(window.location.href);
    QUERY_KEEP_KEYS.forEach((key) => {
      const value = current.searchParams.get(key);
      if (value != null && value !== '') {
        base.searchParams.set(key, value);
      }
    });

    if (slug) {
      base.pathname = `/${encodeURIComponent(slug)}`;
      if (options.preserveHash && this.extractSlugFromPathname(current.pathname) === slug) {
        base.hash = current.hash;
      }
    }
    return base.toString();
  }

  private pushHistoryState(slug: string | null): void {
    const nextUrl = this.buildUrlForSlug(slug);
    if (window.location.href === nextUrl) return;
    window.history.pushState({ homepage: true, slug }, '', nextUrl);
  }

  private replaceHistoryState(slug: string | null, options: { preserveHash?: boolean } = {}): void {
    window.history.replaceState({ homepage: true, slug }, '', this.buildUrlForSlug(slug, options));
  }

  private getDetailScrollContainer(): HTMLElement | null {
    return this.detailScene.querySelector<HTMLElement>('.homepage-detail-scroll');
  }

  private scrollOpenDetailToTop(): void {
    const scrollContainer = this.getDetailScrollContainer();
    if (scrollContainer) {
      scrollContainer.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      return;
    }

    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }

  private syncHashScrollAfterNavigation(slug: string | null): void {
    if (!slug || this.extractSlugFromLocation() !== slug) {
      return;
    }

    const performScrollSync = (): void => {
      if (this.openSlug !== slug || this.state !== 'open:detail') {
        return;
      }

      if (window.location.hash) {
        scrollToHashTarget('auto');
        return;
      }

      this.scrollOpenDetailToTop();
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(performScrollSync);
    });
  }

  private beginTransition(): number {
    this.cancelInFlight();
    this.transitionToken += 1;
    this.activeTransitionToken = this.transitionToken;
    return this.transitionToken;
  }

  private isTokenActive(token: number): boolean {
    return token === this.transitionToken && !this.isDestroying;
  }

  private cancelInFlight(): void {
    this.cancelRunningAnimations();
    this.abortActiveFetch();
    this.clearTransitionLayer();
    this.activeTransitionToken = null;
  }

  private abortActiveFetch(): void {
    this.activeFetchController?.abort();
    this.activeFetchController = null;
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
  }

  private markTargetVisibility(hidden: boolean): void {
    this.detailHeroFrame.classList.toggle('homepage-target-hidden', hidden);
  }

  private clearTransitionLayer(): void {
    this.transitionLayer.classList.remove('homepage-active');
    this.transitionLayer.style.left = '0px';
    this.transitionLayer.style.top = '0px';
    this.transitionLayer.style.width = '0px';
    this.transitionLayer.style.height = '0px';
    this.transitionLayer.style.transform = 'none';
    this.transitionLayer.style.opacity = '0';
    this.transitionLayer.innerHTML = '';
  }

  private resetDetailContent(): void {
    this.cleanupMountedDetail();
    this.teardownHeroVideo();
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
    this.detailScene.dataset.openProjectSlug = resolvedSlug;
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

  private async fadeOutHeroBridge(token: number, durationMs: number = HERO_BRIDGE_FADE_MS): Promise<void> {
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
    if (!this.isTokenActive(token)) return;
    bridge.remove();
  }

  private async revealHeroVideoWhenReady(card: HomepageProjectCard, token: number, frameIndex: number): Promise<void> {
    if (!this.isTokenActive(token)) return;
    const video = this.detailHeroMedia.querySelector('video');
    if (!video) {
      this.clearHeroBridge();
      return;
    }

    this.installHeroBridge(card, frameIndex);
    const isReady = await this.activeHeroVideoReadyPromise.catch(() => false);
    if (!this.isTokenActive(token)) return;
    if (!isReady) {
      this.clearHeroBridge();
      return;
    }

    await this.fadeOutHeroBridge(token);
  }

  private createTransitionNode(card: HomepageProjectCard, sourceRect: DOMRect, frameIndex: number): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'homepage-transition-visual';
    const previewWidth = Math.max(1, Math.round(sourceRect.width || card.thumbFrame.clientWidth || 1));
    const previewHeight = Math.max(1, Math.round(sourceRect.height || card.thumbFrame.clientHeight || 1));
    wrapper.appendChild(this.createCardPreviewNode(card, {
      frameIndex,
      className: 'homepage-transition-media-layer',
      width: previewWidth,
      height: previewHeight,
    }));
    return wrapper;
  }

  private mountTransitionLayer(node: HTMLElement, rect: DOMRect): void {
    this.transitionLayer.innerHTML = '';
    this.transitionLayer.appendChild(node);
    this.transitionLayer.style.left = `${rect.left}px`;
    this.transitionLayer.style.top = `${rect.top}px`;
    this.transitionLayer.style.width = `${rect.width}px`;
    this.transitionLayer.style.height = `${rect.height}px`;
    this.transitionLayer.style.transform = 'translate3d(0px, 0px, 0px) scale(1, 1)';
    this.transitionLayer.style.opacity = '1';
    this.transitionLayer.classList.add('homepage-active');
  }

  private buildMorphKeyframes(sourceRect: DOMRect, targetRect: DOMRect): Keyframe[] {
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

  private async runMorphAnimation(options: {
    sourceRect: DOMRect;
    targetRect: DOMRect;
    durationMs: number;
    token: number;
  }): Promise<void> {
    if (!this.isTokenActive(options.token)) return;

    const animation = this.trackAnimation(
      this.transitionLayer.animate(this.buildMorphKeyframes(options.sourceRect, options.targetRect), {
        duration: options.durationMs,
        easing: EASING_STANDARD,
        fill: 'forwards',
      })
    );
    await waitForAnimationFinish(animation);
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

    return { card, sourceRect, targetRect };
  }

  private measureCloseSnapshot(slug: string): TransitionSnapshot | null {
    const card = this.cardsBySlug.get(slug);
    if (!card) return null;

    const targetRect = card.thumbFrame.getBoundingClientRect();
    const sourceRect = this.detailHeroFrame.getBoundingClientRect();
    if (sourceRect.width < 1 || sourceRect.height < 1 || targetRect.width < 1 || targetRect.height < 1) {
      return null;
    }

    return { card, sourceRect, targetRect };
  }

  private async fetchDetailsHtml(slug: string, token: number): Promise<string> {
    const cached = this.detailsHtmlCache.get(slug);
    if (cached) {
      return cached;
    }

    this.abortActiveFetch();

    const projectUrl = new URL(`/${slug}`, window.location.origin);
    projectUrl.searchParams.set('_partial', '1');
    const showDrafts = new URL(window.location.href).searchParams.get('show_drafts');
    if (showDrafts === 'true') {
      projectUrl.searchParams.set('show_drafts', 'true');
    }

    const controller = new AbortController();
    this.activeFetchController = controller;

    try {
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
      if (!this.isTokenActive(token)) {
        return '';
      }

      this.detailsHtmlCache.set(slug, html);
      return html;
    } finally {
      if (this.activeFetchController === controller) {
        this.activeFetchController = null;
      }
    }
  }

  private teardownHeroVideo(): void {
    const video = this.detailHeroMedia.querySelector<HTMLVideoElement>('video');
    if (video) {
      try {
        video.pause();
      } catch {
        // Ignore pause failures during teardown.
      }
      projectDetailRuntime.destroyHeroVideo(video);
    }
  }

  private hydrateMountedDetail(): void {
    projectDetailRuntime.hydrateDetail(this.detailScene);
  }

  private cleanupMountedDetail(): void {
    projectDetailRuntime.cleanupDetail(this.detailScene);
  }

  private async setupHeroVideo(slug: string): Promise<void> {
    const video = this.detailHeroMedia.querySelector<HTMLVideoElement>('video');
    if (!video) return;

    const card = this.cardsBySlug.get(slug);
    if (card?.thumbnail && !video.poster) {
      video.poster = card.thumbnail;
    }
    await projectDetailRuntime.setupHeroVideo(video, false);
  }

  private waitForFirstVideoFrame(video: FrameAwareVideoElement, token: number, timeoutMs: number = 7000): Promise<boolean> {
    return new Promise((resolve, reject) => {
      let finished = false;
      let frameCallbackId: number | null = null;
      let tokenWatcherId: number | null = null;

      const finish = (ok: boolean, error?: unknown): void => {
        if (finished) return;
        finished = true;
        clearTimeout(timeoutId);
        if (tokenWatcherId !== null) {
          clearInterval(tokenWatcherId);
        }
        video.removeEventListener('loadeddata', onMaybeReady);
        video.removeEventListener('canplay', onMaybeReady);
        video.removeEventListener('playing', onMaybeReady);
        video.removeEventListener('timeupdate', onMaybeReady);
        video.removeEventListener('error', onError);
        if (frameCallbackId !== null) {
          video.cancelVideoFrameCallback?.(frameCallbackId);
        }
        if (ok) {
          resolve(true);
        } else {
          reject(error || new Error('Video did not render a first frame in time'));
        }
      };

      const onMaybeReady = (): void => {
        if (!this.isTokenActive(token)) {
          finish(false, new Error('Transition cancelled'));
          return;
        }
        if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
          finish(true);
        }
      };

      const onError = (): void => {
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

      if (video.requestVideoFrameCallback) {
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

  private async prepareHeroVideo(slug: string, token: number): Promise<boolean> {
    const video = this.detailHeroMedia.querySelector<FrameAwareVideoElement>('video');
    if (!video) {
      return false;
    }

    try {
      await this.setupHeroVideo(slug);
      if (!this.isTokenActive(token)) return false;
      await this.waitForFirstVideoFrame(video, token, 7000);
      this.detailHeroFrame.style.setProperty('--homepage-fallback-poster', 'none');
      return this.isTokenActive(token);
    } catch (error) {
      if (this.isTokenActive(token)) {
        console.warn('Hero video was not ready before reveal window:', error);
      }
      return false;
    }
  }

  private async mountDetail(slug: string, token: number, frameIndex: number): Promise<void> {
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

    const html = await this.fetchDetailsHtml(slug, token);
    if (!this.isTokenActive(token)) return;

    const parser = document.createElement('div');
    parser.innerHTML = html;

    const heroNode = parser.querySelector<HTMLElement>('.video-container');
    if (heroNode) {
      heroNode.removeAttribute('id');
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

    this.hydrateMountedDetail();
    this.activeHeroVideoReadyPromise = this.prepareHeroVideo(slug, token);
  }

  async openProject(slug: string, options: OpenProjectOptions = {}): Promise<void> {
    const card = this.cardsBySlug.get(slug);
    if (!card) return;

    const historyMode = options.historyMode || (options.pushHistory ? 'push' : 'none');
    const preferInstant = options.preferInstant === true;

    if (this.openSlug === slug && this.state === 'open:detail') {
      if (historyMode === 'push') this.pushHistoryState(slug);
      if (historyMode === 'replace') this.replaceHistoryState(slug, { preserveHash: true });
      this.syncHashScrollAfterNavigation(slug);
      return;
    }

    if (this.openSlug && this.openSlug !== slug) {
      await this.closeProject({
        reason: `switch:${this.openSlug}->${slug}`,
        historyMode: 'none',
      });
    }

    if (!this.openSlug) {
      this.lastFocusedBeforeOpen = document.activeElement;
    }

    const token = this.beginTransition();
    this.state = 'opening:measure';
    this.detailScene.dataset.sceneState = this.state;
    const transitionFrameIndex = this.getTransitionFrameIndex(card);

    try {
      await this.mountDetail(slug, token, transitionFrameIndex);
      if (!this.isTokenActive(token)) return;

      const snapshot = this.measureOpenSnapshot(slug);
      card.spriteController?.freeze();
      this.setNavHidden(true);
      this.applyListSceneState({ activeSlug: slug, dimmed: true });
      this.applyDetailSceneVisibility(true);
      this.markSourceVisibility(card, true);
      this.markTargetVisibility(true);

      if (!snapshot || preferInstant || shouldUseReducedMotion()) {
        this.commitOpen(token, slug, historyMode, transitionFrameIndex);
        return;
      }

      this.state = 'opening:animate';
      this.detailScene.dataset.sceneState = this.state;
      this.mountTransitionLayer(
        this.createTransitionNode(card, snapshot.sourceRect, transitionFrameIndex),
        snapshot.sourceRect
      );
      await this.runMorphAnimation({
        sourceRect: snapshot.sourceRect,
        targetRect: snapshot.targetRect,
        durationMs: OPEN_DURATION_MS,
        token,
      });
      if (!this.isTokenActive(token)) return;

      this.commitOpen(token, slug, historyMode, transitionFrameIndex);
    } catch (error) {
      if (!this.isTokenActive(token)) return;
      console.error('Failed to open homepage project detail:', error);
      this.rollbackToList();
    }
  }

  private commitOpen(token: number, slug: string, historyMode: 'none' | 'push' | 'replace', frameIndex: number): void {
    if (!this.isTokenActive(token)) return;

    const card = this.cardsBySlug.get(slug);
    if (!card) return;

    this.clearTransitionLayer();
    this.markTargetVisibility(false);
    this.detailScene.classList.add('homepage-visible');
    this.detailScene.dataset.sceneState = 'open:detail';
    this.openSlug = slug;
    this.syncSceneProjectSlug(slug);
    this.state = 'open:detail';
    this.flushReadyWaiters();

    void this.revealHeroVideoWhenReady(card, token, frameIndex);

    this.detailScene.querySelector<HTMLElement>('.homepage-close-button')?.focus({ preventScroll: true });

    if (historyMode === 'push' && !this.isHandlingPopState) {
      this.pushHistoryState(slug);
    } else if (historyMode === 'replace') {
      this.replaceHistoryState(slug, { preserveHash: true });
    }

    this.syncHashScrollAfterNavigation(slug);

    if (this.activeTransitionToken === token) {
      this.activeTransitionToken = null;
    }
  }

  async closeProject(options: CloseProjectOptions = {}): Promise<void> {
    if (!this.openSlug) {
      return;
    }

    const slug = this.openSlug;
    const card = this.cardsBySlug.get(slug);
    const historyMode = options.historyMode || (options.pushHistory ? 'push' : 'none');
    const preferInstant = options.preferInstant === true;

    if (!card) {
      this.rollbackToList();
      if (historyMode === 'push') this.pushHistoryState(null);
      if (historyMode === 'replace') this.replaceHistoryState(null);
      return;
    }

    const token = this.beginTransition();
    this.state = 'closing:measure';
    this.detailScene.dataset.sceneState = this.state;

    try {
      const snapshot = this.measureCloseSnapshot(slug);
      this.markSourceVisibility(card, true);
      this.markTargetVisibility(true);
      this.applyDetailSceneVisibility(false);

      if (!snapshot || preferInstant || shouldUseReducedMotion()) {
        this.commitClose(token, historyMode);
        return;
      }

      this.state = 'closing:animate';
      this.detailScene.dataset.sceneState = this.state;
      this.mountTransitionLayer(
        this.createTransitionNode(card, snapshot.sourceRect, this.getTransitionFrameIndex(card)),
        snapshot.sourceRect
      );
      await this.runMorphAnimation({
        sourceRect: snapshot.sourceRect,
        targetRect: snapshot.targetRect,
        durationMs: CLOSE_DURATION_MS,
        token,
      });
      if (!this.isTokenActive(token)) return;

      this.commitClose(token, historyMode);
    } catch (error) {
      if (!this.isTokenActive(token)) return;
      console.error('Failed to close homepage project detail:', error);
      this.rollbackToList();
    }
  }

  private commitClose(token: number, historyMode: 'none' | 'push' | 'replace'): void {
    if (!this.isTokenActive(token)) return;

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
    this.state = 'idle:list';
    this.detailScene.dataset.sceneState = 'closed';
    this.flushReadyWaiters(true);

    if (this.lastFocusedBeforeOpen instanceof HTMLElement) {
      this.lastFocusedBeforeOpen.focus({ preventScroll: true });
    } else {
      previousCard?.openButton.focus?.({ preventScroll: true });
    }
    this.lastFocusedBeforeOpen = null;

    if (historyMode === 'push' && !this.isHandlingPopState) {
      this.pushHistoryState(null);
    } else if (historyMode === 'replace') {
      this.replaceHistoryState(null);
    }

    if (this.activeTransitionToken === token) {
      this.activeTransitionToken = null;
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
    this.state = 'idle:list';
    this.detailScene.dataset.sceneState = 'closed';
    this.activeTransitionToken = null;
    this.flushReadyWaiters(true);
  }

  private getReadySlug(): string | null {
    if (this.state !== 'open:detail' || !this.openSlug) {
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

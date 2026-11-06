import { isEditingActive } from '../core/edit-state';
import { prefersReducedMotion } from '../core/reduced-motion';
import type { HomepageRuntimeApi } from '../core/runtime-registry';
import { syncDetailScroll } from '../project/detail-runtime';
import { readProjectCards, type ProjectCard } from './card';
import { DetailLoader } from './detail-loader';
import { measureFlight, TransitionFlight } from './flight';
import { currentProjectSlug, pushProjectUrl, replaceProjectUrl } from './history';
import { HomepageSpriteRuntime } from './sprite-runtime';

const OPEN_DURATION_MS = 340;
const CLOSE_DURATION_MS = 300;

type SceneState = 'closed' | 'opening' | 'open' | 'closing';
type HistoryMode = 'none' | 'push' | 'replace';

interface ReadyWaiter {
  slug: string;
  resolve: (slug: string | null) => void;
}

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Homepage markup is missing #${id}`);
  return element;
}

/**
 * The homepage's one scene machine: a list of cards and a detail scene that
 * opens over it, driven by clicks, Escape, and the URL. Each open or close is a
 * transition with its own AbortSignal; starting another aborts it.
 */
export class HomepageController implements HomepageRuntimeApi {
  private readonly listScene = requireElement('homepage-list-scene');
  private readonly detailScene = requireElement('homepage-detail-scene');
  private readonly detailHeroFrame = requireElement('homepage-detail-hero-frame');
  private readonly detailHeading = requireElement('homepage-detail-title').closest<HTMLElement>('.homepage-detail-heading')!;
  private readonly detailScroll = this.detailScene.querySelector<HTMLElement>('.homepage-detail-scroll')!;
  private readonly detail = new DetailLoader({
    detailScene: this.detailScene,
    detailDate: requireElement('homepage-detail-date'),
    detailTitle: requireElement('homepage-detail-title'),
    detailHeroFrame: this.detailHeroFrame,
    detailHeroMedia: requireElement('homepage-detail-hero-media'),
    detailContent: requireElement('homepage-detail-content'),
  });
  private readonly flight = new TransitionFlight(requireElement('homepage-transition-layer'));
  private readonly cardsBySlug = new Map<string, ProjectCard>();
  private readonly readyWaiters = new Set<ReadyWaiter>();
  private sprites: HomepageSpriteRuntime | null = null;
  private openSlug: string | null = null;
  private openingSlug: string | null = null;
  private lastFocusedBeforeOpen: Element | null = null;
  private state: SceneState = 'closed';
  private transition = new AbortController();
  private readonly boundOnClick = this.onClick.bind(this);
  private readonly boundOnKeyDown = this.onKeyDown.bind(this);
  private readonly boundOnPopState = this.onPopState.bind(this);

  init(): void {
    const cards = readProjectCards(this.listScene);
    cards.forEach((card) => this.cardsBySlug.set(card.slug, card));
    this.sprites = new HomepageSpriteRuntime(cards.map((card) => card.thumbnail));
    this.sprites.init();

    document.addEventListener('click', this.boundOnClick, true);
    document.addEventListener('keydown', this.boundOnKeyDown);
    window.addEventListener('popstate', this.boundOnPopState);

    const initialSlug = currentProjectSlug();
    if (initialSlug) {
      void this.openProject(initialSlug, 'replace');
    }
  }

  destroy(): void {
    document.removeEventListener('click', this.boundOnClick, true);
    document.removeEventListener('keydown', this.boundOnKeyDown);
    window.removeEventListener('popstate', this.boundOnPopState);
    this.resetToList();
    this.sprites?.destroy();
    this.sprites = null;
  }

  getOpenProjectSlug(): string | null {
    return this.openSlug ?? this.openingSlug;
  }

  waitForProjectReady(slug: string): Promise<string | null> {
    if (this.state === 'closed' || this.state === 'open') {
      return Promise.resolve(this.isReadySlug(slug) ? slug : null);
    }
    return new Promise((resolve) => this.readyWaiters.add({ slug, resolve }));
  }

  renameProjectSlug(nextSlug: string): void {
    replaceProjectUrl(nextSlug);
  }

  private onClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const slug = target.closest('[data-open-project]')?.getAttribute('data-open-project');
    if (slug) {
      event.preventDefault();
      void this.openProject(slug, 'push');
    } else if (target.closest('[data-close-detail]') && this.openSlug) {
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
    const slug = currentProjectSlug();
    if (slug) {
      void this.openProject(slug, 'none');
    } else {
      void this.closeProject('none');
    }
  }

  private async openProject(slug: string, historyMode: HistoryMode): Promise<void> {
    const card = this.cardsBySlug.get(slug);
    if (!card) return;

    if (this.openSlug === slug && this.state === 'open') {
      this.recordOpenUrl(slug, historyMode);
      this.syncScrollAfterNavigation(slug);
      return;
    }

    if (this.openSlug && this.openSlug !== slug) {
      await this.closeProject('none');
    }

    if (!this.openSlug) {
      this.lastFocusedBeforeOpen = document.activeElement;
    }

    this.openingSlug = slug;
    const signal = this.beginTransition('opening');
    const frameIndex = card.thumbnail.getCurrentFrameIndex();

    try {
      await this.detail.mount(card, frameIndex, signal);
      if (signal.aborted) return;

      const path = measureFlight(
        { frame: card.thumbFrame, heading: card.heading },
        { frame: this.detailHeroFrame, heading: this.detailHeading }
      );
      card.thumbnail.freeze();
      this.setNavHidden(true);
      this.setListDimmed(card);
      this.setDetailVisible(true);
      this.setSourceHidden(card, true);
      this.setTargetHidden(true);

      // A direct entry (replace) has no list on screen to fly from.
      if (path && historyMode !== 'replace' && !prefersReducedMotion()) {
        await this.flight.run(path, card.thumbnail, frameIndex, OPEN_DURATION_MS, signal);
        if (signal.aborted) return;
      }

      this.setTargetHidden(false);
      this.openSlug = slug;
      this.openingSlug = null;
      this.state = 'open';
      this.settleReadyWaiters();
      this.detail.revealHero(card, frameIndex, signal);
      this.detailScene.querySelector<HTMLElement>('.homepage-close-button')?.focus({ preventScroll: true });
      this.recordOpenUrl(slug, historyMode);
      this.syncScrollAfterNavigation(slug);
    } catch (error) {
      if (signal.aborted) return;
      console.error('Failed to open homepage project detail:', error);
      this.resetToList();
    }
  }

  private async closeProject(historyMode: 'none' | 'push'): Promise<void> {
    const card = this.openSlug ? this.cardsBySlug.get(this.openSlug) : null;
    if (!card) return;

    const signal = this.beginTransition('closing');
    const path = measureFlight(
      { frame: this.detailHeroFrame, heading: this.detailHeading },
      { frame: card.thumbFrame, heading: card.heading }
    );
    this.setSourceHidden(card, true);
    this.setTargetHidden(true);
    this.setDetailVisible(false);

    if (path && !prefersReducedMotion()) {
      await this.flight.run(path, card.thumbnail, card.thumbnail.getCurrentFrameIndex(), CLOSE_DURATION_MS, signal);
      if (signal.aborted) return;
    }

    this.resetToList();

    if (this.lastFocusedBeforeOpen instanceof HTMLElement) {
      this.lastFocusedBeforeOpen.focus({ preventScroll: true });
    } else {
      card.openButton.focus({ preventScroll: true });
    }
    this.lastFocusedBeforeOpen = null;

    if (historyMode === 'push') {
      pushProjectUrl(null);
    }
  }

  /** The one way back to the idle list: after a close, a failed open, or on destroy. */
  private resetToList(): void {
    this.transition.abort();
    this.flight.cancel();
    this.detail.reset();
    this.setTargetHidden(false);
    this.setDetailVisible(false);
    this.setListDimmed(null);
    this.setNavHidden(false);
    this.cardsBySlug.forEach((card) => {
      this.setSourceHidden(card, false);
      card.thumbnail.unfreeze();
      card.thumbnail.refresh();
    });
    this.openSlug = null;
    this.openingSlug = null;
    this.state = 'closed';
    this.settleReadyWaiters();
  }

  private beginTransition(state: SceneState): AbortSignal {
    this.transition.abort();
    this.flight.cancel();
    this.transition = new AbortController();
    this.state = state;
    return this.transition.signal;
  }

  private recordOpenUrl(slug: string, historyMode: HistoryMode): void {
    if (historyMode === 'push') {
      pushProjectUrl(slug);
    } else if (historyMode === 'replace') {
      replaceProjectUrl(slug, { preserveHash: true });
    }
  }

  private syncScrollAfterNavigation(slug: string): void {
    if (currentProjectSlug() !== slug) {
      return;
    }

    // Two frames: the first lays out the newly visible detail, so targets have their final position.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (this.openSlug === slug && this.state === 'open') {
          syncDetailScroll(this.detailScroll);
        }
      });
    });
  }

  private setListDimmed(activeCard: ProjectCard | null): void {
    this.listScene.classList.toggle('homepage-list-dimmed', activeCard !== null);
    this.cardsBySlug.forEach((card) => {
      card.cardEl.classList.toggle('homepage-active-card', card === activeCard);
    });
  }

  private setDetailVisible(visible: boolean): void {
    this.detailScene.classList.toggle('homepage-visible', visible);
    this.detailScene.setAttribute('aria-hidden', visible ? 'false' : 'true');
    this.listScene.inert = visible;
  }

  private setNavHidden(hidden: boolean): void {
    document.body.classList.toggle('homepage-nav-hidden', hidden);
  }

  private setSourceHidden(card: ProjectCard, hidden: boolean): void {
    card.thumbFrame.classList.toggle('homepage-source-hidden', hidden);
    card.heading?.classList.toggle('homepage-source-hidden', hidden);
  }

  private setTargetHidden(hidden: boolean): void {
    this.detailHeroFrame.classList.toggle('homepage-target-hidden', hidden);
    this.detailHeading.classList.toggle('homepage-target-hidden', hidden);
  }

  private isReadySlug(slug: string): boolean {
    return this.state === 'open' && slug === this.openSlug && this.detail.hasMountedContent();
  }

  /** Called whenever the scene comes to rest, open or closed: every waiter gets its answer. */
  private settleReadyWaiters(): void {
    this.readyWaiters.forEach((waiter) => waiter.resolve(this.isReadySlug(waiter.slug) ? waiter.slug : null));
    this.readyWaiters.clear();
  }
}

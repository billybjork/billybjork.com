import { cleanupProjectDetail, hydrateProjectDetail, prepareHeroVideo } from '../project/detail-runtime';
import type { ProjectCard } from './card';
import { coverHeroUntilReady } from './flight';

interface DetailElements {
  detailScene: HTMLElement;
  detailDate: HTMLElement;
  detailTitle: HTMLElement;
  detailHeroFrame: HTMLElement;
  detailHeroMedia: HTMLElement;
  detailContent: HTMLElement;
}

/** Fetches a project's detail fragment and mounts it into the detail scene. */
export class DetailLoader {
  private readonly el: DetailElements;
  private readonly htmlCache = new Map<string, string>();
  private heroReady: Promise<boolean> = Promise.resolve(false);

  constructor(elements: DetailElements) {
    this.el = elements;
  }

  /** Shows the card's title and poster at once, then fills in the fetched detail. */
  async mount(card: ProjectCard, frameIndex: number, signal: AbortSignal): Promise<void> {
    this.reset();
    const heroFrameStyle = this.el.detailHeroFrame.style;
    heroFrameStyle.setProperty('--homepage-hero-aspect', card.heroAspectRatio.toString());
    if (card.thumbnailUrl) {
      heroFrameStyle.setProperty('--homepage-fallback-poster', `url("${card.thumbnailUrl.replace(/"/g, '\\"')}")`);
    }
    this.el.detailDate.textContent = card.formattedDate;
    this.el.detailTitle.textContent = card.title;
    this.setEditTarget(card.slug);

    const html = await this.fetchHtml(card.slug, signal);
    if (signal.aborted) return;

    const fragment = document.createElement('div');
    fragment.innerHTML = html;

    this.el.detailHeroMedia.appendChild(
      fragment.querySelector('.video-container')
        ?? card.thumbnail.createFrameNode(frameIndex, { className: 'homepage-detail-fallback-media' })
    );

    const content = fragment.querySelector('.project-content');
    if (content) {
      this.el.detailContent.appendChild(content);
    } else {
      const unavailable = document.createElement('p');
      unavailable.textContent = 'Project details unavailable.';
      this.el.detailContent.appendChild(unavailable);
    }

    hydrateProjectDetail(this.el.detailScene);
    this.startHeroVideo(card, signal);
  }

  /** Called once the flight has landed; the video may still be loading underneath. */
  revealHero(card: ProjectCard, frameIndex: number, signal: AbortSignal): void {
    if (this.el.detailHeroMedia.querySelector('video')) {
      void coverHeroUntilReady(this.el.detailHeroFrame, card.thumbnail, frameIndex, this.heroReady, signal);
    }
  }

  reset(): void {
    cleanupProjectDetail(this.el.detailScene);
    this.el.detailHeroFrame.querySelector('.homepage-hero-bridge')?.remove();
    this.heroReady = Promise.resolve(false);
    this.el.detailHeroMedia.innerHTML = '';
    this.el.detailContent.innerHTML = '';
    this.el.detailDate.textContent = '';
    this.el.detailTitle.textContent = '';
    this.el.detailHeroFrame.style.removeProperty('--homepage-fallback-poster');
    this.el.detailHeroFrame.style.removeProperty('--homepage-hero-aspect');
    this.setEditTarget(null);
  }

  hasMountedContent(): boolean {
    return this.el.detailContent.querySelector('.project-content') !== null;
  }

  renameCached(previousSlug: string, nextSlug: string): void {
    const cached = this.htmlCache.get(previousSlug);
    if (cached) {
      this.htmlCache.delete(previousSlug);
      this.htmlCache.set(nextSlug, cached);
    }
  }

  /** Edit mode reads which project to open from the edit button. */
  setEditTarget(slug: string | null): void {
    const editButton = this.el.detailScene.querySelector<HTMLElement>('[data-homepage-edit-project]');
    if (editButton) {
      editButton.dataset.projectSlug = slug ?? '';
    }
  }

  private async fetchHtml(slug: string, signal: AbortSignal): Promise<string> {
    const cached = this.htmlCache.get(slug);
    if (cached) {
      return cached;
    }

    const url = new URL(`/${slug}`, window.location.origin);
    url.searchParams.set('_partial', '1');
    if (new URL(window.location.href).searchParams.get('show_drafts') === 'true') {
      url.searchParams.set('show_drafts', 'true');
    }

    const response = await fetch(url.toString(), { signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch project detail (${response.status})`);
    }

    const html = await response.text();
    this.htmlCache.set(slug, html);
    return html;
  }

  private startHeroVideo(card: ProjectCard, signal: AbortSignal): void {
    const video = this.el.detailHeroMedia.querySelector('video');
    if (!video) return;

    if (card.thumbnailUrl && !video.poster) {
      video.poster = card.thumbnailUrl;
    }
    this.heroReady = prepareHeroVideo(video, signal).then((ready) => {
      if (ready) {
        this.el.detailHeroFrame.style.setProperty('--homepage-fallback-poster', 'none');
      }
      return ready;
    });
  }
}

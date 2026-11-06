import { expect, vi } from 'vitest';

import contract from '../fixtures/frontend-contract.json';
import { HomepageController } from '../../static/ts/homepage/controller';

export const DETAIL_RESPONSE_HTML = `
  <section class="video-container"></section>
  <section class="project-content">
    <div class="content-block"><h2 id="section-one">Section One</h2></div>
    <div class="content-block"><h2 id="section-two">Section Two</h2></div>
  </section>
`;

export const FULL_DETAIL_HTML = `
  <section class="video-container" id="hero">
    <video data-hls-url="/video.m3u8" data-video-width="1280" data-video-height="720"></video>
  </section>
  <section class="project-content">
    <p>Body</p>
    <video class="lazy-inline-video" data-src="/inline.mp4" loop muted></video>
    <div class="html-block-sandbox" data-html-b64="PHA+SGk8L3A+"></div>
    <button class="copy-text-link" data-copy-text="http://localhost/project-one"></button>
  </section>
`;

// The fixture mounts the page body; base.html's stylesheets and scripts are checked against the real render.
const PAGE_ASSET = /^head |^script/;

function expectContract(root: ParentNode, selectors: string[]): void {
  selectors.forEach((selector) => {
    expect(root.querySelector(selector), selector).not.toBeNull();
  });
}

export function createHomepageFixture(): {
  controller: HomepageController;
  detailScene: HTMLElement;
  detailContent: HTMLElement;
  openButton: HTMLButtonElement;
  closeButton: HTMLButtonElement;
  editButton: HTMLButtonElement;
} {
  document.body.innerHTML = `
    <header id="main-header">
      <h1><a href="/" class="site-title">Billy Bjork</a></h1>
      <nav></nav>
    </header>
    <div class="homepage-list-scene" id="homepage-list-scene">
      <ul class="homepage-project-list">
        <li>
          <article
            class="homepage-project-card"
            data-homepage-project-card
            data-slug="project-one"
            data-title="Project One"
            data-formatted-date="2024"
            data-sprite-sheet="/sprite.webp"
            data-frames="6"
            data-columns="3"
            data-rows="2"
            data-sprite-aspect-ratio="1.7777778"
            data-hero-aspect-ratio="1.7777778"
            data-thumbnail="/thumb.webp">
            <header class="homepage-card-heading" data-open-project="project-one">
              <time class="homepage-card-date">2024</time>
              <h2 class="homepage-card-title">Project One</h2>
            </header>
            <button class="homepage-open-button" type="button" data-open-project="project-one">
              <span class="homepage-thumb-frame" data-homepage-thumb-frame>
                <span class="homepage-thumb-media" data-homepage-thumb-media>
                  <img class="homepage-thumb-image" src="/thumb.webp" alt="">
                </span>
              </span>
            </button>
          </article>
        </li>
        <li>
          <article
            class="homepage-project-card"
            data-homepage-project-card
            data-slug="project-two"
            data-title="Project Two"
            data-formatted-date="2023"
            data-hero-aspect-ratio="0.5625"
            data-thumbnail="/thumb-two.webp">
            <header class="homepage-card-heading" data-open-project="project-two">
              <time class="homepage-card-date">2023</time>
              <h2 class="homepage-card-title">Project Two</h2>
            </header>
            <button class="homepage-open-button" type="button" data-open-project="project-two">
              <span class="homepage-thumb-frame" data-homepage-thumb-frame>
                <span class="homepage-thumb-media" data-homepage-thumb-media>
                  <img class="homepage-thumb-image" src="/thumb-two.webp" alt="">
                </span>
              </span>
            </button>
          </article>
        </li>
      </ul>
    </div>
    <section
      class="homepage-detail-scene"
      id="homepage-detail-scene"
      aria-hidden="true">
      <div class="homepage-detail-backdrop"></div>
      <div class="homepage-detail-scroll">
        <article class="homepage-detail-shell">
          <header class="homepage-detail-header">
            <div class="homepage-detail-heading">
              <time class="homepage-detail-date" id="homepage-detail-date"></time>
              <h2 class="homepage-detail-title" id="homepage-detail-title"></h2>
            </div>
            <div class="homepage-detail-actions edit-buttons">
              <button type="button" data-homepage-edit-project></button>
              <button class="homepage-close-button" type="button" data-close-detail>Close</button>
            </div>
          </header>
          <div id="homepage-detail-hero-frame">
            <div id="homepage-detail-hero-media"></div>
          </div>
          <section id="homepage-detail-content"></section>
        </article>
      </div>
    </section>
    <div id="homepage-transition-layer" class="homepage-transition-layer"></div>
  `;

  expectContract(document, [...contract.homepage, ...contract.homepageForEditors.filter((selector) => !PAGE_ASSET.test(selector))]);
  const fullDetail = document.createElement('div');
  fullDetail.innerHTML = FULL_DETAIL_HTML;
  expectContract(fullDetail, contract.detailFragment);

  const controller = new HomepageController();
  const detailScene = document.getElementById('homepage-detail-scene') as HTMLElement;
  const detailContent = document.getElementById('homepage-detail-content') as HTMLElement;

  const openButton = document.querySelector<HTMLButtonElement>('button[data-open-project="project-one"]');
  const closeButton = detailScene.querySelector<HTMLButtonElement>('.homepage-close-button');
  const editButton = detailScene.querySelector<HTMLButtonElement>('[data-homepage-edit-project]');
  if (!openButton || !closeButton || !editButton) {
    throw new Error('Failed to resolve homepage control nodes');
  }

  return {
    controller,
    detailScene,
    detailContent,
    openButton,
    closeButton,
    editButton,
  };
}

export function isDetailOpen(detailScene: HTMLElement): boolean {
  return detailScene.classList.contains('homepage-visible') && detailScene.getAttribute('aria-hidden') === 'false';
}

export function stubDetailFetch(html: string = DETAIL_RESPONSE_HTML) {
  const fetchMock = vi.fn(async () => ({ ok: true, text: async () => html }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export function navigateBack(url: string): void {
  window.history.replaceState(window.history.state, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export class FakeHls {
  static Events = { MANIFEST_PARSED: 'manifest-parsed', FRAG_LOADED: 'frag-loaded', ERROR: 'error' };
  static ErrorTypes = { NETWORK_ERROR: 'network', MEDIA_ERROR: 'media' };
  static instances: FakeHls[] = [];
  static isSupported = (): boolean => true;

  levels: unknown[] = [];
  startLevel = -1;
  destroyed = false;
  startLoads = 0;
  mediaRecoveries = 0;
  /** Stands in for a server with nothing to play: the manifest never parses. */
  static manifestLoads = true;
  private readonly handlers = new Map<string, (event: string, data: unknown) => void>();

  constructor() {
    FakeHls.instances.push(this);
  }

  on(event: string, handler: (event: string, data: unknown) => void): void {
    this.handlers.set(event, handler);
  }

  emit(event: string, data?: unknown): void {
    this.handlers.get(event)?.(event, data);
  }

  startLoad(): void {
    this.startLoads += 1;
  }

  recoverMediaError(): void {
    this.mediaRecoveries += 1;
  }

  loadSource(): void {}

  attachMedia(): void {
    if (FakeHls.manifestLoads) queueMicrotask(() => this.emit(FakeHls.Events.MANIFEST_PARSED));
  }

  destroy(): void {
    this.destroyed = true;
  }
}

export async function flushAsyncWork(iterations: number = 6): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
}

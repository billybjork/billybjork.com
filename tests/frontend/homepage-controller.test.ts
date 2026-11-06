import { afterEach, describe, expect, it, vi } from 'vitest';

import { HomepageController } from '../../static/ts/homepage/controller';

const DETAIL_RESPONSE_HTML = `
  <section class="video-container"></section>
  <section class="project-content">
    <div class="content-block"><h2 id="section-one">Section One</h2></div>
    <div class="content-block"><h2 id="section-two">Section Two</h2></div>
  </section>
`;

function createHomepageFixture(): {
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
            data-frame-width="320"
            data-frame-height="180"
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
      aria-hidden="true"
      data-scene-state="closed"
      data-open-project-slug="">
      <div class="homepage-detail-backdrop" data-close-detail></div>
      <div class="homepage-detail-scroll">
        <article class="homepage-detail-shell">
          <header class="homepage-detail-header">
            <div class="homepage-detail-heading">
              <time class="homepage-detail-date" id="homepage-detail-date"></time>
              <h2 class="homepage-detail-title" id="homepage-detail-title"></h2>
            </div>
            <div class="homepage-detail-actions">
              <button type="button" data-homepage-edit-project data-project-slug=""></button>
              <button class="homepage-close-button" type="button" data-close-detail>Close</button>
            </div>
          </header>
          <div id="homepage-detail-hero-frame">
            <div id="homepage-detail-hero-media"></div>
          </div>
          <section id="homepage-detail-content" data-homepage-detail-content></section>
        </article>
      </div>
    </section>
    <div id="homepage-transition-layer" class="homepage-transition-layer"></div>
  `;

  const listScene = document.getElementById('homepage-list-scene');
  const detailScene = document.getElementById('homepage-detail-scene');
  const detailDate = document.getElementById('homepage-detail-date');
  const detailTitle = document.getElementById('homepage-detail-title');
  const detailHeroFrame = document.getElementById('homepage-detail-hero-frame');
  const detailHeroMedia = document.getElementById('homepage-detail-hero-media');
  const detailContent = document.getElementById('homepage-detail-content');
  const transitionLayer = document.getElementById('homepage-transition-layer');

  if (
    !(listScene instanceof HTMLElement)
    || !(detailScene instanceof HTMLElement)
    || !(detailDate instanceof HTMLElement)
    || !(detailTitle instanceof HTMLElement)
    || !(detailHeroFrame instanceof HTMLElement)
    || !(detailHeroMedia instanceof HTMLElement)
    || !(detailContent instanceof HTMLElement)
    || !(transitionLayer instanceof HTMLElement)
  ) {
    throw new Error('Failed to build homepage test fixture');
  }

  const controller = new HomepageController({
    listScene,
    detailScene,
    detailDate,
    detailTitle,
    detailHeroFrame,
    detailHeroMedia,
    detailContent,
    transitionLayer,
  });

  const openButton = detailScene.ownerDocument.querySelector<HTMLButtonElement>('button[data-open-project="project-one"]');
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

function isDetailOpen(detailScene: HTMLElement): boolean {
  return detailScene.classList.contains('homepage-visible') && detailScene.getAttribute('aria-hidden') === 'false';
}

function stubDetailFetch(html: string = DETAIL_RESPONSE_HTML) {
  const fetchMock = vi.fn(async () => ({ ok: true, text: async () => html }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function navigateBack(url: string): void {
  window.history.replaceState(window.history.state, '', url);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

class FakeHls {
  static Events = { MANIFEST_PARSED: 'manifest-parsed', ERROR: 'error' };
  static ErrorTypes = { NETWORK_ERROR: 'network', MEDIA_ERROR: 'media' };
  static instances: FakeHls[] = [];
  static isSupported = (): boolean => true;

  levels: unknown[] = [];
  startLevel = -1;
  destroyed = false;
  private readonly handlers = new Map<string, () => void>();

  constructor() {
    FakeHls.instances.push(this);
  }

  on(event: string, handler: () => void): void {
    this.handlers.set(event, handler);
  }

  loadSource(): void {}

  attachMedia(): void {
    queueMicrotask(() => this.handlers.get(FakeHls.Events.MANIFEST_PARSED)?.());
  }

  destroy(): void {
    this.destroyed = true;
  }
}

async function flushAsyncWork(iterations: number = 6): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('HomepageController', () => {
  it('opens and closes a project through the shared-element scene and history', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => DETAIL_RESPONSE_HTML,
    })));

    const { controller, detailScene, detailContent, openButton, closeButton } = createHomepageFixture();
    controller.init();

    openButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsyncWork();

    expect(isDetailOpen(detailScene)).toBe(true);
    expect(window.location.pathname).toBe('/project-one');
    expect(detailContent.querySelector('.project-content')).not.toBeNull();

    closeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsyncWork();

    expect(isDetailOpen(detailScene)).toBe(false);
    expect(window.location.pathname).toBe('/');
    expect(detailContent.querySelector('.project-content')).toBeNull();

    controller.destroy();
  });

  it('flies the date and title between the list card and the detail header', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => DETAIL_RESPONSE_HTML,
    })));
    // jsdom has no layout; give every element a box so the animated path runs.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(10, 20, 300, 40)
    );
    const flightsMidAnimation: string[][] = [];
    vi.spyOn(HTMLElement.prototype, 'animate').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('homepage-heading-flight')) {
        flightsMidAnimation.push([this.textContent?.replace(/\s+/g, ' ').trim() || '', this.id]);
      }
      return { finished: Promise.resolve(), cancel: vi.fn() } as unknown as Animation;
    });

    const { controller, detailScene, openButton, closeButton } = createHomepageFixture();
    const cardHeading = document.querySelector<HTMLElement>('.homepage-card-heading');
    const detailHeading = detailScene.querySelector<HTMLElement>('.homepage-detail-heading');
    controller.init();

    openButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsyncWork();

    expect(isDetailOpen(detailScene)).toBe(true);
    expect(flightsMidAnimation).toEqual([['2024 Project One', '']]);
    expect(document.querySelector('.homepage-heading-flight')).toBeNull();
    expect(cardHeading?.classList.contains('homepage-source-hidden')).toBe(true);
    expect(detailHeading?.classList.contains('homepage-target-hidden')).toBe(false);

    closeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsyncWork();

    expect(isDetailOpen(detailScene)).toBe(false);
    expect(flightsMidAnimation).toHaveLength(2);
    expect(flightsMidAnimation[1][0]).toBe('2024 Project One');
    expect(document.querySelector('.homepage-heading-flight')).toBeNull();
    expect(cardHeading?.classList.contains('homepage-source-hidden')).toBe(false);

    controller.destroy();
  });

  it('hydrates direct-entry routes and restores hash scrolling after the detail mounts', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => DETAIL_RESPONSE_HTML,
    }));
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', 'http://localhost/project-one#section-one');

    const scrollSpy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    const { controller, detailScene } = createHomepageFixture();
    controller.init();
    await flushAsyncWork();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(isDetailOpen(detailScene)).toBe(true);
    expect(window.location.pathname).toBe('/project-one');
    expect(
      scrollSpy.mock.contexts.some((element) => element instanceof HTMLElement && element.id === 'section-one')
    ).toBe(true);

    controller.destroy();
  });

  it('handles same-slug popstate updates without refetching the detail payload', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      text: async () => DETAIL_RESPONSE_HTML,
    }));
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', 'http://localhost/project-one');

    const scrollSpy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    const { controller } = createHomepageFixture();
    controller.init();
    await flushAsyncWork();
    fetchMock.mockClear();

    window.history.pushState({ homepage: true, slug: 'project-one' }, '', 'http://localhost/project-one#section-two');
    window.dispatchEvent(new PopStateEvent('popstate', { state: { homepage: true, slug: 'project-one' } }));
    await flushAsyncWork();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      scrollSpy.mock.contexts.some((element) => element instanceof HTMLElement && element.id === 'section-two')
    ).toBe(true);

    controller.destroy();
  });

  it('keeps the open scene, edit affordance, and URL in sync after a slug rename', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => DETAIL_RESPONSE_HTML,
    })));

    const { controller, editButton } = createHomepageFixture();
    controller.init();
    document.querySelector('[data-open-project="project-one"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsyncWork();

    controller.renameProjectSlug('project-one', 'project-renamed');

    const renamedOpenButton = document.querySelector<HTMLButtonElement>('[data-open-project="project-renamed"]');
    expect(controller.getOpenProjectSlug()).toBe('project-renamed');
    expect(window.location.pathname).toBe('/project-renamed');
    expect(editButton.dataset.projectSlug).toBe('project-renamed');
    expect(renamedOpenButton).not.toBeNull();

    controller.destroy();
  });

  it('closes on browser back and reopens on forward from the cache, without touching history', async () => {
    const fetchMock = stubDetailFetch();
    const { controller, detailScene, openButton } = createHomepageFixture();
    controller.init();
    openButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsyncWork();
    const pushSpy = vi.spyOn(window.history, 'pushState');

    navigateBack('http://localhost/');
    await flushAsyncWork();
    expect(isDetailOpen(detailScene)).toBe(false);
    expect(controller.getOpenProjectSlug()).toBeNull();

    navigateBack('http://localhost/project-one');
    await flushAsyncWork();
    expect(isDetailOpen(detailScene)).toBe(true);
    expect(controller.getOpenProjectSlug()).toBe('project-one');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pushSpy).not.toHaveBeenCalled();

    controller.destroy();
  });

  it('switches directly between projects when history moves from one to the other', async () => {
    stubDetailFetch();
    const { controller, detailScene } = createHomepageFixture();
    window.history.replaceState(null, '', 'http://localhost/project-one');
    controller.init();
    await flushAsyncWork();
    expect(document.getElementById('homepage-detail-title')?.textContent).toBe('Project One');

    navigateBack('http://localhost/project-two');
    await flushAsyncWork();

    expect(controller.getOpenProjectSlug()).toBe('project-two');
    expect(isDetailOpen(detailScene)).toBe(true);
    expect(document.getElementById('homepage-detail-title')?.textContent).toBe('Project Two');
    expect(document.getElementById('homepage-detail-date')?.textContent).toBe('2023');
    expect(document.getElementById('homepage-detail-hero-frame')?.style.getPropertyValue('--homepage-hero-aspect')).toBe('0.5625');
    expect(document.querySelectorAll('.homepage-active-card')).toHaveLength(1);

    controller.destroy();
  });

  it('returns to the list intact when the detail fails to load', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    const { controller, detailScene, openButton } = createHomepageFixture();
    controller.init();

    openButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsyncWork();

    expect(consoleError).toHaveBeenCalled();
    expect(isDetailOpen(detailScene)).toBe(false);
    expect(controller.getOpenProjectSlug()).toBeNull();
    expect(window.location.pathname).toBe('/');
    expect(document.body.classList.contains('homepage-nav-hidden')).toBe(false);
    expect(document.querySelector('.homepage-source-hidden, .homepage-target-hidden, .homepage-active-card')).toBeNull();

    controller.destroy();
  });

  it('closes the open project on Escape and restores focus to what opened it', async () => {
    stubDetailFetch();
    const { controller, detailScene, openButton } = createHomepageFixture();
    controller.init();
    openButton.focus();
    openButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsyncWork();
    expect(document.activeElement?.classList.contains('homepage-close-button')).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await flushAsyncWork();

    expect(isDetailOpen(detailScene)).toBe(false);
    expect(window.location.pathname).toBe('/');
    expect(document.activeElement).toBe(openButton);

    controller.destroy();
  });

  it('covers the hero with the card frame until the video paints, and tears the player down on close', async () => {
    FakeHls.instances = [];
    vi.stubGlobal('Hls', FakeHls);
    stubDetailFetch(`
      <section class="video-container" id="hero">
        <video data-hls-url="/video.m3u8" data-video-width="1280" data-video-height="720"></video>
      </section>
      <section class="project-content"><p>Body</p></section>
    `);
    const { controller, openButton, closeButton } = createHomepageFixture();
    const heroFrame = document.getElementById('homepage-detail-hero-frame') as HTMLElement;
    controller.init();

    openButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsyncWork();

    const video = heroFrame.querySelector('video') as HTMLVideoElement;
    expect(heroFrame.querySelector('.video-container')?.id).toBe('');
    expect(video.poster).toContain('/thumb.webp');
    expect(FakeHls.instances).toHaveLength(1);
    expect(heroFrame.querySelector('.homepage-hero-bridge')).not.toBeNull();
    expect(heroFrame.style.getPropertyValue('--homepage-fallback-poster')).toContain('/thumb.webp');

    Object.defineProperty(video, 'readyState', { configurable: true, value: 2 });
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 1280 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 720 });
    video.dispatchEvent(new Event('loadeddata'));
    await flushAsyncWork();

    expect(heroFrame.querySelector('.homepage-hero-bridge')).toBeNull();
    expect(heroFrame.style.getPropertyValue('--homepage-fallback-poster')).toBe('none');

    closeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsyncWork();

    expect(FakeHls.instances[0]?.destroyed).toBe(true);
    expect(heroFrame.querySelector('video')).toBeNull();

    controller.destroy();
  });
});

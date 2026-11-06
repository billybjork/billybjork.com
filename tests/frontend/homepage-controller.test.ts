import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createHomepageFixture,
  DETAIL_RESPONSE_HTML,
  FakeHls,
  flushAsyncWork,
  FULL_DETAIL_HTML,
  isDetailOpen,
  navigateBack,
  stubDetailFetch,
} from './homepage-fixture';

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

  it('tells the editor when a project is ready, and that it never will be once the scene closes', async () => {
    stubDetailFetch();
    const { controller, openButton, closeButton } = createHomepageFixture();
    controller.init();

    const ready = controller.waitForProjectReady('project-one');
    const abandoned = controller.waitForProjectReady('project-two');
    openButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsyncWork();
    await expect(ready).resolves.toBe('project-one');
    await expect(controller.waitForProjectReady()).resolves.toBe('project-one');

    closeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsyncWork();
    await expect(abandoned).resolves.toBeNull();

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
    stubDetailFetch(FULL_DETAIL_HTML);
    const { controller, openButton, closeButton } = createHomepageFixture();
    const heroFrame = document.getElementById('homepage-detail-hero-frame') as HTMLElement;
    controller.init();

    openButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsyncWork();

    const video = heroFrame.querySelector('video') as HTMLVideoElement;
    expect(document.getElementById('hero')).toBe(heroFrame.querySelector('.video-container'));
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

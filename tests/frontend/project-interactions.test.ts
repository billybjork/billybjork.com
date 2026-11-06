import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { initProjectInteractions } from '../../static/ts/project/interactions';
import { createHomepageFixture, flushAsyncWork, isDetailOpen, stubDetailFetch } from './homepage-fixture';

function pressEscape(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
}

const DETAIL_WITH_IMAGE = '<section class="project-content"><img id="shot" src="/shot.webp" alt=""><a id="jump" href="#later">Later</a><h2 id="later">Later</h2></section>';

async function openDetail(fixture: ReturnType<typeof createHomepageFixture>): Promise<void> {
  fixture.controller.init();
  fixture.openButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flushAsyncWork();
}

beforeAll(() => {
  initProjectInteractions();
});

afterEach(() => {
  document.querySelector('.image-lightbox')?.dispatchEvent(new Event('transitionend'));
});

describe('project interactions on an open detail', () => {
  it('Escape closes the lightbox first and leaves the detail open; the next Escape closes the detail', async () => {
    stubDetailFetch(DETAIL_WITH_IMAGE);
    const fixture = createHomepageFixture();
    await openDetail(fixture);

    document.getElementById('shot')?.click();
    const overlay = document.querySelector('.image-lightbox');
    expect(overlay).not.toBeNull();

    pressEscape();
    await flushAsyncWork();
    overlay?.dispatchEvent(new Event('transitionend'));
    expect(document.querySelector('.image-lightbox')).toBeNull();
    expect(isDetailOpen(fixture.detailScene)).toBe(true);
    expect(window.location.pathname).toBe('/project-one');

    pressEscape();
    await flushAsyncWork();
    expect(isDetailOpen(fixture.detailScene)).toBe(false);

    fixture.controller.destroy();
  });

  it('leaves Escape to the editor while editing', async () => {
    stubDetailFetch(DETAIL_WITH_IMAGE);
    const fixture = createHomepageFixture();
    await openDetail(fixture);
    document.body.classList.add('editing');

    pressEscape();
    await flushAsyncWork();

    expect(isDetailOpen(fixture.detailScene)).toBe(true);
    fixture.controller.destroy();
  });

  it('follows an in-page link to its target and records it in the URL', async () => {
    stubDetailFetch(DETAIL_WITH_IMAGE);
    const fixture = createHomepageFixture();
    await openDetail(fixture);
    const scrollSpy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');

    document.getElementById('jump')?.click();

    expect(window.location.hash).toBe('#later');
    expect(scrollSpy.mock.contexts).toContain(document.getElementById('later'));
    fixture.controller.destroy();
  });

  it('copies the share link and confirms it', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    document.body.innerHTML = '<button class="copy-text-link" data-copy-text="https://x.test/p" data-notification-message="Copied"></button>';

    document.querySelector<HTMLElement>('.copy-text-link')?.click();
    await flushAsyncWork();

    expect(writeText).toHaveBeenCalledWith('https://x.test/p');
    expect(document.querySelector('.copy-notification')?.textContent).toBe('Copied');
  });
});

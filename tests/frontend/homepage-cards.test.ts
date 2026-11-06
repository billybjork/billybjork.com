import { describe, expect, it, vi } from 'vitest';

import { readProjectCards } from '../../static/ts/homepage/card';
import { HomepageSpriteRuntime } from '../../static/ts/homepage/sprite-runtime';

function renderCard(attributes: string, clientWidth = 400): HTMLElement {
  document.body.innerHTML = `
    <div id="list">
      <article data-homepage-project-card data-slug="one" ${attributes}>
        <header class="homepage-card-heading"></header>
        <button data-open-project="one">
          <span data-homepage-thumb-frame><span data-homepage-thumb-media></span></span>
        </button>
      </article>
    </div>
  `;
  const frame = document.querySelector('[data-homepage-thumb-frame]') as HTMLElement;
  Object.defineProperty(frame, 'clientWidth', { configurable: true, value: clientWidth });
  Object.defineProperty(frame, 'clientHeight', { configurable: true, value: clientWidth * 9 / 16 });
  return document.getElementById('list') as HTMLElement;
}

describe('sprite sheet loading', () => {
  const SPRITE_CARD = `
    data-sprite-sheet="/sheet.webp" data-frames="60" data-columns="5" data-rows="12"
    data-sprite-aspect-ratio="1.7777778" data-hero-aspect-ratio="0.5625"
  `;

  function stubImageRequests(): string[] {
    const requested: string[] = [];
    vi.stubGlobal('Image', class {
      set src(url: string) {
        requested.push(url);
      }
    });
    return requested;
  }

  /** The harness's observer reports every target as visible, so this one reports nothing until told to. */
  function stubIntersectionObserver(): { reveal(target: Element): void } {
    let callback: IntersectionObserverCallback | null = null;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb: IntersectionObserverCallback) {
        callback = cb;
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    });
    return {
      reveal(target) {
        callback?.([{ isIntersecting: true, target } as IntersectionObserverEntry], { unobserve() {} } as unknown as IntersectionObserver);
      },
    };
  }

  it('requests no sheet until the card nears the viewport, then requests it once', () => {
    const requested = stubImageRequests();
    const observer = stubIntersectionObserver();
    const [card] = readProjectCards(renderCard(SPRITE_CARD));
    const runtime = new HomepageSpriteRuntime([card!.thumbnail]);

    runtime.init();
    expect(requested).toEqual([]);
    expect(document.querySelector('.homepage-sprite-sheet')).toBeNull();

    observer.reveal(card!.cardEl);
    observer.reveal(card!.cardEl);
    expect(requested).toEqual(['/sheet.webp']);
    expect(document.querySelector('.homepage-sprite-sheet')).not.toBeNull();

    runtime.destroy();
  });

  it('frames with the declared aspect ratio until the sheet has loaded', () => {
    stubImageRequests();
    const [card] = readProjectCards(renderCard(SPRITE_CARD));
    card!.thumbnail.activate();
    expect(card!.thumbnail.getSourceAspectRatio()).toBeCloseTo(16 / 9);
  });
});

describe('readProjectCards', () => {
  it('falls back to a 16:9 hero and the slug as title when the card states neither', () => {
    const [card] = readProjectCards(renderCard(''));
    expect(card?.title).toBe('one');
    expect(card?.heroAspectRatio).toBeCloseTo(16 / 9);
    expect(card?.thumbnail.hasSprite).toBe(false);
  });

  it('keeps the sprite sheet shape separate from the hero shape', () => {
    const [card] = readProjectCards(renderCard(`
      data-sprite-sheet="/sheet.webp" data-frames="60" data-columns="5" data-rows="12"
      data-sprite-aspect-ratio="1.7777778" data-hero-aspect-ratio="0.5625"
    `));
    expect(card?.heroAspectRatio).toBe(0.5625);
    expect(card?.thumbnail.getSourceAspectRatio()).toBeCloseTo(16 / 9);
  });

  it('skips a card without a slug', () => {
    const list = renderCard('');
    list.querySelector('article')?.removeAttribute('data-slug');
    expect(readProjectCards(list)).toEqual([]);
  });
});

describe('SpriteThumbnail', () => {
  it('paints the requested frame by offsetting a sheet scaled to the frame', () => {
    const [card] = readProjectCards(renderCard(`
      data-sprite-sheet="/sheet.webp" data-frames="60" data-columns="5" data-rows="12"
      data-sprite-aspect-ratio="1.7777778" data-hero-aspect-ratio="1.7777778"
    `));

    const node = card?.thumbnail.createFrameNode(7, { width: 320, height: 180 });

    expect(node?.style.backgroundSize).toBe('1600px 2160px');
    expect(node?.style.backgroundPosition).toBe('-640px -180px');
  });

  it('shows the still thumbnail when there is no sheet', () => {
    const [card] = readProjectCards(renderCard('data-thumbnail="/still.webp"'));

    const node = card?.thumbnail.createFrameNode(0, { className: 'layer' });

    expect(node).toBeInstanceOf(HTMLImageElement);
    expect((node as HTMLImageElement).getAttribute('src')).toBe('/still.webp');
    expect(node?.className).toBe('layer');
  });

  it('replaces the placeholder with the sprite on activation and keeps its frame when frozen', () => {
    const [card] = readProjectCards(renderCard(`
      data-sprite-sheet="/sheet.webp" data-frames="60" data-columns="5" data-rows="12"
      data-sprite-aspect-ratio="1.7777778" data-hero-aspect-ratio="1.7777778"
    `));
    const media = document.querySelector('[data-homepage-thumb-media]') as HTMLElement;
    media.innerHTML = '<img>';

    card?.thumbnail.activate();
    expect(media.querySelector('img')).toBeNull();
    expect(media.querySelector('.homepage-sprite-sheet')).not.toBeNull();

    card?.thumbnail.update(3);
    card?.thumbnail.freeze();
    card?.thumbnail.update(10);
    expect(card?.thumbnail.getCurrentFrameIndex()).toBe(3);

    card?.thumbnail.unfreeze();
    card?.thumbnail.update(10);
    expect(card?.thumbnail.getCurrentFrameIndex()).toBe(10);
  });
});

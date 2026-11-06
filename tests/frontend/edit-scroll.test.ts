import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  blockWrappers,
  installHarness,
  jsonResponse,
  mountProjectPage,
  openAboutEditor,
  openProjectEditor,
  PROJECT,
  registerRuntime,
  toolbarButton,
  type EditorHarness,
} from './edit-harness';

const STORAGE_KEY = 'bb_edit_scroll_restore_v1';
const FRAME_MS = 20;

let harness: EditorHarness;

beforeEach(() => {
  vi.useFakeTimers();
  harness = installHarness();
  (window.scrollTo as unknown as ReturnType<typeof vi.fn>).mockClear();
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 7 });
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 10000 });
});

afterEach(() => {
  harness.teardown();
});

function placeAt(element: Element, top: number): void {
  element.getBoundingClientRect = () => ({ top, bottom: top + 100, left: 0, right: 0, width: 0, height: 100, x: 0, y: top, toJSON: () => ({}) });
}

/** The detail scene's scroller, as the page lays it out: it has its own extent and position. */
function scroller(scrollTop = 500): HTMLElement {
  const element = document.querySelector<HTMLElement>('.homepage-detail-scroll')!;
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 5000 });
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: 800 });
  Object.defineProperty(element, 'scrollTop', { configurable: true, writable: true, value: scrollTop });
  return element;
}

describe('leaving the editor', () => {
  it('remembers the block at the top of the scroller, and the scroller\'s own position', async () => {
    await openProjectEditor(harness, 'One\n\n<!-- block -->\n\nTwo');
    scroller(500);
    placeAt(blockWrappers()[0]!, -300);
    placeAt(blockWrappers()[1]!, -40);
    blockWrappers()[0]!.getBoundingClientRect = () => ({ top: -300, bottom: -200 }) as DOMRect;

    toolbarButton('save').click();
    await vi.advanceTimersByTimeAsync(0);

    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY)!)).toMatchObject({
      pathname: '/sample-project',
      scrollTop: 500,
      anchorIndex: 1,
      anchorTop: -40,
    });
  });

  it('remembers the window\'s position on the about page, which has no scroller', async () => {
    await openAboutEditor(harness, 'One');
    toolbarButton('save').click();
    await vi.advanceTimersByTimeAsync(0);

    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY)!)).toMatchObject({ pathname: '/me', scrollTop: 7 });
  });
});

describe('while editing', () => {
  /** Inserts a block, with the anchor block reading 120px lower after the re-render than before it. */
  async function insertBlockThatPushesContentDown(): Promise<void> {
    await vi.advanceTimersByTimeAsync(100);
    const realRect = Element.prototype.getBoundingClientRect;
    const blockAt = (top: number) => function rect(this: Element): DOMRect {
      return this.classList?.contains('block-wrapper') ? { top, bottom: top + 100 } as DOMRect : realRect.call(this);
    };
    (window.scrollTo as unknown as ReturnType<typeof vi.fn>).mockClear();

    try {
      Element.prototype.getBoundingClientRect = blockAt(120);
      document.querySelector<HTMLButtonElement>('.add-block-wrapper-top .merge-add-btn')!.click();
      document.querySelector<HTMLButtonElement>('.slash-menu-item[data-command="divider"]')!.click();
      Element.prototype.getBoundingClientRect = blockAt(240);
      await vi.advanceTimersByTimeAsync(FRAME_MS);
    } finally {
      Element.prototype.getBoundingClientRect = realRect;
    }
  }

  it('holds a block still by moving the scroller, never the window', async () => {
    await openProjectEditor(harness, 'One\n\n<!-- block -->\n\nTwo');
    const element = scroller(500);

    await insertBlockThatPushesContentDown();

    expect(element.scrollTop).toBe(620);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('holds the about page still with the window', async () => {
    await openAboutEditor(harness, 'One');

    await insertBlockThatPushesContentDown();

    const calls = (window.scrollTo as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect((calls[calls.length - 1]?.[0] as ScrollToOptions).top).toBe(7 + 120);
  });
});

describe('coming back after the reload', () => {
  function store(state: Record<string, unknown>): void {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      pathname: window.location.pathname,
      scrollTop: 500,
      offsetWithinContent: null,
      anchorIndex: null,
      anchorTop: null,
      expiresAt: Date.now() + 1000,
      ...state,
    }));
  }

  async function restoreInWindow(state: Record<string, unknown>): Promise<void> {
    store(state);
    const { restorePersistedScroll } = await import('../../static/ts/edit/scroll');
    restorePersistedScroll(null);
    await vi.advanceTimersByTimeAsync(FRAME_MS);
  }

  function lastWindowTop(): number | undefined {
    const calls = (window.scrollTo as unknown as ReturnType<typeof vi.fn>).mock.calls;
    return (calls[calls.length - 1]?.[0] as ScrollToOptions | undefined)?.top;
  }

  function mountContent(): HTMLElement[] {
    document.body.innerHTML = '<section id="homepage-detail-content"><div class="project-content"><div class="content-block"></div><div class="content-block"></div></div></section>';
    return Array.from(document.querySelectorAll<HTMLElement>('.content-block'));
  }

  it('waits for the project to open, then puts the block back inside the scroller', async () => {
    mountProjectPage();
    const element = scroller(0);
    document.querySelector('.project-content')!.innerHTML = '<div class="content-block"></div><div class="content-block"></div>';
    placeAt(document.querySelectorAll('.content-block')[1]!, 200);
    let opened!: (slug: string) => void;
    const runtime = registerRuntime(PROJECT.slug);
    runtime.waitForProjectReady = vi.fn(() => new Promise<string | null>((resolve) => { opened = resolve; }));
    harness.respond(`/api/project/${PROJECT.slug}`, () => jsonResponse({ ...PROJECT, markdown: 'Body' }));
    store({ anchorIndex: 1, anchorTop: -40 });

    const { init } = await import('../../static/ts/edit/bootstrap');
    init();
    await vi.advanceTimersByTimeAsync(FRAME_MS);
    expect(element.scrollTop).toBe(0);

    opened(PROJECT.slug);
    await vi.advanceTimersByTimeAsync(FRAME_MS);

    expect(element.scrollTop).toBe(240);
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('keeps a restored position inside the scroller\'s extent', async () => {
    mountProjectPage();
    const element = scroller(0);
    store({ scrollTop: 999999 });
    const { restorePersistedScroll } = await import('../../static/ts/edit/scroll');
    restorePersistedScroll(element);
    await vi.advanceTimersByTimeAsync(FRAME_MS);

    expect(element.scrollTop).toBe(5000 - 800);
  });

  it('puts the same block back where it was on a page that scrolls the window', async () => {
    const blocks = mountContent();
    placeAt(blocks[1]!, 200);
    await restoreInWindow({ anchorIndex: 1, anchorTop: -40 });

    expect(lastWindowTop()).toBe(7 + 240);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('falls back to the raw position with no content', async () => {
    await restoreInWindow({});
    expect(lastWindowTop()).toBe(500);
  });

  it('yields to an in-page anchor', async () => {
    window.history.replaceState(null, '', '/#section');
    mountContent();
    await restoreInWindow({});
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('ignores a stale entry and one for another page', async () => {
    await restoreInWindow({ expiresAt: Date.now() - 1 });
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();

    await restoreInWindow({ pathname: '/elsewhere' });
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});

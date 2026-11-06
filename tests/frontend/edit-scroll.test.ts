import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  blockWrappers,
  installHarness,
  openProjectEditor,
  toolbarButton,
  type EditorHarness,
} from './edit-harness';

const STORAGE_KEY = 'bb_edit_scroll_restore_v1';
const FRAME_MS = 20;

let harness: EditorHarness;

beforeEach(() => {
  vi.useFakeTimers();
  harness = installHarness();
  (window.scrollTo as ReturnType<typeof vi.fn>).mockClear?.();
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 500 });
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 10000 });
});

afterEach(() => {
  harness.teardown();
});

function placeAt(element: Element, top: number): void {
  element.getBoundingClientRect = () => ({ top, bottom: top + 100, left: 0, right: 0, width: 0, height: 100, x: 0, y: top, toJSON: () => ({}) });
}

function lastScrollTop(): number | undefined {
  const calls = (window.scrollTo as unknown as ReturnType<typeof vi.fn>).mock.calls;
  return (calls[calls.length - 1]?.[0] as ScrollToOptions | undefined)?.top;
}

describe('leaving the editor', () => {
  it('remembers the block at the top of the viewport', async () => {
    await openProjectEditor(harness, 'One\n\n<!-- block -->\n\nTwo');
    placeAt(blockWrappers()[0]!, -300);
    placeAt(blockWrappers()[1]!, -40);
    blockWrappers()[0]!.getBoundingClientRect = () => ({ top: -300, bottom: -200 }) as DOMRect;

    toolbarButton('save').click();
    await vi.advanceTimersByTimeAsync(0);

    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY)!)).toMatchObject({
      pathname: '/sample-project',
      scrollY: 500,
      anchorIndex: 1,
      anchorTop: -40,
    });
  });
});

describe('coming back after the reload', () => {
  async function restore(state: Record<string, unknown>): Promise<void> {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      pathname: window.location.pathname,
      scrollY: 500,
      offsetWithinContent: null,
      anchorIndex: null,
      anchorTop: null,
      expiresAt: Date.now() + 1000,
      ...state,
    }));
    const { restorePersistedScroll } = await import('../../static/ts/edit/scroll');
    restorePersistedScroll();
    await vi.advanceTimersByTimeAsync(FRAME_MS);
  }

  function mountContent(): HTMLElement[] {
    document.body.innerHTML = '<section id="homepage-detail-content"><div class="project-content"><div class="content-block"></div><div class="content-block"></div></div></section>';
    return Array.from(document.querySelectorAll<HTMLElement>('.content-block'));
  }

  it('puts the same block back where it was', async () => {
    const blocks = mountContent();
    placeAt(blocks[1]!, 200);
    await restore({ anchorIndex: 1, anchorTop: -40 });

    expect(lastScrollTop()).toBe(500 + 240);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('falls back to the raw position with no content', async () => {
    await restore({});
    expect(lastScrollTop()).toBe(500);
  });

  it('yields to an in-page anchor', async () => {
    window.history.replaceState(null, '', '/#section');
    mountContent();
    (window.scrollTo as unknown as ReturnType<typeof vi.fn>).mockClear();
    await restore({});
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it('ignores a stale entry and one for another page', async () => {
    (window.scrollTo as unknown as ReturnType<typeof vi.fn>).mockClear();
    await restore({ expiresAt: Date.now() - 1 });
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();

    await restore({ pathname: '/elsewhere' });
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});

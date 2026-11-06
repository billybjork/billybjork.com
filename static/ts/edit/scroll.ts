import { findActiveContent } from './page-content';
import { clamp } from './clamp';

const STORAGE_KEY = 'bb_edit_scroll_restore_v1';
const STORED_TTL_MS = 30_000;
const ANCHOR_PASSES = 3;
const MEDIA_SHIFT_PASSES = 2;
const STORED_RESTORE_PASSES = 4;
// Late passes catch layout that shifts after `load`, such as fonts and hydrated media.
const LATE_RESTORE_DELAY_MS = 180;
const LATE_RESTORE_PASSES = 2;

/** What scrolls the content: an element, or null for the window. */
type Scroller = HTMLElement | null;

function scrollTopOf(scroller: Scroller): number {
  return scroller ? scroller.scrollTop : window.scrollY;
}

function scrollInstantlyTo(scroller: Scroller, top: number): void {
  const maxScrollTop = scroller
    ? Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    : Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  (scroller ?? window).scrollTo({ top: clamp(top, 0, maxScrollTop), left: 0, behavior: 'instant' });
}

function runOverFrames(passes: number, pass: () => void, isCurrent: () => boolean = () => true): void {
  let remaining = passes;
  const run = (): void => {
    if (!isCurrent()) return;
    pass();
    remaining -= 1;
    if (remaining > 0) requestAnimationFrame(run);
  };
  requestAnimationFrame(run);
}

function firstVisible(elements: HTMLElement[]): HTMLElement | null {
  return elements.find((element) => element.getBoundingClientRect().bottom >= 0)
    ?? elements[elements.length - 1]
    ?? null;
}

function onMediaLayoutShift(root: ParentNode, handler: () => void): void {
  root.querySelectorAll('img').forEach((image) => {
    if (image.complete) return;
    image.addEventListener('load', handler, { once: true });
    image.addEventListener('error', handler, { once: true });
  });
  root.querySelectorAll('video').forEach((video) => {
    if (video.readyState >= 1) return;
    video.addEventListener('loadedmetadata', handler, { once: true });
    video.addEventListener('error', handler, { once: true });
  });
}

function wrapperAt(blocksRoot: HTMLElement, index: number): HTMLElement | null {
  return blocksRoot.querySelector<HTMLElement>(`.block-wrapper[data-block-index="${index}"]`);
}

function scrollSoThatElementIsAt(scroller: Scroller, element: HTMLElement, top: number): void {
  const delta = element.getBoundingClientRect().top - top;
  if (Math.abs(delta) >= 1) scrollInstantlyTo(scroller, scrollTopOf(scroller) + delta);
}

/**
 * Keeps the page visually still while the editor rebuilds its DOM. A newer restore of the
 * same kind cancels an older one, so a fast sequence of re-renders never fights itself.
 */
export function createScrollAnchors(scroller: Scroller) {
  const latest = { render: 0, modeSwitch: 0, container: 0 };

  const hold = (kind: keyof typeof latest, root: ParentNode, restoreOnce: () => void): void => {
    latest[kind] += 1;
    const token = latest[kind];
    const isCurrent = (): boolean => token === latest[kind];
    runOverFrames(ANCHOR_PASSES, restoreOnce, isCurrent);
    onMediaLayoutShift(root, () => runOverFrames(MEDIA_SHIFT_PASSES, restoreOnce, isCurrent));
  };

  return {
    aroundRender(blocksRoot: HTMLElement, render: () => void): void {
      const wrappers = Array.from(blocksRoot.querySelectorAll<HTMLElement>('.block-wrapper[data-block-id]'));
      const element = firstVisible(wrappers);
      const anchor = element && {
        blockId: element.dataset.blockId ?? null,
        blockIndex: Number.parseInt(element.dataset.blockIndex ?? '', 10) || 0,
        blockTop: element.getBoundingClientRect().top,
      };

      render();

      const count = blocksRoot.querySelectorAll('.block-wrapper').length;
      if (!anchor || count === 0) return;
      hold('render', blocksRoot, () => {
        const target = (anchor.blockId
          ? blocksRoot.querySelector<HTMLElement>(`.block-wrapper[data-block-id="${anchor.blockId}"]`)
          : null) ?? wrapperAt(blocksRoot, clamp(anchor.blockIndex, 0, count - 1));
        if (target) scrollSoThatElementIsAt(scroller, target, anchor.blockTop);
      });
    },

    captureModeSwitch(content: HTMLElement): (blocksRoot: HTMLElement, stabilityRoot: ParentNode) => void {
      const offsetWithinContent = -content.getBoundingClientRect().top;
      const rendered = Array.from(content.querySelectorAll<HTMLElement>('.content-block'));
      const element = firstVisible(rendered);
      const blockIndex = element ? rendered.indexOf(element) : -1;
      const blockTop = element?.getBoundingClientRect().top ?? 0;

      return (blocksRoot, stabilityRoot) => {
        if (blockIndex < 0) {
          hold('container', stabilityRoot, () => {
            scrollInstantlyTo(scroller, scrollTopOf(scroller) + content.getBoundingClientRect().top + offsetWithinContent);
          });
          return;
        }
        const count = blocksRoot.querySelectorAll('.block-wrapper').length;
        if (count === 0) return;
        hold('modeSwitch', stabilityRoot, () => {
          const target = wrapperAt(blocksRoot, clamp(blockIndex, 0, count - 1));
          if (target) scrollSoThatElementIsAt(scroller, target, blockTop);
        });
      };
    },
  };
}

interface StoredScrollState {
  pathname: string;
  scrollTop: number;
  offsetWithinContent: number | null;
  anchorIndex: number | null;
  anchorTop: number | null;
  expiresAt: number;
}

function captureBlockPosition(content: HTMLElement): { anchorIndex: number | null; anchorTop: number | null } {
  const blocks = Array.from(content.querySelectorAll<HTMLElement>('.block-wrapper[data-block-index]'));
  const anchor = firstVisible(blocks);
  return anchor
    ? { anchorIndex: blocks.indexOf(anchor), anchorTop: anchor.getBoundingClientRect().top }
    : { anchorIndex: null, anchorTop: null };
}

export function persistScrollForNavigation(scroller: Scroller): void {
  const content = findActiveContent();
  const position = content ? captureBlockPosition(content) : { anchorIndex: null, anchorTop: null };

  const state: StoredScrollState = {
    pathname: window.location.pathname,
    scrollTop: scrollTopOf(scroller),
    offsetWithinContent: content ? -content.getBoundingClientRect().top : null,
    ...position,
    expiresAt: Date.now() + STORED_TTL_MS,
  };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function readStoredState(): StoredScrollState | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredScrollState;
  } catch (error) {
    console.warn('Discarding an unreadable saved scroll position:', error);
    return null;
  }
}

/** Call once the content is on the page: a project's detail mounts well after the document loads. */
export function restorePersistedScroll(scroller: Scroller): void {
  const state = readStoredState();
  if (!state || Date.now() > state.expiresAt) {
    sessionStorage.removeItem(STORAGE_KEY);
    return;
  }
  if (state.pathname !== window.location.pathname) return;
  sessionStorage.removeItem(STORAGE_KEY);

  const restoreOnce = (): void => {
    // In-page anchor navigation wins.
    if (window.location.hash) return;

    const content = findActiveContent();
    let targetTop = state.scrollTop;
    const anchor = content && state.anchorIndex !== null
      ? content.querySelectorAll<HTMLElement>('.content-block')[state.anchorIndex]
      : null;
    if (anchor && state.anchorTop !== null) {
      targetTop = scrollTopOf(scroller) + anchor.getBoundingClientRect().top - state.anchorTop;
    } else if (content && state.offsetWithinContent !== null) {
      targetTop = scrollTopOf(scroller) + content.getBoundingClientRect().top + state.offsetWithinContent;
    }
    scrollInstantlyTo(scroller, targetTop);
  };

  runOverFrames(STORED_RESTORE_PASSES, restoreOnce);
  if (document.readyState !== 'complete') {
    window.addEventListener('load', () => runOverFrames(STORED_RESTORE_PASSES, restoreOnce), { once: true });
  }
  setTimeout(() => runOverFrames(LATE_RESTORE_PASSES, restoreOnce), LATE_RESTORE_DELAY_MS);
}

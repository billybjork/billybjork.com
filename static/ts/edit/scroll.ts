import { isEditingActive } from '../core/edit-state';
import { findActiveContent } from './page-content';
import { clamp } from './text';

const STORAGE_KEY = 'bb_edit_scroll_restore_v1';
const STORED_TTL_MS = 30_000;
const ANCHOR_PASSES = 3;
const MEDIA_SHIFT_PASSES = 2;
const STORED_RESTORE_PASSES = 4;
// Late passes catch layout that shifts after `load`, such as fonts and hydrated media.
const LATE_RESTORE_DELAY_MS = 180;
const LATE_RESTORE_PASSES = 2;



function scrollInstantlyTo(top: number): void {
  const html = document.documentElement;
  const previous = html.style.scrollBehavior;
  html.style.scrollBehavior = 'auto';

  const maxScrollTop = Math.max(0, html.scrollHeight - window.innerHeight);
  window.scrollTo({ top: clamp(top, 0, maxScrollTop), left: 0, behavior: 'auto' });

  requestAnimationFrame(() => {
    if (previous) {
      html.style.scrollBehavior = previous;
    } else {
      html.style.removeProperty('scroll-behavior');
    }
  });
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

/** The first of `elements` still at least partly below the top of the viewport. */
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

function scrollSoThatElementIsAt(element: HTMLElement, top: number): void {
  const delta = element.getBoundingClientRect().top - top;
  if (Math.abs(delta) >= 1) scrollInstantlyTo(window.scrollY + delta);
}

/**
 * Keeps the page visually still while the editor rebuilds its DOM. A newer restore of the
 * same kind cancels an older one, so a fast sequence of re-renders never fights itself.
 */
export function createScrollAnchors() {
  const latest = { render: 0, modeSwitch: 0, container: 0 };

  const hold = (kind: keyof typeof latest, root: ParentNode, restoreOnce: () => void): void => {
    latest[kind] += 1;
    const token = latest[kind];
    const isCurrent = (): boolean => token === latest[kind];
    runOverFrames(ANCHOR_PASSES, restoreOnce, isCurrent);
    onMediaLayoutShift(root, () => runOverFrames(MEDIA_SHIFT_PASSES, restoreOnce, isCurrent));
  };

  return {
    /** Holds the block at the top of the viewport still across a re-render of `blocksRoot`. */
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
        if (target) scrollSoThatElementIsAt(target, anchor.blockTop);
      });
    },

    /** Captures the reader's place in the rendered page, for after the editor replaces it. */
    captureModeSwitch(content: HTMLElement): (blocksRoot: HTMLElement, stabilityRoot: ParentNode) => void {
      const offsetWithinContent = -content.getBoundingClientRect().top;
      const rendered = Array.from(content.querySelectorAll<HTMLElement>('.content-block'));
      const element = firstVisible(rendered);
      const blockIndex = element ? rendered.indexOf(element) : -1;
      const blockTop = element?.getBoundingClientRect().top ?? 0;

      return (blocksRoot, stabilityRoot) => {
        if (blockIndex < 0) {
          hold('container', stabilityRoot, () => {
            scrollInstantlyTo(window.scrollY + content.getBoundingClientRect().top + offsetWithinContent);
          });
          return;
        }
        const count = blocksRoot.querySelectorAll('.block-wrapper').length;
        if (count === 0) return;
        hold('modeSwitch', stabilityRoot, () => {
          const target = wrapperAt(blocksRoot, clamp(blockIndex, 0, count - 1));
          if (target) scrollSoThatElementIsAt(target, blockTop);
        });
      };
    },
  };
}

export type ScrollAnchors = ReturnType<typeof createScrollAnchors>;

interface StoredScrollState {
  pathname: string;
  scrollY: number;
  offsetWithinContent: number | null;
  anchorIndex: number | null;
  anchorTop: number | null;
  expiresAt: number;
}

function captureBlockPosition(content: HTMLElement): { anchorIndex: number | null; anchorTop: number | null } {
  const editing = isEditingActive();
  const blocks = Array.from(content.querySelectorAll<HTMLElement>(
    editing ? '.block-wrapper[data-block-index]' : '.content-block'
  ));
  const anchor = firstVisible(blocks);
  return anchor
    ? { anchorIndex: blocks.indexOf(anchor), anchorTop: anchor.getBoundingClientRect().top }
    : { anchorIndex: null, anchorTop: null };
}

/** Remembers the reader's place across the reload that leaves the editor. */
export function persistScrollForNavigation(): void {
  const content = findActiveContent();
  const position = content ? captureBlockPosition(content) : { anchorIndex: null, anchorTop: null };

  const state: StoredScrollState = {
    pathname: window.location.pathname,
    scrollY: window.scrollY,
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

export function restorePersistedScroll(): void {
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
    let targetTop = state.scrollY;
    const anchor = content && state.anchorIndex !== null
      ? content.querySelectorAll<HTMLElement>('.content-block')[state.anchorIndex]
      : null;
    if (anchor && state.anchorTop !== null) {
      targetTop = window.scrollY + anchor.getBoundingClientRect().top - state.anchorTop;
    } else if (content && state.offsetWithinContent !== null) {
      targetTop = window.scrollY + content.getBoundingClientRect().top + state.offsetWithinContent;
    }
    scrollInstantlyTo(targetTop);
  };

  runOverFrames(STORED_RESTORE_PASSES, restoreOnce);
  window.addEventListener('load', () => runOverFrames(STORED_RESTORE_PASSES, restoreOnce), { once: true });
  setTimeout(() => runOverFrames(LATE_RESTORE_PASSES, restoreOnce), LATE_RESTORE_DELAY_MS);
}

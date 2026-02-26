const SCROLL_RESTORE_KEY = 'bb_edit_scroll_restore_v1';
const SCROLL_RESTORE_TTL_MS = 30_000;
const SCROLL_RESTORE_PASSES = 4;

interface StoredScrollState {
  pathname: string;
  scrollY: number;
  containerSelector: string | null;
  offsetWithinContainer: number | null;
  anchorIndex: number | null;
  anchorTop: number | null;
  expiresAt: number;
}

function clampScrollTop(top: number): number {
  const maxScrollTop = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  return Math.max(0, Math.min(top, maxScrollTop));
}

function withInstantScroll(action: () => void): void {
  const html = document.documentElement;
  const previousInlineScrollBehavior = html.style.scrollBehavior;
  html.style.scrollBehavior = 'auto';

  action();

  requestAnimationFrame(() => {
    if (previousInlineScrollBehavior) {
      html.style.scrollBehavior = previousInlineScrollBehavior;
    } else {
      html.style.removeProperty('scroll-behavior');
    }
  });
}

function findActiveContainer(preferredSelector: string | null = null): { element: HTMLElement | null; selector: string | null } {
  const selectorCandidates = [
    preferredSelector,
    '.project-item.active .project-content',
    '.about-content',
    '.project-content',
  ].filter((value): value is string => !!value);

  for (const selector of selectorCandidates) {
    const match = document.querySelector<HTMLElement>(selector);
    if (match) {
      return { element: match, selector };
    }
  }

  return { element: null, selector: null };
}

function captureAnchor(
  container: HTMLElement
): { anchorIndex: number | null; anchorTop: number | null } {
  if (document.body.classList.contains('editing')) {
    const wrappers = Array.from(container.querySelectorAll<HTMLElement>('.block-wrapper[data-block-index]'));
    const anchor =
      wrappers.find((wrapper) => wrapper.getBoundingClientRect().bottom >= 0) ??
      wrappers[wrappers.length - 1] ??
      null;
    if (!anchor) {
      return { anchorIndex: null, anchorTop: null };
    }
    const parsedIndex = Number.parseInt(anchor.dataset.blockIndex ?? '', 10);
    return {
      anchorIndex: Number.isNaN(parsedIndex) ? null : parsedIndex,
      anchorTop: anchor.getBoundingClientRect().top,
    };
  }

  const blocks = Array.from(container.querySelectorAll<HTMLElement>('.content-block'));
  const anchor =
    blocks.find((block) => block.getBoundingClientRect().bottom >= 0) ??
    blocks[blocks.length - 1] ??
    null;
  if (!anchor) {
    return { anchorIndex: null, anchorTop: null };
  }

  return {
    anchorIndex: blocks.indexOf(anchor),
    anchorTop: anchor.getBoundingClientRect().top,
  };
}

function resolveAnchorTarget(container: HTMLElement, state: StoredScrollState): HTMLElement | null {
  if (state.anchorIndex === null) return null;

  if (document.body.classList.contains('editing')) {
    return container.querySelector<HTMLElement>(`.block-wrapper[data-block-index="${state.anchorIndex}"]`);
  }

  const blocks = Array.from(container.querySelectorAll<HTMLElement>('.content-block'));
  return blocks[state.anchorIndex] ?? null;
}

function scheduleRestorePasses(restoreOnce: () => void, passCount: number): void {
  if (passCount <= 0) return;

  let remaining = passCount;
  const run = (): void => {
    restoreOnce();
    remaining -= 1;
    if (remaining > 0) {
      requestAnimationFrame(run);
    }
  };

  requestAnimationFrame(run);
}

export function persistScrollForNavigation(
  targetPathname: string = window.location.pathname,
  preferredContainerSelector: string | null = null
): void {
  const { element: container, selector } = findActiveContainer(preferredContainerSelector);

  let offsetWithinContainer: number | null = null;
  if (container) {
    const containerTop = window.scrollY + container.getBoundingClientRect().top;
    offsetWithinContainer = window.scrollY - containerTop;
  }

  const anchor = container
    ? captureAnchor(container)
    : { anchorIndex: null, anchorTop: null };

  const payload: StoredScrollState = {
    pathname: targetPathname,
    scrollY: window.scrollY,
    containerSelector: selector,
    offsetWithinContainer,
    anchorIndex: anchor.anchorIndex,
    anchorTop: anchor.anchorTop,
    expiresAt: Date.now() + SCROLL_RESTORE_TTL_MS,
  };

  sessionStorage.setItem(SCROLL_RESTORE_KEY, JSON.stringify(payload));
}

export function restorePersistedScroll(): void {
  const raw = sessionStorage.getItem(SCROLL_RESTORE_KEY);
  if (!raw) return;

  let parsed: StoredScrollState;
  try {
    parsed = JSON.parse(raw) as StoredScrollState;
  } catch {
    sessionStorage.removeItem(SCROLL_RESTORE_KEY);
    return;
  }

  if (!parsed || Date.now() > parsed.expiresAt) {
    sessionStorage.removeItem(SCROLL_RESTORE_KEY);
    return;
  }

  if (parsed.pathname !== window.location.pathname) {
    return;
  }

  const restoreOnce = (): void => {
    // Never fight in-page anchor navigation.
    if (window.location.hash) return;

    const { element: container } = findActiveContainer(parsed.containerSelector);
    let targetTop = parsed.scrollY;

    if (container && parsed.anchorTop !== null) {
      const targetAnchor = resolveAnchorTarget(container, parsed);
      if (targetAnchor) {
        const delta = targetAnchor.getBoundingClientRect().top - parsed.anchorTop;
        targetTop = window.scrollY + delta;
      } else if (parsed.offsetWithinContainer !== null) {
        const containerTop = window.scrollY + container.getBoundingClientRect().top;
        targetTop = containerTop + parsed.offsetWithinContainer;
      }
    } else if (container && parsed.offsetWithinContainer !== null) {
      const containerTop = window.scrollY + container.getBoundingClientRect().top;
      targetTop = containerTop + parsed.offsetWithinContainer;
    }

    withInstantScroll(() => {
      window.scrollTo({
        top: clampScrollTop(targetTop),
        left: 0,
        behavior: 'auto',
      });
    });
  };

  sessionStorage.removeItem(SCROLL_RESTORE_KEY);

  scheduleRestorePasses(restoreOnce, SCROLL_RESTORE_PASSES);
  window.addEventListener('load', () => {
    scheduleRestorePasses(restoreOnce, SCROLL_RESTORE_PASSES);
  }, { once: true });
  setTimeout(() => {
    scheduleRestorePasses(restoreOnce, 2);
  }, 180);
}

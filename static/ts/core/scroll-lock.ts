// Counted in DOM attributes because each bundle has its own copy of this module.
const SCROLL_LOCK_COUNT_ATTR = 'data-scroll-lock-count';
const SCROLL_LOCK_Y_ATTR = 'data-scroll-lock-y';

/**
 * Lock page scrolling while preserving current scroll position.
 * Uses a lock count so multiple overlays can safely share the lock.
 */
export function lockBodyScroll(): void {
  const body = document.body;
  const lockCount = Number(body.getAttribute(SCROLL_LOCK_COUNT_ATTR) || '0');

  if (lockCount === 0) {
    const scrollY = window.scrollY || window.pageYOffset || 0;
    body.setAttribute(SCROLL_LOCK_Y_ATTR, String(scrollY));
    body.classList.add('modal-open');
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.overflow = 'hidden';
  }

  body.setAttribute(SCROLL_LOCK_COUNT_ATTR, String(lockCount + 1));
}

/**
 * Release one page scroll lock. Restores scroll position when fully unlocked.
 */
export function unlockBodyScroll(): void {
  const body = document.body;
  const lockCount = Number(body.getAttribute(SCROLL_LOCK_COUNT_ATTR) || '0');

  if (lockCount <= 0) {
    body.classList.remove('modal-open');
    return;
  }

  if (lockCount > 1) {
    body.setAttribute(SCROLL_LOCK_COUNT_ATTR, String(lockCount - 1));
    return;
  }

  const scrollY = Number(body.getAttribute(SCROLL_LOCK_Y_ATTR) || '0');

  body.removeAttribute(SCROLL_LOCK_COUNT_ATTR);
  body.removeAttribute(SCROLL_LOCK_Y_ATTR);
  body.classList.remove('modal-open');
  body.style.position = '';
  body.style.top = '';
  body.style.left = '';
  body.style.right = '';
  body.style.width = '';
  body.style.overflow = '';

  // Force instant restoration even when global smooth scrolling is enabled.
  const html = document.documentElement;
  const previousInlineScrollBehavior = html.style.scrollBehavior;
  html.style.scrollBehavior = 'auto';
  window.scrollTo({ top: scrollY, left: 0, behavior: 'auto' });
  requestAnimationFrame(() => {
    if (previousInlineScrollBehavior) {
      html.style.scrollBehavior = previousInlineScrollBehavior;
    } else {
      html.style.removeProperty('scroll-behavior');
    }
  });
}

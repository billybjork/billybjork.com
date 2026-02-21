/**
 * Project Bundle Entry Point
 * Loaded on all pages - handles project interactions and navigation
 */

import ProjectLoader from './loader';
import ProjectInteractions from './interactions';
import { createSandboxedIframe, cleanupIframe } from '../utils/html-sandbox';

// ========== HTML SANDBOX HYDRATION ==========

/**
 * Hydrate HTML sandbox placeholders by converting them to isolated iframes
 */
function hydrateSandboxes(container: HTMLElement | Document = document): void {
  container.querySelectorAll('.html-block-sandbox[data-html-b64]').forEach(el => {
    const encoded = el.getAttribute('data-html-b64');
    if (!encoded) return;

    try {
      const html = atob(encoded);
      const iframe = createSandboxedIframe(html, { allowFullscreen: true });
      const inlineStyle = el.getAttribute('style');
      const hasManualHeight = !!inlineStyle && /(^|;)\s*height\s*:/.test(inlineStyle);
      iframe.dataset.autoHeight = hasManualHeight ? 'false' : 'true';
      if (inlineStyle) {
        iframe.style.cssText += `; ${inlineStyle}`;
      }
      el.replaceWith(iframe);
    } catch (e) {
      console.error('Failed to decode HTML block:', e);
    }
  });
}

/**
 * Cleanup iframes before project swap
 */
function cleanupSandboxes(container: HTMLElement | Document = document): void {
  container.querySelectorAll('iframe.html-block-sandbox').forEach(iframe => {
    if (iframe instanceof HTMLIFrameElement) {
      cleanupIframe(iframe);
    }
  });
}

// ========== INITIALIZATION ==========

function initSandboxes(): void {
  // Initial page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => hydrateSandboxes());
  } else {
    hydrateSandboxes();
  }

  // After AJAX project swap
  document.body.addEventListener('project:afterSwap', (e: Event) => {
    const detail = (e as CustomEvent).detail;
    const container = detail?.element || document;
    hydrateSandboxes(container);
  });

  // Before project swap - cleanup
  document.body.addEventListener('project:beforeSwap', (e: Event) => {
    const detail = (e as CustomEvent).detail;
    const container = detail?.element || document;
    cleanupSandboxes(container);
  });
}

// Initialize modules
ProjectInteractions.init();
ProjectLoader.init();
initSandboxes();

// Export for window globals
export { ProjectLoader, ProjectInteractions, hydrateSandboxes, cleanupSandboxes };

// Re-export types
export type * from '../types/events';

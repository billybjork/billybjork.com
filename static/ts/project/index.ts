/**
 * Project Bundle Entry Point
 * Loaded on all pages - handles project interactions and navigation
 */

import ProjectLoader from './loader';
import ProjectInteractions from './interactions';
import {
  createSandboxedIframe,
  cleanupIframe,
  applySandboxInlineStyle,
  type SandboxAlignment,
} from '../utils/html-sandbox';

// ========== HTML SANDBOX HYDRATION ==========
let sandboxPlaceholderObserver: IntersectionObserver | null = null;

function inferLegacyHtmlBlockAlignment(html: string): SandboxAlignment | undefined {
  const trimmed = html.trim();
  const alignMatch = trimmed.match(
    /^<div\b[^>]*\bstyle\s*=\s*["'][^"']*\btext-align\s*:\s*(center|right)\b[^"']*["'][^>]*>[\s\S]*<\/div>$/i
  );
  if (!alignMatch) return undefined;
  return (alignMatch[1] as SandboxAlignment);
}

function hydrateSandboxPlaceholder(placeholder: Element): void {
  const encoded = placeholder.getAttribute('data-html-b64');
  if (!encoded) return;

  try {
    const html = atob(encoded);
    const iframe = createSandboxedIframe(html, { allowFullscreen: true });
    const inlineStyle = placeholder.getAttribute('style');
    const hasManualHeight = !!inlineStyle && /(^|;)\s*height\s*:/.test(inlineStyle);
    iframe.dataset.autoHeight = hasManualHeight ? 'false' : 'true';
    applySandboxInlineStyle(iframe, inlineStyle, inferLegacyHtmlBlockAlignment(html));
    placeholder.replaceWith(iframe);
  } catch (e) {
    console.error('Failed to decode HTML block:', e);
  }
}

function getSandboxPlaceholderObserver(): IntersectionObserver | null {
  if (!('IntersectionObserver' in window)) {
    return null;
  }
  if (sandboxPlaceholderObserver) {
    return sandboxPlaceholderObserver;
  }

  sandboxPlaceholderObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      hydrateSandboxPlaceholder(entry.target);
    });
  }, {
    rootMargin: '0px 0px 250px 0px',
    threshold: 0.01
  });

  return sandboxPlaceholderObserver;
}

/**
 * Hydrate HTML sandbox placeholders by converting them to isolated iframes.
 * Placeholders are observed and only hydrated when near viewport.
 */
function hydrateSandboxes(container: HTMLElement | Document = document): void {
  const placeholders = container.querySelectorAll('.html-block-sandbox[data-html-b64]');
  const observer = getSandboxPlaceholderObserver();

  placeholders.forEach(placeholder => {
    if (observer) {
      observer.observe(placeholder);
      return;
    }
    hydrateSandboxPlaceholder(placeholder);
  });
}

/**
 * Cleanup iframes before project swap
 */
function cleanupSandboxes(container: HTMLElement | Document = document): void {
  if (sandboxPlaceholderObserver) {
    container.querySelectorAll('.html-block-sandbox[data-html-b64]').forEach(placeholder => {
      sandboxPlaceholderObserver?.unobserve(placeholder);
    });
  }

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

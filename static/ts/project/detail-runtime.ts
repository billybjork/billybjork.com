import { checkAndHighlightCode } from './code-highlighting';
import { hydrateProjectMedia } from './interactions';
import {
  setupHeroVideoPlayer,
  destroyHeroVideoPlayer,
} from './hero-player';
import {
  createSandboxedIframe,
  cleanupIframe,
  applySandboxInlineStyle,
  type SandboxAlignment,
} from '../utils/html-sandbox';

let sandboxPlaceholderObserver: IntersectionObserver | null = null;

function loadCodeHighlightingIfNeeded(targetElement: Element): void {
  if (!targetElement.querySelector('pre code')) {
    return;
  }

  checkAndHighlightCode(targetElement);
}

function inferLegacyHtmlBlockAlignment(html: string): SandboxAlignment | undefined {
  const trimmed = html.trim();
  const alignMatch = trimmed.match(
    /^<div\b[^>]*\bstyle\s*=\s*["'][^"']*\btext-align\s*:\s*(center|right)\b[^"']*["'][^>]*>[\s\S]*<\/div>$/i
  );
  if (!alignMatch) return undefined;
  return alignMatch[1] as SandboxAlignment;
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
  } catch (error) {
    console.error('Failed to decode HTML block:', error);
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
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      hydrateSandboxPlaceholder(entry.target);
    });
  }, {
    rootMargin: '0px 0px 250px 0px',
    threshold: 0.01,
  });

  return sandboxPlaceholderObserver;
}

function getHighlightTarget(root: HTMLElement | Document): Element | null {
  if (root instanceof HTMLElement) {
    return root;
  }
  if (root instanceof Document) {
    return root.documentElement;
  }
  return null;
}

export function hydrateProjectDetail(root: HTMLElement | Document = document): void {
  const placeholders = root.querySelectorAll('.html-block-sandbox[data-html-b64]');
  const observer = getSandboxPlaceholderObserver();

  placeholders.forEach((placeholder) => {
    if (observer) {
      observer.observe(placeholder);
      return;
    }
    hydrateSandboxPlaceholder(placeholder);
  });

  hydrateProjectMedia(root);

  const highlightTarget = getHighlightTarget(root);
  if (highlightTarget) {
    loadCodeHighlightingIfNeeded(highlightTarget);
  }
}

export function cleanupProjectDetail(root: HTMLElement | Document = document): void {
  if (sandboxPlaceholderObserver) {
    root.querySelectorAll('.html-block-sandbox[data-html-b64]').forEach((placeholder) => {
      sandboxPlaceholderObserver?.unobserve(placeholder);
    });
  }

  root.querySelectorAll('iframe.html-block-sandbox').forEach((iframe) => {
    if (iframe instanceof HTMLIFrameElement) {
      cleanupIframe(iframe);
    }
  });
}

export const projectDetailRuntime = {
  hydrateDetail: hydrateProjectDetail,
  cleanupDetail: cleanupProjectDetail,
  setupHeroVideo: setupHeroVideoPlayer,
  destroyHeroVideo: destroyHeroVideoPlayer,
};

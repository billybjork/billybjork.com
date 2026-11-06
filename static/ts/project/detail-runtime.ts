import { checkAndHighlightCode } from './code-highlighting';
import { scrollToHashTarget } from './hash-scroll';
import { destroyHeroVideoPlayer } from './hero-player';
import { initializeLightboxMedia } from './lightbox';
import type { Alignment } from '../core/alignment';
import { createSandboxedIframe } from '../core/html-sandbox';

export { prepareHeroVideo } from './hero-player';

function decodeHtmlBlock(encoded: string): string {
  const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** A block whose whole content is one aligned <div> aligns its iframe the same way. */
function inferHtmlBlockAlignment(html: string): Alignment | undefined {
  const alignMatch = html.trim().match(
    /^<div\b[^>]*\bstyle\s*=\s*["'][^"']*\btext-align\s*:\s*(center|right)\b[^"']*["'][^>]*>[\s\S]*<\/div>$/i
  );
  return alignMatch?.[1] as Alignment | undefined;
}

function hydrateSandboxPlaceholder(placeholder: Element): void {
  const encoded = placeholder.getAttribute('data-html-b64');
  if (!encoded) return;

  try {
    const html = decodeHtmlBlock(encoded);
    placeholder.replaceWith(createSandboxedIframe(html, placeholder.getAttribute('style'), inferHtmlBlockAlignment(html)));
  } catch (error) {
    console.error('Failed to decode HTML block:', error);
  }
}

function hydrateInlineVideo(video: HTMLVideoElement): void {
  [video, ...video.querySelectorAll<HTMLSourceElement>('source[data-src]')].forEach((element) => {
    const src = element.dataset.src;
    if (!src) return;
    element.src = src;
    element.removeAttribute('data-src');
  });
  video.load();

  if (video.autoplay || video.hasAttribute('autoplay')) {
    video.play().catch(() => {
      // Autoplay was blocked; the viewer can still start playback.
    });
  }
}

const hydrateNearViewport = new IntersectionObserver((entries, observer) => {
  entries.forEach(({ isIntersecting, target }) => {
    if (!isIntersecting) return;
    observer.unobserve(target);
    if (target instanceof HTMLVideoElement) {
      hydrateInlineVideo(target);
    } else {
      hydrateSandboxPlaceholder(target);
    }
  });
}, {
  rootMargin: '0px 0px 250px 0px',
  threshold: 0.01,
});

function openExternalLinksInNewTab(root: ParentNode): void {
  root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
    if (link.host && link.host !== window.location.host) {
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

export function hydrateProjectDetail(root: HTMLElement): void {
  root.querySelectorAll('.html-block-sandbox[data-html-b64], video.lazy-inline-video').forEach((element) => {
    hydrateNearViewport.observe(element);
  });
  initializeLightboxMedia(root);
  openExternalLinksInNewTab(root);
  checkAndHighlightCode(root);
}

export function cleanupProjectDetail(root: HTMLElement): void {
  hydrateNearViewport.disconnect();
  root.querySelectorAll<HTMLVideoElement>('.video-container video').forEach(destroyHeroVideoPlayer);
}

/** Lands on the URL's hash target, or at the top of the scroll container without one. */
export function syncDetailScroll(scrollContainer: HTMLElement): void {
  if (window.location.hash) {
    scrollToHashTarget('auto');
  } else {
    scrollContainer.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }
}

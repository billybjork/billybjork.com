/**
 * Project Interactions Module
 * Generic detail hydration for project content mounted anywhere on the site.
 */

import { copyToClipboard, showNotification } from './clipboard';
import { resolveHashTarget, scrollToHashTarget } from './hash-scroll';
import {
  closeActiveLightbox,
  initializeLightboxMedia,
  isEligibleLightboxVideo,
  openImageLightbox,
  openVideoLightbox,
} from './lightbox';

function openExternalLinksInNewTab(root: ParentNode = document): void {
  const links = root.querySelectorAll<HTMLAnchorElement>('a[href]');
  const currentHost = window.location.host;

  links.forEach((link) => {
    const href = link.getAttribute('href');
    if (!href) return;

    if (
      href.startsWith('#') ||
      href.startsWith('/') ||
      href.startsWith('../') ||
      href.startsWith('mailto:') ||
      href.startsWith('tel:')
    ) {
      return;
    }

    try {
      const url = new URL(href, window.location.origin);
      if (url.host !== currentHost) {
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
      }
    } catch {
      // Ignore invalid URLs.
    }
  });
}

let thumbnailObserver: IntersectionObserver | null = null;

function getThumbnailObserver(): IntersectionObserver | null {
  if (!('IntersectionObserver' in window)) {
    return null;
  }
  if (thumbnailObserver) {
    return thumbnailObserver;
  }

  thumbnailObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;

      const thumbnail = entry.target as HTMLElement;
      const bgImage = thumbnail.getAttribute('data-bg');
      if (bgImage) {
        const img = new Image();
        img.onload = () => {
          thumbnail.style.backgroundImage = `url('${bgImage}')`;
          thumbnail.removeAttribute('data-bg');
          requestAnimationFrame(() => {
            thumbnail.classList.remove('lazy-thumbnail');
          });
        };
        img.src = bgImage;
      }

      observer.unobserve(thumbnail);
    });
  }, {
    rootMargin: '0px 0px 50px 0px',
    threshold: 0.1,
  });

  return thumbnailObserver;
}

function initializeLazyThumbnails(root: ParentNode = document): void {
  const lazyThumbnails = root.querySelectorAll<HTMLElement>('.lazy-thumbnail');
  const observer = getThumbnailObserver();

  lazyThumbnails.forEach((thumbnail) => {
    if (!thumbnail.getAttribute('data-bg')) return;
    if (observer) {
      observer.observe(thumbnail);
      return;
    }

    const bgImage = thumbnail.getAttribute('data-bg');
    if (!bgImage) return;
    thumbnail.style.backgroundImage = `url('${bgImage}')`;
    thumbnail.removeAttribute('data-bg');
    thumbnail.classList.remove('lazy-thumbnail');
  });
}

let inlineVideoObserver: IntersectionObserver | null = null;

function hydrateInlineVideo(video: HTMLVideoElement): void {
  if (video.dataset.loaded === 'true') {
    return;
  }

  let hasMediaSource = false;

  const videoSrc = video.dataset.src;
  if (videoSrc) {
    video.src = videoSrc;
    video.removeAttribute('data-src');
    hasMediaSource = true;
  }

  const sourceElements = video.querySelectorAll<HTMLSourceElement>('source[data-src]');
  sourceElements.forEach((source) => {
    const sourceSrc = source.dataset.src;
    if (!sourceSrc) return;
    source.src = sourceSrc;
    source.removeAttribute('data-src');
    hasMediaSource = true;
  });

  if (!hasMediaSource) {
    video.dataset.loaded = 'true';
    return;
  }

  video.dataset.loaded = 'true';
  video.load();

  if (video.autoplay || video.hasAttribute('autoplay')) {
    video.play().catch(() => {
      // Ignore autoplay failures; user interaction can still start playback.
    });
  }
}

function getInlineVideoObserver(): IntersectionObserver | null {
  if (!('IntersectionObserver' in window)) {
    return null;
  }
  if (inlineVideoObserver) {
    return inlineVideoObserver;
  }

  inlineVideoObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const video = entry.target as HTMLVideoElement;
      observer.unobserve(video);
      hydrateInlineVideo(video);
    });
  }, {
    rootMargin: '0px 0px 250px 0px',
    threshold: 0.01,
  });

  return inlineVideoObserver;
}

function initializeLazyInlineVideos(root: ParentNode = document): void {
  const inlineVideos = root.querySelectorAll<HTMLVideoElement>('video.lazy-inline-video');
  const observer = getInlineVideoObserver();

  inlineVideos.forEach((video) => {
    if (video.dataset.loaded === 'true') return;
    if (observer) {
      observer.observe(video);
      return;
    }
    hydrateInlineVideo(video);
  });
}

export function hydrateProjectMedia(root: ParentNode = document): void {
  initializeLazyInlineVideos(root);
  initializeLazyThumbnails(root);
  initializeLightboxMedia(root);
  openExternalLinksInNewTab(root);
}

function handleCopyLinkClick(event: MouseEvent): void {
  const button = (event.target as HTMLElement).closest<HTMLElement>('.copy-text-link');
  if (!button) return;

  event.preventDefault();
  const textToCopy = button.getAttribute('data-copy-text');
  const notificationMessage = button.getAttribute('data-notification-message') || 'URL copied to clipboard!';

  if (textToCopy) {
    copyToClipboard(textToCopy, notificationMessage);
    return;
  }

  showNotification('No content available to copy.', true);
}

function handleMediaLightboxClick(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  const image = target.closest<HTMLImageElement>('.project-content img');
  if (image) {
    event.preventDefault();
    openImageLightbox(image);
    return;
  }

  const video = target.closest<HTMLVideoElement>('.project-content video');
  if (!video || !isEligibleLightboxVideo(video)) {
    return;
  }

  event.preventDefault();
  openVideoLightbox(video);
}

function handleInPageAnchorClick(event: MouseEvent): void {
  const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('.project-content a[href^="#"]');
  if (!anchor) return;
  if (event.defaultPrevented) return;
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

  const href = anchor.getAttribute('href') || '';
  const target = resolveHashTarget(href);
  if (!target) return;

  event.preventDefault();

  const nextUrl = new URL(window.location.href);
  nextUrl.hash = target.id;
  history.pushState(history.state, '', nextUrl.toString());

  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  requestAnimationFrame(() => {
    target.scrollIntoView({ behavior: 'auto', block: 'start' });
  });
  setTimeout(() => {
    target.scrollIntoView({ behavior: 'auto', block: 'start' });
  }, 180);
}

function handleEscapeKey(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  if (document.body.classList.contains('editing')) return;
  closeActiveLightbox();
}

function handleSiteTitleClick(event: MouseEvent): void {
  const siteTitle = (event.target as HTMLElement).closest<HTMLAnchorElement>('a.site-title');
  if (!siteTitle) return;
  if (window.location.pathname !== '/me') return;

  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  if (siteTitle.target && siteTitle.target !== '_self') {
    return;
  }

  let destination: URL;
  try {
    destination = new URL(siteTitle.href, window.location.origin);
  } catch {
    return;
  }
  if (destination.origin !== window.location.origin || destination.pathname !== '/') {
    return;
  }

  try {
    const referrer = document.referrer ? new URL(document.referrer) : null;
    const cameFromHome = !!referrer
      && referrer.origin === window.location.origin
      && referrer.pathname === '/';
    if (!cameFromHome) return;
  } catch {
    return;
  }

  event.preventDefault();
  window.history.back();
}

function initializeEventListeners(): void {
  document.body.addEventListener('click', handleCopyLinkClick);
  document.body.addEventListener('click', handleMediaLightboxClick);
  document.body.addEventListener('click', handleInPageAnchorClick);
  document.body.addEventListener('click', handleSiteTitleClick);
  document.addEventListener('keydown', handleEscapeKey);
}

function init(): void {
  initializeEventListeners();
  window.addEventListener('load', () => scrollToHashTarget('auto'));
}

const ProjectInteractions = {
  init,
};

export default ProjectInteractions;

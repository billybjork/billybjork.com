import { isEditingActive } from '../core/edit-state';
import { copyToClipboard } from './clipboard';
import { resolveHashTarget } from './hash-scroll';
import {
  closeActiveLightbox,
  isEligibleLightboxVideo,
  openImageLightbox,
  openVideoLightbox,
} from './lightbox';

const LATE_LAYOUT_SETTLE_MS = 180;

function handleCopyLinkClick(event: MouseEvent): void {
  const button = (event.target as HTMLElement).closest<HTMLElement>('.copy-text-link');
  if (!button) return;

  event.preventDefault();
  const textToCopy = button.getAttribute('data-copy-text');
  if (textToCopy) {
    copyToClipboard(textToCopy, button.getAttribute('data-notification-message') ?? undefined);
  }
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

  const target = resolveHashTarget(anchor.getAttribute('href') || '');
  if (!target) return;

  event.preventDefault();

  const nextUrl = new URL(window.location.href);
  nextUrl.hash = target.id;
  history.pushState(history.state, '', nextUrl.toString());

  target.scrollIntoView({ behavior: 'auto', block: 'start' });
  // Lazy media above the target can load as the jump lands and push it away.
  setTimeout(() => {
    target.scrollIntoView({ behavior: 'auto', block: 'start' });
  }, LATE_LAYOUT_SETTLE_MS);
}

function handleEscapeKey(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || isEditingActive()) return;
  if (closeActiveLightbox()) {
    event.preventDefault();
  }
}

/**
 * Click and keyboard handling for project content, wherever it is mounted.
 * The lightbox sits on top of everything, so it sees Escape first (capture)
 * and marks the event handled for whatever is beneath it.
 */
export function initProjectInteractions(): void {
  document.body.addEventListener('click', handleCopyLinkClick);
  document.body.addEventListener('click', handleMediaLightboxClick);
  document.body.addEventListener('click', handleInPageAnchorClick);
  document.addEventListener('keydown', handleEscapeKey, true);
}

/**
 * Project Content Lightbox Utilities
 */

import { lockBodyScroll, unlockBodyScroll } from '../core/utils';

const LIGHTBOX_VIDEO_TRIGGER_CLASS = 'lightbox-trigger-video';

function closeLightboxOverlay(overlay: HTMLElement): void {
  if (overlay.dataset.closing === 'true') return;
  overlay.dataset.closing = 'true';

  const lightboxVideo = overlay.querySelector<HTMLVideoElement>('video');
  if (lightboxVideo) {
    lightboxVideo.pause();
  }

  unlockBodyScroll();
  overlay.classList.remove('visible');
  overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
}

export function closeActiveLightbox(): boolean {
  const lightbox = document.querySelector<HTMLElement>('.image-lightbox');
  if (!lightbox) return false;
  closeLightboxOverlay(lightbox);
  return true;
}

function videoHasNativeFullscreenControls(videoElement: HTMLVideoElement): boolean {
  return videoElement.controls || videoElement.hasAttribute('controls');
}

export function isEligibleLightboxVideo(videoElement: HTMLVideoElement): boolean {
  if (!videoElement.closest('.project-content')) return false;
  if (videoElement.closest('.video-container')) return false;
  if (videoElement.dataset.lightbox === 'off') return false;
  if (videoHasNativeFullscreenControls(videoElement)) return false;
  return (
    videoElement.loop ||
    videoElement.autoplay ||
    videoElement.hasAttribute('loop') ||
    videoElement.hasAttribute('autoplay')
  );
}

export function initializeLightboxMedia(root: ParentNode = document): void {
  const videos = root.querySelectorAll<HTMLVideoElement>('.project-content video');
  videos.forEach(video => {
    video.classList.toggle(LIGHTBOX_VIDEO_TRIGGER_CLASS, isEligibleLightboxVideo(video));
  });
}

function createLightboxOverlay(): { overlay: HTMLElement; closeButton: HTMLButtonElement } {
  const overlay = document.createElement('div');
  overlay.className = 'image-lightbox';

  const closeButton = document.createElement('button');
  closeButton.className = 'image-lightbox-close';
  closeButton.setAttribute('type', 'button');
  closeButton.setAttribute('aria-label', 'Close media');
  closeButton.innerHTML = '&times;';

  overlay.appendChild(closeButton);
  return { overlay, closeButton };
}

function attachLightboxCloseHandlers(overlay: HTMLElement, closeButton: HTMLButtonElement): void {
  const closeLightbox = () => closeLightboxOverlay(overlay);
  closeButton.addEventListener('click', closeLightbox);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeLightbox();
    }
  });
}

export function openImageLightbox(image: HTMLImageElement): void {
  closeActiveLightbox();

  const { overlay, closeButton } = createLightboxOverlay();
  const enlargedImage = document.createElement('img');
  enlargedImage.src = image.currentSrc || image.src;
  enlargedImage.alt = image.alt || '';

  overlay.appendChild(enlargedImage);
  document.body.appendChild(overlay);
  lockBodyScroll();
  requestAnimationFrame(() => overlay.classList.add('visible'));
  attachLightboxCloseHandlers(overlay, closeButton);
}

export function openVideoLightbox(video: HTMLVideoElement): void {
  closeActiveLightbox();

  const { overlay, closeButton } = createLightboxOverlay();
  const enlargedVideo = video.cloneNode(true) as HTMLVideoElement;

  enlargedVideo.removeAttribute('id');
  enlargedVideo.classList.remove('lazy-video', 'lazy-inline-video', 'hls-video', LIGHTBOX_VIDEO_TRIGGER_CLASS);

  const shouldAutoplay = video.autoplay || video.hasAttribute('autoplay') || video.loop || video.hasAttribute('loop');
  const shouldLoop = video.loop || video.hasAttribute('loop');

  enlargedVideo.controls = false;
  enlargedVideo.removeAttribute('controls');
  enlargedVideo.autoplay = shouldAutoplay;
  enlargedVideo.loop = shouldLoop;
  enlargedVideo.muted = true;
  enlargedVideo.defaultMuted = true;
  enlargedVideo.playsInline = true;
  enlargedVideo.preload = 'auto';

  if (shouldAutoplay) {
    enlargedVideo.setAttribute('autoplay', '');
  } else {
    enlargedVideo.removeAttribute('autoplay');
  }

  if (shouldLoop) {
    enlargedVideo.setAttribute('loop', '');
  } else {
    enlargedVideo.removeAttribute('loop');
  }

  enlargedVideo.setAttribute('muted', '');
  enlargedVideo.setAttribute('playsinline', '');

  if (video.currentSrc) {
    enlargedVideo.src = video.currentSrc;
  }

  overlay.appendChild(enlargedVideo);
  document.body.appendChild(overlay);
  lockBodyScroll();
  requestAnimationFrame(() => {
    overlay.classList.add('visible');
    if (shouldAutoplay) {
      enlargedVideo.play().catch(() => {
        // Ignore autoplay errors; user can still close the modal.
      });
    }
  });

  attachLightboxCloseHandlers(overlay, closeButton);
}

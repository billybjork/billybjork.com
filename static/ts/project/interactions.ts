/**
 * Project Interactions Module
 * Handles project item interactions, HLS video, thumbnails, and animations
 */

import type { ProjectEventDetail } from '../types/events';
import { lockBodyScroll, unlockBodyScroll } from '../core/utils';
import { closeProject as closeProjectBySlug } from './loader';

// ========== UTILITY FUNCTIONS ==========

/**
 * Resets the background position of a thumbnail element.
 */
function resetThumbnailPosition(thumbnail: HTMLElement): void {
  if (thumbnail) {
    thumbnail.style.backgroundPosition = '0 0';
  }
}

/**
 * Scrolls smoothly to a given project header with an offset.
 */
function scrollToProjectHeader(projectHeader: HTMLElement): void {
  const offset = 40;
  const headerRect = projectHeader.getBoundingClientRect();
  const absoluteElementTop = headerRect.top + window.pageYOffset;
  const scrollToPosition = absoluteElementTop - offset;

  window.scrollTo({
    top: scrollToPosition,
    behavior: 'smooth'
  });
}

/**
 * Generic function to display notifications
 */
function showNotification(message: string, isError: boolean = false): void {
  const notification = document.createElement('div');
  notification.className = `copy-notification${isError ? ' error' : ''}`;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    if (notification.parentNode) {
      document.body.removeChild(notification);
    }
  }, 4000);
}

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

function closeActiveLightbox(): boolean {
  const lightbox = document.querySelector<HTMLElement>('.image-lightbox');
  if (!lightbox) return false;
  closeLightboxOverlay(lightbox);
  return true;
}

const LIGHTBOX_VIDEO_TRIGGER_CLASS = 'lightbox-trigger-video';

function videoHasNativeFullscreenControls(videoElement: HTMLVideoElement): boolean {
  return videoElement.controls || videoElement.hasAttribute('controls');
}

function isEligibleLightboxVideo(videoElement: HTMLVideoElement): boolean {
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

function initializeLightboxMedia(root: ParentNode = document): void {
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

function openImageLightbox(image: HTMLImageElement): void {
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

function openVideoLightbox(video: HTMLVideoElement): void {
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

/**
 * Copies text to clipboard and shows a notification
 */
function copyToClipboard(text: string, notificationMessage: string = 'URL copied to clipboard!'): void {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => {
        showNotification(notificationMessage);
      })
      .catch(err => {
        console.error('Failed to copy using Clipboard API: ', err);
        showNotification('Failed to copy the URL.', true);
      });
  } else {
    console.warn('Clipboard API not supported in this browser.');
    showNotification('Copy to clipboard not supported in this browser.', true);
  }
}

/**
 * Opens external links in new tabs.
 */
function openExternalLinksInNewTab(root: ParentNode = document): void {
  const links = root.querySelectorAll<HTMLAnchorElement>('a[href]');
  const currentHost = window.location.host;

  links.forEach(link => {
    const href = link.getAttribute('href');
    if (!href) return;

    if (href.startsWith('#') ||
        href.startsWith('/') ||
        href.startsWith('../') ||
        href.startsWith('mailto:') ||
        href.startsWith('tel:')) {
      return;
    }

    try {
      const url = new URL(href, window.location.origin);
      if (url.host !== currentHost) {
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
      }
    } catch {
      // Invalid URL, skip
    }
  });
}

// ========== INTERSECTION OBSERVER FOR PROJECT ITEMS ==========

/**
 * Callback for IntersectionObserver to handle visibility of project items.
 */
function handleProjectIntersection(
  entries: IntersectionObserverEntry[],
  observer: IntersectionObserver
): void {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const projectItem = entry.target as HTMLElement;
      projectItem.classList.add('fade-in');
      observer.unobserve(projectItem);
    }
  });
}

const projectObserver = new IntersectionObserver(handleProjectIntersection, {
  root: null,
  rootMargin: '0px',
  threshold: 0.1
});

/**
 * Observes all project items that haven't been animated yet.
 */
function observeProjectItems(projectItems: NodeListOf<Element> | Element[]): void {
  projectItems.forEach(item => {
    if (!item.classList.contains('fade-in') && !item.classList.contains('no-fade')) {
      projectObserver.observe(item);
    }
  });
}

/**
 * Initializes the observer for existing project items on page load.
 */
function initializeProjectObserver(): void {
  const existingProjectItems = document.querySelectorAll('.project-item');
  observeProjectItems(existingProjectItems);
}

// ========== INTERSECTION OBSERVER FOR THUMBNAILS ==========

/**
 * Callback for IntersectionObserver to handle lazy loading of thumbnails.
 */
function handleThumbnailIntersection(
  entries: IntersectionObserverEntry[],
  observer: IntersectionObserver
): void {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
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
    }
  });
}

const thumbnailObserver = new IntersectionObserver(handleThumbnailIntersection, {
  rootMargin: '0px 0px 50px 0px',
  threshold: 0.1
});

/**
 * Initializes lazy loading for thumbnails within a given root.
 */
function initializeLazyThumbnails(root: ParentNode = document): void {
  const lazyThumbnails = root.querySelectorAll<HTMLElement>('.lazy-thumbnail');

  lazyThumbnails.forEach(thumbnail => {
    if (thumbnail.getAttribute('data-bg')) {
      thumbnailObserver.observe(thumbnail);
    }
  });
}

// ========== HLS VIDEO PLAYER ==========

const HLS_JS_SRC = document.body.dataset.hlsJsSrc || 'https://cdn.jsdelivr.net/npm/hls.js@1.5.12';
let hlsScriptPromise: Promise<void> | null = null;
const MOBILE_BREAKPOINT = 768;
const VIDEO_VIEWPORT_PADDING_MOBILE = 12;
const VIDEO_VIEWPORT_PADDING_DESKTOP = 24;
const VIDEO_MIN_RENDER_HEIGHT = 180;

function getVideoContainer(videoElement: HTMLVideoElement): HTMLElement | null {
  return videoElement.closest<HTMLElement>('.video-container');
}

function updateVideoContainerLayout(videoElement: HTMLVideoElement): void {
  const container = getVideoContainer(videoElement);
  if (!container) return;

  const nativeWidth = videoElement.videoWidth;
  const nativeHeight = videoElement.videoHeight;
  if (!nativeWidth || !nativeHeight) return;
  const aspectRatio = nativeWidth / nativeHeight;

  const viewportPadding = window.innerWidth <= MOBILE_BREAKPOINT
    ? VIDEO_VIEWPORT_PADDING_MOBILE
    : VIDEO_VIEWPORT_PADDING_DESKTOP;
  const containerRect = container.getBoundingClientRect();
  const topOffset = Math.max(containerRect.top, viewportPadding);
  const availableHeight = window.innerHeight - topOffset - viewportPadding;
  const maxHeight = Math.max(VIDEO_MIN_RENDER_HEIGHT, Math.floor(availableHeight));

  container.style.setProperty('--video-aspect-ratio', aspectRatio.toString());
  container.style.setProperty('--video-max-height', `${maxHeight}px`);
  container.classList.add('video-dimensions-ready');
}

function bindVideoLayout(videoElement: HTMLVideoElement): void {
  if (videoElement.videoLayoutCleanup) {
    videoElement.videoLayoutCleanup();
  }

  const refreshLayout = () => updateVideoContainerLayout(videoElement);
  let scrollRafId: number | null = null;
  const handleScroll = () => {
    if (scrollRafId !== null) return;
    scrollRafId = window.requestAnimationFrame(() => {
      scrollRafId = null;
      refreshLayout();
    });
  };

  videoElement.addEventListener('loadedmetadata', refreshLayout);
  videoElement.addEventListener('resize', refreshLayout);
  window.addEventListener('resize', refreshLayout);
  window.addEventListener('scroll', handleScroll, { passive: true });
  refreshLayout();

  videoElement.videoLayoutCleanup = () => {
    videoElement.removeEventListener('loadedmetadata', refreshLayout);
    videoElement.removeEventListener('resize', refreshLayout);
    window.removeEventListener('resize', refreshLayout);
    window.removeEventListener('scroll', handleScroll);
    if (scrollRafId !== null) {
      window.cancelAnimationFrame(scrollRafId);
      scrollRafId = null;
    }

    const container = getVideoContainer(videoElement);
    if (!container) return;

    container.classList.remove('video-dimensions-ready');
    container.style.removeProperty('--video-aspect-ratio');
    container.style.removeProperty('--video-max-height');
  };
}

/**
 * Lazy-load HLS.js only when needed.
 */
function loadHlsScript(): Promise<void> {
  if (window.Hls) {
    return Promise.resolve();
  }
  if (hlsScriptPromise) {
    return hlsScriptPromise;
  }

  hlsScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = HLS_JS_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load HLS.js'));
    document.head.appendChild(script);
  });

  return hlsScriptPromise;
}

/**
 * Sets up HLS video player for a given video element.
 */
function setupHLSPlayer(videoElement: HTMLVideoElement, autoplay: boolean = false): Promise<void> {
  console.log('[HLS] setupHLSPlayer called', { autoplay });
  return new Promise((resolve, reject) => {
    const streamUrl = videoElement.dataset.hlsUrl;
    console.log('[HLS] Stream URL:', streamUrl);
    if (!streamUrl) {
      console.error('No HLS URL provided for video element');
      reject('No HLS URL provided');
      return;
    }

    videoElement.classList.add('hls-video');
    bindVideoLayout(videoElement);

    const initializeVideo = () => {
      updateVideoContainerLayout(videoElement);
      if (document.body.classList.contains('editing')) {
        videoElement.pause();
        resolve();
        return;
      }

      if (autoplay) {
        videoElement.play().catch(e => {
          if (e.name !== 'AbortError') {
            console.error("Autoplay failed:", e);
          }
        });
      }
      resolve();
    };

    const canPlayNative = videoElement.canPlayType('application/vnd.apple.mpegurl');
    console.log('[HLS] Native HLS support:', canPlayNative ? 'yes' : 'no');
    console.log('[HLS] HLS.js loaded:', !!window.Hls);
    console.log('[HLS] HLS.js supported:', window.Hls ? Hls.isSupported() : 'n/a');

    const initializeHls = () => {
      if (!window.Hls || !Hls.isSupported()) {
        if (canPlayNative) {
          videoElement.src = streamUrl;
          videoElement.addEventListener('loadedmetadata', initializeVideo, { once: true });
          return;
        }
        console.error('HLS is not supported in this browser');
        reject('HLS is not supported');
        return;
      }

      if (videoElement.hlsInstance) {
        console.warn('HLS instance already exists for this video element. Destroying existing instance.');
        videoElement.hlsInstance.destroy();
      }

      const hls = new Hls({
        abrEwmaDefaultEstimate: 5000000,
        capLevelToPlayerSize: true,
      });
      videoElement.hlsInstance = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(videoElement);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          console.log('[HLS] Available quality levels:');
          hls.levels.forEach((level, i) => {
            console.log(`  [${i}] ${level.height}p @ ${(level.bitrate / 1000000).toFixed(1)} Mbps`);
          });
          console.log(`[HLS] Starting level: ${hls.startLevel} (auto: ${hls.autoLevelEnabled})`);
          console.log(`[HLS] Current level: ${hls.currentLevel}, Next level: ${hls.nextLevel}`);
          initializeVideo();
        });
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        const levelData = data as { level: number };
        const level = hls.levels[levelData.level];
        if (level) {
          console.log(`[HLS] Switched to level ${levelData.level}: ${level.height}p @ ${(level.bitrate / 1000000).toFixed(1)} Mbps`);
        }
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        const errorData = data as { fatal?: boolean; type?: string; details?: string };
        if (errorData.fatal) {
          switch (errorData.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.error('Fatal network error encountered, trying to recover');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.error('Fatal media error encountered, trying to recover');
              hls.recoverMediaError();
              break;
            default:
              console.error('Fatal error encountered, destroying HLS instance:', data);
              hls.destroy();
              videoElement.hlsInstance = null;
              reject(data);
              break;
          }
        } else {
          if (errorData.details === 'bufferAppendError') {
            console.warn('HLS.js bufferAppendError encountered and ignored:', data);
            hls.recoverMediaError();
          } else {
            console.warn('HLS.js non-fatal error:', data);
          }
        }
      });
    };

    if (window.Hls && Hls.isSupported()) {
      console.log('[HLS] Using HLS.js (already loaded)');
      initializeHls();
      return;
    }

    console.log('[HLS] Loading HLS.js script...');
    loadHlsScript()
      .then(() => {
        if (Hls.isSupported()) {
          console.log('[HLS] HLS.js loaded and supported, using HLS.js');
          initializeHls();
        } else if (canPlayNative) {
          console.log('[HLS] HLS.js not supported, falling back to native');
          videoElement.src = streamUrl;
          videoElement.addEventListener('loadedmetadata', initializeVideo, { once: true });
        } else {
          console.error('HLS is not supported in this browser');
          reject('HLS is not supported');
        }
      })
      .catch(err => {
        if (canPlayNative) {
          console.log('[HLS] HLS.js failed to load, falling back to native');
          videoElement.src = streamUrl;
          videoElement.addEventListener('loadedmetadata', initializeVideo, { once: true });
          return;
        }
        console.error('Failed to load HLS.js:', err);
        reject(err);
      });
  });
}

/**
 * Destroys the HLS player instance and revokes the blob URL.
 */
function destroyHLSPlayer(videoElement: HTMLVideoElement): void {
  if (videoElement.videoLayoutCleanup) {
    videoElement.videoLayoutCleanup();
    videoElement.videoLayoutCleanup = null;
  }

  if (videoElement.hlsInstance) {
    videoElement.hlsInstance.destroy();
    videoElement.hlsInstance = null;
  }
  if (videoElement.src && videoElement.src.startsWith('blob:')) {
    const blobUrl = videoElement.src;
    URL.revokeObjectURL(blobUrl);
    videoElement.src = '';
  }
}

// ========== PROJECT ITEM HANDLING ==========

/**
 * Handles the opening or closing of project content.
 */
async function handleProjectContent(
  projectItem: HTMLElement,
  smoothScroll: boolean = true
): Promise<void> {
  try {
    const video = projectItem.querySelector<HTMLVideoElement>('video.lazy-video');
    const thumbnail = projectItem.querySelector<HTMLElement>('.thumbnail');

    if (projectItem.classList.contains('active')) {
      if (video) {
        await setupHLSPlayer(video, true);
      }

      const projectHeader = projectItem.querySelector<HTMLElement>('.project-header');
      if (projectHeader && smoothScroll) {
        scrollToProjectHeader(projectHeader);
      }
    } else {
      if (video) {
        video.pause();
        destroyHLSPlayer(video);
      }
      if (thumbnail) {
        resetThumbnailPosition(thumbnail);
      }
    }

    if (typeof updateThumbnails === 'function') {
      updateThumbnails();
    }
  } catch (error) {
    console.error('Error in handleProjectContent:', error);
  }
}

/**
 * Closes all open projects by removing their content and cleaning up resources.
 */
function closeAllOpenProjects(): void {
  const openProjectItems = document.querySelectorAll<HTMLElement>('.project-item.active');
  openProjectItems.forEach(projectItem => {
    projectItem.classList.remove('active');

    const video = projectItem.querySelector<HTMLVideoElement>('video.lazy-video');
    if (video) {
      video.pause();
      destroyHLSPlayer(video);
    }

    const projectDetails = projectItem.querySelector<HTMLElement>('.project-details');
    if (projectDetails) {
      projectDetails.innerHTML = '';
    }

    const thumbnail = projectItem.querySelector<HTMLElement>('.thumbnail');
    if (thumbnail) {
      resetThumbnailPosition(thumbnail);
    }
  });
}

// ========== ANIMATION LOOP FOR THUMBNAILS ==========

let animationProgress = 0;

function updateThumbnails(): void {
  const thumbnails = document.querySelectorAll<HTMLElement>('.thumbnail');

  if (!thumbnails.length) {
    return;
  }

  thumbnails.forEach(thumbnail => {
    const totalFrames = parseInt(thumbnail.dataset.frames ?? '0', 10);
    const frameWidth = parseInt(thumbnail.dataset.frameWidth ?? '0', 10);
    const frameHeight = parseInt(thumbnail.dataset.frameHeight ?? '0', 10);
    const columns = parseInt(thumbnail.dataset.columns ?? '1', 10);

    const rows = Math.ceil(totalFrames / columns);
    const spriteSheetWidth = frameWidth * columns;
    const spriteSheetHeight = frameHeight * rows;
    thumbnail.style.backgroundSize = `${spriteSheetWidth}px ${spriteSheetHeight}px`;

    let frameIndex = Math.floor(animationProgress) % totalFrames;
    if (frameIndex < 0) frameIndex += totalFrames;

    const frameX = (frameIndex % columns) * frameWidth;
    const frameY = Math.floor(frameIndex / columns) * frameHeight;

    thumbnail.style.backgroundPosition = `-${frameX}px -${frameY}px`;
  });
}

// ========== SCROLL HANDLING ==========

let lastScrollTop = window.pageYOffset || document.documentElement.scrollTop;
let lastScrollEventTime = Date.now();
let animationSpeed = 0;
let lastAnimationFrameTime = Date.now();
let animationFrameId: number | null = null;

function startAnimationLoop(): void {
  if (animationFrameId !== null || document.hidden) return;
  lastAnimationFrameTime = Date.now();
  animationFrameId = requestAnimationFrame(animationLoop);
}

function stopAnimationLoop(): void {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

function handleScroll(): void {
  const currentScrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const now = Date.now();
  const deltaTime = (now - lastScrollEventTime) / 1000;

  if (deltaTime > 0) {
    const scrollVelocity = (currentScrollTop - lastScrollTop) / deltaTime;
    const pixelsPerFrame = 3;
    animationSpeed = scrollVelocity / pixelsPerFrame;

    const maxAnimationSpeed = 30;
    const minAnimationSpeed = -30;
    animationSpeed = Math.max(minAnimationSpeed, Math.min(maxAnimationSpeed, animationSpeed));
  }

  lastScrollTop = currentScrollTop;
  lastScrollEventTime = now;

  if (Math.abs(animationSpeed) > 0.01) {
    startAnimationLoop();
  }
}

function animationLoop(): void {
  if (document.hidden) {
    stopAnimationLoop();
    return;
  }

  const now = Date.now();
  const deltaTime = (now - lastAnimationFrameTime) / 1000;
  lastAnimationFrameTime = now;

  const baseDeceleration = 15;
  const speedFactor = Math.abs(animationSpeed) * 0.1;
  const dynamicDeceleration = baseDeceleration + speedFactor;

  if (animationSpeed > 0) {
    animationSpeed = Math.max(0, animationSpeed - dynamicDeceleration * deltaTime);
  } else if (animationSpeed < 0) {
    animationSpeed = Math.min(0, animationSpeed + dynamicDeceleration * deltaTime);
  }

  animationProgress += animationSpeed * deltaTime;

  if (animationProgress > 1e6) animationProgress -= 1e6;
  if (animationProgress < -1e6) animationProgress += 1e6;

  updateThumbnails();

  if (Math.abs(animationSpeed) > 0.01) {
    animationFrameId = requestAnimationFrame(animationLoop);
  } else {
    animationSpeed = 0;
    stopAnimationLoop();
  }
}

// ========== INITIALIZATION ==========

function initializeThumbnails(): void {
  const isRoot = window.location.pathname === '/';

  if (!isRoot) {
    const existingProjectItems = document.querySelectorAll<HTMLElement>('.project-item');
    existingProjectItems.forEach(item => {
      item.classList.add('no-fade');
    });
  }

  initializeLazyThumbnails();
  updateThumbnails();
  window.addEventListener('scroll', handleScroll);
}

/**
 * Initializes lazy loading for video elements within a given root.
 */
function initializeLazyVideos(root: ParentNode = document): void {
  const lazyVideos = root.querySelectorAll<HTMLVideoElement>('video.lazy-video');

  if ('IntersectionObserver' in window) {
    const videoObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const video = entry.target as HTMLVideoElement;
          setupHLSPlayer(video, false).catch(err => {
            console.error('Failed to initialize HLS player for video:', err);
          });
          observer.unobserve(video);
          video.dataset.loaded = 'true';
        }
      });
    }, {
      rootMargin: '0px 0px 200px 0px',
      threshold: 0.25
    });

    lazyVideos.forEach(video => {
      if (!video.dataset.loaded) {
        videoObserver.observe(video);
      }
    });
  } else {
    lazyVideos.forEach(video => {
      setupHLSPlayer(video, false).catch(err => {
        console.error('Failed to initialize HLS player for video:', err);
      });
      video.dataset.loaded = 'true';
    });
  }
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
  sourceElements.forEach(source => {
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
      // Ignore autoplay errors; user interaction can still start playback.
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
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const video = entry.target as HTMLVideoElement;
      observer.unobserve(video);
      hydrateInlineVideo(video);
    });
  }, {
    rootMargin: '0px 0px 250px 0px',
    threshold: 0.01
  });

  return inlineVideoObserver;
}

function initializeLazyInlineVideos(root: ParentNode = document): void {
  const inlineVideos = root.querySelectorAll<HTMLVideoElement>('video.lazy-inline-video');
  const observer = getInlineVideoObserver();

  inlineVideos.forEach(video => {
    if (video.dataset.loaded === 'true') return;
    if (observer) {
      observer.observe(video);
    } else {
      hydrateInlineVideo(video);
    }
  });
}

function initializeProjects(): void {
  initializeLazyVideos();
  initializeLazyInlineVideos();
  initializeLazyThumbnails();
  initializeLightboxMedia();
  handleInitialLoad();
}

function handleInitialLoad(): void {
  const openProjectItem = document.querySelector<HTMLElement>('.project-item.active');
  if (openProjectItem) {
    if (document.readyState === 'complete') {
      handleProjectContent(openProjectItem, false);
    } else {
      window.addEventListener('load', () => {
        handleProjectContent(openProjectItem, false);
      });
    }
  }
}

// ========== CLEANUP ==========

function cleanupActiveHLSPlayers(): void {
  const activeVideos = document.querySelectorAll<HTMLVideoElement>('video.hls-video');
  activeVideos.forEach(video => {
    destroyHLSPlayer(video);
  });

  const videosWithHlsInstance = document.querySelectorAll<HTMLVideoElement>('video');
  videosWithHlsInstance.forEach(video => {
    if (video.hlsInstance) {
      destroyHLSPlayer(video);
    }
  });
}

// ========== PROJECT EVENT HANDLERS ==========

function handleProjectBeforeSwap(): void {
  cleanupActiveHLSPlayers();
}

function handleProjectAfterSwap(event: CustomEvent<ProjectEventDetail>): void {
  const { element, isOpen, smoothScroll = true } = event.detail;

  if (!element) return;

  const projectItem = element.closest<HTMLElement>('.project-item');
  if (!projectItem) return;

  if (isOpen) {
    const video = element.querySelector<HTMLVideoElement>('video.lazy-video');
    if (video) {
      setupHLSPlayer(video, true).catch(err => {
        console.error('Failed to initialize HLS player:', err);
      });
    }

    const projectHeader = projectItem.querySelector<HTMLElement>('.project-header');
    if (projectHeader && smoothScroll) {
      scrollToProjectHeader(projectHeader);
    }
  } else {
    const video = projectItem.querySelector<HTMLVideoElement>('video.lazy-video');
    if (video) {
      video.pause();
      destroyHLSPlayer(video);
    }
    const thumbnail = projectItem.querySelector<HTMLElement>('.thumbnail');
    if (thumbnail) {
      resetThumbnailPosition(thumbnail);
    }
  }

  initializeLazyThumbnails(element);
  initializeLazyVideos(element);
  initializeLazyInlineVideos(element);
  initializeLightboxMedia(element);
  updateThumbnails();
  openExternalLinksInNewTab(element);
}

function handleProjectsLoaded(): void {
  const newProjectItems = document.querySelectorAll('.project-item:not(.fade-in):not(.no-fade)');
  observeProjectItems(newProjectItems);
  initializeLazyThumbnails();
  updateThumbnails();
}

function handleProjectLoaded(event: CustomEvent<ProjectEventDetail>): void {
  const { element } = event.detail;
  const projectItem = element?.closest<HTMLElement>('.project-item');
  if (projectItem) {
    handleProjectContent(projectItem);
  }
}

/**
 * Closes a specific project item smoothly.
 */
function closeProject(button: HTMLElement): void {
  const projectItem = button.closest<HTMLElement>('.project-item');
  if (!projectItem) return;

  const isIsolationMode = document.body.dataset.isolationMode === 'true';

  if (isIsolationMode) {
    projectItem.classList.add('fade-out');

    projectItem.addEventListener('animationend', function handler() {
      projectItem.removeEventListener('animationend', handler);
      const url = new URL('/', window.location.origin);
      const params = new URLSearchParams(window.location.search);
      const hasShowDrafts = params.get('show_drafts') === 'true'
        || sessionStorage.getItem('bb_show_drafts') === 'true';
      if (hasShowDrafts) {
        url.searchParams.set('show_drafts', 'true');
      }
      window.location.href = url.toString();
    });
  } else {
    projectItem.classList.remove('active');

    const video = projectItem.querySelector<HTMLVideoElement>('video.lazy-video');
    if (video) {
      video.pause();
      destroyHLSPlayer(video);
    }

    const thumbnail = projectItem.querySelector<HTMLElement>('.thumbnail');
    if (thumbnail) {
      resetThumbnailPosition(thumbnail);
    }

    const projectDetails = projectItem.querySelector<HTMLElement>('.project-details');
    if (projectDetails) {
      projectDetails.innerHTML = '';
    }
  }
}

// ========== EVENT LISTENERS ==========

function initializeEventListeners(): void {
  document.body.addEventListener('project:afterSwap', handleProjectAfterSwap as EventListener);
  document.body.addEventListener('project:beforeSwap', handleProjectBeforeSwap);
  document.body.addEventListener('project:loaded', handleProjectLoaded as EventListener);
  document.body.addEventListener('projects:loaded', handleProjectsLoaded);
  document.body.addEventListener('project:error', () => {
    showNotification('Failed to load content. Please try again.', true);
  });

  // Event delegation for copy-text-link
  document.body.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLElement>('.copy-text-link');
    if (button) {
      event.preventDefault();
      const textToCopy = button.getAttribute('data-copy-text');
      const notificationMessage = button.getAttribute('data-notification-message') || 'URL copied to clipboard!';

      if (textToCopy) {
        copyToClipboard(textToCopy, notificationMessage);
      } else {
        console.warn('No copy text provided for copying.');
        showNotification('No content available to copy.', true);
      }
    }
  });

  // Close project buttons (isolation mode only)
  document.body.addEventListener('click', function(event) {
    const target = (event.target as HTMLElement).closest<HTMLElement>('.close-project');
    if (target) {
      const isIsolationMode = document.body.dataset.isolationMode === 'true';
      if (isIsolationMode) {
        event.preventDefault();
        closeProject(target);
      }
    }
  });

  // Media lightbox (images and eligible content videos)
  document.body.addEventListener('click', function(event) {
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
  });

  // Escape key handler
  document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
      if (document.body.classList.contains('editing')) {
        return;
      }

      if (closeActiveLightbox()) {
        return;
      }

      const activeProject = document.querySelector<HTMLElement>('.project-item.active');
      if (activeProject) {
        const closeBtn = activeProject.querySelector<HTMLElement>('.close-project');
        if (closeBtn) {
          const isIsolationMode = document.body.dataset.isolationMode === 'true';
          if (isIsolationMode) {
            closeProject(closeBtn);
          } else {
            const slug = activeProject.dataset.slug;
            if (slug) {
              closeProjectBySlug(slug);
            }
          }
        }
      }
    }
  });

  // Visibility change
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopAnimationLoop();
    } else if (Math.abs(animationSpeed) > 0.01) {
      startAnimationLoop();
    }
  });
}

// ========== HASH SCROLLING ==========

function scrollToHashTarget(): void {
  if (window.location.hash) {
    const target = document.getElementById(window.location.hash.slice(1));
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  }
}

// ========== MAIN INITIALIZATION ==========

function initializeAll(): void {
  initializeThumbnails();
  initializeProjects();
  initializeProjectObserver();
  openExternalLinksInNewTab();
  window.addEventListener('beforeunload', cleanupActiveHLSPlayers);
}

export function init(): void {
  initializeAll();
  initializeEventListeners();

  window.addEventListener('load', scrollToHashTarget);
  window.addEventListener('hashchange', scrollToHashTarget);
}

// Export for module usage
export {
  handleProjectContent,
  closeAllOpenProjects,
  cleanupActiveHLSPlayers,
  copyToClipboard,
  updateThumbnails,
  setupHLSPlayer,
  destroyHLSPlayer,
};

const ProjectInteractions = {
  init,
  handleProjectContent,
  closeAllOpenProjects,
  cleanupActiveHLSPlayers,
  copyToClipboard,
  updateThumbnails,
  setupHLSPlayer,
  destroyHLSPlayer,
};

export default ProjectInteractions;

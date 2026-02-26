/**
 * Project Interactions Module
 * Handles project item interactions, HLS video, thumbnails, and animations
 */

import type { ProjectEventDetail } from '../types/events';
import {
  DEFAULT_HLS_CONFIG,
  canPlayNativeHls,
  destroyHlsInstance,
  loadHlsScript,
} from '../core/hls';
import { copyToClipboard, showNotification } from './clipboard';
import { resolveHashTarget, scrollToHashTarget } from './hash-scroll';
import {
  closeActiveLightbox,
  initializeLightboxMedia,
  isEligibleLightboxVideo,
  openImageLightbox,
  openVideoLightbox,
} from './lightbox';
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

const MOBILE_BREAKPOINT = 768;
const VIDEO_VIEWPORT_PADDING_MOBILE = 12;
const VIDEO_VIEWPORT_PADDING_DESKTOP = 24;
const VIDEO_MIN_RENDER_HEIGHT = 180;
const DEBUG_HLS = document.body.dataset.debugHls === 'true';

function hlsDebug(...args: unknown[]): void {
  if (DEBUG_HLS) {
    console.log(...args);
  }
}

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
 * Preload HLS.js script. Safe to call multiple times.
 * Called early (on mousedown/touchstart) to have HLS.js ready by click time.
 */
export function preloadHlsScript(): Promise<void> {
  return loadHlsScript();
}

/**
 * Sets up HLS video player for a given video element.
 */
function setupHLSPlayer(videoElement: HTMLVideoElement, autoplay: boolean = false): Promise<void> {
  hlsDebug('[HLS] setupHLSPlayer called', { autoplay });
  videoElement.dataset.loaded = 'true';
  return new Promise((resolve, reject) => {
    const streamUrl = videoElement.dataset.hlsUrl;
    hlsDebug('[HLS] Stream URL:', streamUrl);
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

      // If early play didn't work (no src yet), try again now that media is loaded
      if (autoplay && videoElement.paused) {
        videoElement.play().catch(e => {
          if (e.name !== 'AbortError') {
            console.error("Autoplay failed:", e);
          }
        });
      }
      resolve();
    };

    const canPlayNative = canPlayNativeHls(videoElement);
    hlsDebug('[HLS] Native HLS support:', canPlayNative ? 'yes' : 'no');
    hlsDebug('[HLS] HLS.js loaded:', !!window.Hls);
    hlsDebug('[HLS] HLS.js supported:', window.Hls ? Hls.isSupported() : 'n/a');

    const initializeHls = () => {
      if (!window.Hls || !Hls.isSupported()) {
        if (canPlayNative) {
          videoElement.src = streamUrl;
          // Try to play immediately to preserve user gesture context
          if (autoplay && !document.body.classList.contains('editing')) {
            videoElement.play().catch(() => {
              // Will retry after loadedmetadata
            });
          }
          videoElement.addEventListener('loadedmetadata', initializeVideo, { once: true });
          return;
        }
        console.error('HLS is not supported in this browser');
        reject('HLS is not supported');
        return;
      }

      if (videoElement.hlsInstance) {
        console.warn('HLS instance already exists for this video element. Destroying existing instance.');
        destroyHlsInstance(videoElement);
      }

      const hls = new Hls(DEFAULT_HLS_CONFIG);
      videoElement.hlsInstance = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(videoElement);

      // Try to play immediately after attaching media to preserve user gesture context
      if (autoplay && !document.body.classList.contains('editing')) {
        videoElement.play().catch(() => {
          // Expected to fail here, will retry after manifest is parsed
        });
      }

      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          hlsDebug('[HLS] Available quality levels:');
          hls.levels.forEach((level, i) => {
            hlsDebug(`  [${i}] ${level.height}p @ ${(level.bitrate / 1000000).toFixed(1)} Mbps`);
          });
          hlsDebug(`[HLS] Starting level: ${hls.startLevel} (auto: ${hls.autoLevelEnabled})`);
          hlsDebug(`[HLS] Current level: ${hls.currentLevel}, Next level: ${hls.nextLevel}`);
          initializeVideo();
        });
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        const levelData = data as { level: number };
        const level = hls.levels[levelData.level];
        if (level) {
          hlsDebug(`[HLS] Switched to level ${levelData.level}: ${level.height}p @ ${(level.bitrate / 1000000).toFixed(1)} Mbps`);
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
      hlsDebug('[HLS] Using HLS.js (already loaded)');
      initializeHls();
      return;
    }

    hlsDebug('[HLS] Loading HLS.js script...');
    loadHlsScript()
      .then(() => {
        if (Hls.isSupported()) {
          hlsDebug('[HLS] HLS.js loaded and supported, using HLS.js');
          initializeHls();
        } else if (canPlayNative) {
          hlsDebug('[HLS] HLS.js not supported, falling back to native');
          videoElement.src = streamUrl;
          if (autoplay && !document.body.classList.contains('editing')) {
            videoElement.play().catch(() => {});
          }
          videoElement.addEventListener('loadedmetadata', initializeVideo, { once: true });
        } else {
          console.error('HLS is not supported in this browser');
          reject('HLS is not supported');
        }
      })
      .catch(err => {
        if (canPlayNative) {
          hlsDebug('[HLS] HLS.js failed to load, falling back to native');
          videoElement.src = streamUrl;
          if (autoplay && !document.body.classList.contains('editing')) {
            videoElement.play().catch(() => {});
          }
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

  destroyHlsInstance(videoElement);
  delete videoElement.dataset.loaded;
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
          if (video.dataset.loaded === 'true') {
            observer.unobserve(video);
            return;
          }
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

function buildIsolationHomeUrl(): URL {
  const url = new URL('/', window.location.origin);
  const params = new URLSearchParams(window.location.search);
  const hasShowDrafts = params.get('show_drafts') === 'true'
    || sessionStorage.getItem('bb_show_drafts') === 'true';
  if (hasShowDrafts) {
    url.searchParams.set('show_drafts', 'true');
  }
  return url;
}

function navigateHomeFromIsolation(): void {
  window.location.href = buildIsolationHomeUrl().toString();
}

/**
 * Closes a specific project item smoothly.
 */
function closeProject(button: HTMLElement): void {
  const projectItem = button.closest<HTMLElement>('.project-item');
  if (!projectItem) return;

  const isIsolationMode = document.body.dataset.isolationMode === 'true';

  if (isIsolationMode) {
    if (projectItem.dataset.closing === 'true') {
      return;
    }
    projectItem.dataset.closing = 'true';
    projectItem.classList.add('fade-out');

    projectItem.addEventListener('animationend', function handler(event: AnimationEvent) {
      if (event.target !== projectItem || event.animationName !== 'fadeOut') {
        return;
      }
      navigateHomeFromIsolation();
    }, { once: true });
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

  // Site title click should use smooth isolation close behavior instead of hard navigation.
  document.body.addEventListener('click', function(event) {
    const siteTitle = (event.target as HTMLElement).closest<HTMLAnchorElement>('a.site-title');
    if (!siteTitle) return;

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

    const isIsolationMode = document.body.dataset.isolationMode === 'true';
    if (!isIsolationMode) {
      if (window.location.pathname === '/me') {
        try {
          const referrer = document.referrer ? new URL(document.referrer) : null;
          const cameFromHome = !!referrer
            && referrer.origin === window.location.origin
            && referrer.pathname === '/';
          if (cameFromHome) {
            event.preventDefault();
            window.history.back();
            return;
          }
        } catch {
          // Fall through to default navigation.
        }
      }
      return;
    }

    event.preventDefault();
    const activeProject = document.querySelector<HTMLElement>('.project-item.active');
    const closeBtn = activeProject?.querySelector<HTMLElement>('.close-project');
    if (closeBtn) {
      closeProject(closeBtn);
      return;
    }

    navigateHomeFromIsolation();
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

  // Deterministic in-page anchor navigation for project content.
  document.body.addEventListener('click', function(event) {
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
    // A follow-up instant pass helps when late media/layout changes nudge the page.
    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: 'auto', block: 'start' });
    });
    setTimeout(() => {
      target.scrollIntoView({ behavior: 'auto', block: 'start' });
    }, 180);
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

  window.addEventListener('load', () => scrollToHashTarget('auto'));
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

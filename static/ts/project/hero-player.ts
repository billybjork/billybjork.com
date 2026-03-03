import {
  DEFAULT_HLS_CONFIG,
  canPlayNativeHls,
  destroyHlsInstance,
  loadHlsScript,
} from '../core/hls';

const MOBILE_BREAKPOINT = 768;
const HLS_LEVEL_ASPECT_DRIFT_TOLERANCE = 0.0015;
const DEFAULT_DEBUG_MP4_URL = 'https://d17y8p6t5eu2ht.cloudfront.net/videos_mp4/it_feels_like_it\'s_working.mp4';

const hlsSetupInFlight = new WeakMap<HTMLVideoElement, Promise<void>>();
const hlsSetupCompleted = new WeakSet<HTMLVideoElement>();
const hlsSetupCancel = new WeakMap<HTMLVideoElement, () => void>();

let heroVideoObserver: IntersectionObserver | null = null;
let debugBodyClassApplied = false;

interface VideoDebugConfig {
  enabled: boolean;
  logState: boolean;
  noContain: boolean;
  mp4Url: string | null;
}

const videoDebugConfig: VideoDebugConfig = (() => {
  if (typeof window === 'undefined') {
    return {
      enabled: false,
      logState: false,
      noContain: false,
      mp4Url: null,
    };
  }

  const params = new URLSearchParams(window.location.search);
  const logState = params.get('video_debug') === '1';
  const noContain = params.get('video_debug_no_contain') === '1';
  const mp4Param = params.get('video_debug_mp4');
  const mp4Url = mp4Param
    ? (mp4Param === '1' ? DEFAULT_DEBUG_MP4_URL : mp4Param)
    : null;
  const enabled = logState || noContain || !!mp4Url;

  return {
    enabled,
    logState,
    noContain,
    mp4Url,
  };
})();

function applyVideoDebugBodyClasses(): void {
  if (!videoDebugConfig.enabled || debugBodyClassApplied) {
    return;
  }

  const apply = () => {
    if (!document.body) return;
    document.body.classList.add('video-debug');
    if (videoDebugConfig.noContain) {
      document.body.classList.add('video-debug-no-contain');
    }
    debugBodyClassApplied = true;
  };

  if (document.body) {
    apply();
  } else {
    window.addEventListener('DOMContentLoaded', apply, { once: true });
  }
}

function formatTimeRanges(ranges: TimeRanges): Array<{ start: number; end: number }> {
  const formatted: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < ranges.length; index += 1) {
    formatted.push({
      start: ranges.start(index),
      end: ranges.end(index),
    });
  }
  return formatted;
}

function logVideoState(videoElement: HTMLVideoElement, label: string): void {
  if (!videoDebugConfig.logState) {
    return;
  }

  const state = {
    label,
    currentSrc: videoElement.currentSrc,
    src: videoElement.src,
    readyState: videoElement.readyState,
    networkState: videoElement.networkState,
    paused: videoElement.paused,
    controls: videoElement.controls,
    playsInline: videoElement.playsInline,
    muted: videoElement.muted,
    autoplay: videoElement.autoplay,
    preload: videoElement.preload,
    duration: videoElement.duration,
    currentTime: videoElement.currentTime,
    seekable: formatTimeRanges(videoElement.seekable),
    buffered: formatTimeRanges(videoElement.buffered),
    videoWidth: videoElement.videoWidth,
    videoHeight: videoElement.videoHeight,
  };

  // eslint-disable-next-line no-console
  console.info('[video-debug]', state);
}

function bindVideoDebugListeners(videoElement: HTMLVideoElement): void {
  if (!videoDebugConfig.logState) {
    return;
  }

  if (videoElement.dataset.videoDebugBound === 'true') {
    return;
  }
  videoElement.dataset.videoDebugBound = 'true';

  const log = (label: string) => logVideoState(videoElement, label);
  const events = [
    'loadedmetadata',
    'durationchange',
    'canplay',
    'canplaythrough',
    'timeupdate',
    'seeking',
    'seeked',
    'pause',
    'play',
    'error',
    'emptied',
  ];

  events.forEach(eventName => {
    videoElement.addEventListener(eventName, () => log(eventName));
  });

  log('init');
}

function parsePositiveNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number'
    ? value
    : Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getVideoContainer(videoElement: HTMLVideoElement): HTMLElement | null {
  return videoElement.closest<HTMLElement>('.video-container');
}

function resolveVideoAspectRatio(videoElement: HTMLVideoElement): number | null {
  const metadataWidth = parsePositiveNumber(videoElement.dataset.videoWidth);
  const metadataHeight = parsePositiveNumber(videoElement.dataset.videoHeight);
  if (metadataWidth && metadataHeight) {
    return metadataWidth / metadataHeight;
  }

  const nativeWidth = videoElement.videoWidth;
  const nativeHeight = videoElement.videoHeight;
  if (nativeWidth > 0 && nativeHeight > 0) {
    return nativeWidth / nativeHeight;
  }

  return null;
}

function updateVideoContainerAspectRatio(videoElement: HTMLVideoElement): void {
  const container = getVideoContainer(videoElement);
  if (!container) return;

  const aspectRatio = resolveVideoAspectRatio(videoElement);
  if (aspectRatio) {
    container.style.setProperty('--video-aspect-ratio', aspectRatio.toString());
  }
}

function bindVideoLayout(videoElement: HTMLVideoElement): void {
  if (videoElement.videoLayoutCleanup) {
    videoElement.videoLayoutCleanup();
  }

  const refreshLayout = () => updateVideoContainerAspectRatio(videoElement);

  videoElement.addEventListener('loadedmetadata', refreshLayout);
  videoElement.addEventListener('resize', refreshLayout);
  refreshLayout();

  videoElement.videoLayoutCleanup = () => {
    videoElement.removeEventListener('loadedmetadata', refreshLayout);
    videoElement.removeEventListener('resize', refreshLayout);
  };
}

function tryAutoplay(videoElement: HTMLVideoElement): void {
  if (document.body.classList.contains('editing') || !videoElement.paused) {
    return;
  }
  videoElement.play().catch(e => {
    if (e.name !== 'AbortError') {
      console.error('Autoplay failed:', e);
    }
  });
}

function ensureNativeVideoControls(videoElement: HTMLVideoElement): void {
  videoElement.controls = true;
  videoElement.setAttribute('controls', '');
}

function initializeOnMetadata(
  videoElement: HTMLVideoElement,
  onReady: () => void,
  assignSource: () => void
): void {
  let handled = false;
  const handleReady = () => {
    if (handled) return;
    handled = true;
    videoElement.removeEventListener('loadedmetadata', handleReady);
    onReady();
  };

  videoElement.addEventListener('loadedmetadata', handleReady, { once: true });
  assignSource();

  if (videoElement.readyState >= HTMLMediaElement.HAVE_METADATA) {
    handleReady();
  }
}

interface HlsLevelSelection {
  index: number;
  width: number | null;
  height: number;
  bitrate: number;
  aspectDrift: number;
}

function selectStableHlsLevel(hls: Hls, videoElement: HTMLVideoElement): number | null {
  const targetAspectRatio = resolveVideoAspectRatio(videoElement);
  const containerRect = getVideoContainer(videoElement)?.getBoundingClientRect();
  const targetRenderHeight = containerRect?.height ?? videoElement.clientHeight ?? 0;
  if (targetRenderHeight <= 0) {
    return null;
  }

  const levelSelections: HlsLevelSelection[] = hls.levels
    .map((level, index) => {
      const height = parsePositiveNumber(level.height);
      if (!height) {
        return null;
      }

      const width = parsePositiveNumber(level.width);
      const aspectDrift = (targetAspectRatio && width)
        ? Math.abs((width / height) - targetAspectRatio)
        : 0;

      return {
        index,
        width,
        height,
        bitrate: parsePositiveNumber(level.bitrate) ?? 0,
        aspectDrift,
      };
    })
    .filter((selection): selection is HlsLevelSelection => selection !== null);

  if (!levelSelections.length) {
    return null;
  }

  let candidates = levelSelections;
  if (targetAspectRatio) {
    const aspectMatched = levelSelections.filter(selection =>
      selection.width !== null && selection.aspectDrift <= HLS_LEVEL_ASPECT_DRIFT_TOLERANCE
    );
    if (aspectMatched.length) {
      candidates = aspectMatched;
    }
  }

  const sorted = [...candidates].sort((a, b) => {
    if (a.height !== b.height) return a.height - b.height;
    return b.bitrate - a.bitrate;
  });

  const firstCoveringLevel = sorted.find(selection => selection.height >= (targetRenderHeight * 0.95));
  if (firstCoveringLevel) {
    return firstCoveringLevel.index;
  }

  return sorted[sorted.length - 1]?.index ?? null;
}

function applyStableHlsLevel(hls: Hls, videoElement: HTMLVideoElement): void {
  const stableLevel = selectStableHlsLevel(hls, videoElement);
  if (stableLevel === null) {
    return;
  }

  hls.startLevel = stableLevel;

  if (window.innerWidth <= MOBILE_BREAKPOINT) {
    hls.loadLevel = stableLevel;
    hls.nextLevel = stableLevel;
    hls.currentLevel = stableLevel;
  }
}

export function preloadHlsScript(): Promise<void> {
  return loadHlsScript();
}

export function setupHeroVideoPlayer(videoElement: HTMLVideoElement, autoplay: boolean = false): Promise<void> {
  if (hlsSetupCompleted.has(videoElement)) {
    videoElement.dataset.loaded = 'true';
    if (autoplay) {
      tryAutoplay(videoElement);
    }
    return Promise.resolve();
  }

  applyVideoDebugBodyClasses();
  bindVideoDebugListeners(videoElement);

  const pendingSetup = hlsSetupInFlight.get(videoElement);
  if (pendingSetup) {
    if (autoplay) {
      pendingSetup.then(() => tryAutoplay(videoElement)).catch(() => {});
    }
    return pendingSetup;
  }

  const setupPromise = new Promise<void>((resolve, reject) => {
    let settled = false;
    let cancelled = false;
    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const rejectOnce = (reason: unknown) => {
      if (settled) return;
      settled = true;
      reject(reason);
    };

    const cancelSetup = () => {
      cancelled = true;
      resolveOnce();
    };
    hlsSetupCancel.set(videoElement, cancelSetup);

    const streamUrl = videoDebugConfig.mp4Url ?? videoElement.dataset.hlsUrl;
    if (!streamUrl) {
      console.error('No HLS URL provided for video element');
      rejectOnce('No HLS URL provided');
      return;
    }

    videoElement.classList.add('hls-video');
    bindVideoLayout(videoElement);

    let initialized = false;
    const initializeVideo = () => {
      if (cancelled) return;
      if (initialized) return;
      initialized = true;

      updateVideoContainerAspectRatio(videoElement);
      ensureNativeVideoControls(videoElement);

      hlsSetupCompleted.add(videoElement);
      videoElement.dataset.loaded = 'true';

      if (document.body.classList.contains('editing')) {
        videoElement.pause();
        resolveOnce();
        return;
      }

      if (autoplay) {
        tryAutoplay(videoElement);
      }
      resolveOnce();
    };

    const canPlayNative = canPlayNativeHls(videoElement);
    if (videoDebugConfig.mp4Url) {
      initializeOnMetadata(videoElement, initializeVideo, () => {
        videoElement.src = streamUrl;
      });
      if (autoplay) {
        tryAutoplay(videoElement);
      }
      logVideoState(videoElement, 'mp4-override');
      return;
    }

    if (canPlayNative) {
      initializeOnMetadata(videoElement, initializeVideo, () => {
        videoElement.src = streamUrl;
      });
      if (autoplay) {
        tryAutoplay(videoElement);
      }
      return;
    }

    const initializeHls = () => {
      if (!window.Hls || !Hls.isSupported()) {
        console.error('HLS is not supported in this browser');
        rejectOnce('HLS is not supported');
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

      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          applyStableHlsLevel(hls, videoElement);
          initializeVideo();
        });
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
              rejectOnce(data);
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
      initializeHls();
      return;
    }

    loadHlsScript()
      .then(() => {
        if (Hls.isSupported()) {
          initializeHls();
        } else {
          console.error('HLS is not supported in this browser');
          rejectOnce('HLS is not supported');
        }
      })
      .catch(err => {
        console.error('Failed to load HLS.js:', err);
        rejectOnce(err);
      });
  });

  hlsSetupInFlight.set(videoElement, setupPromise);
  return setupPromise.finally(() => {
    if (hlsSetupCancel.has(videoElement)) {
      hlsSetupCancel.delete(videoElement);
    }
    hlsSetupInFlight.delete(videoElement);
  });
}

export function destroyHeroVideoPlayer(videoElement: HTMLVideoElement): void {
  const cancelSetup = hlsSetupCancel.get(videoElement);
  if (cancelSetup) {
    cancelSetup();
    hlsSetupCancel.delete(videoElement);
  }
  hlsSetupInFlight.delete(videoElement);
  hlsSetupCompleted.delete(videoElement);

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

function getHeroVideoObserver(): IntersectionObserver | null {
  if (!('IntersectionObserver' in window)) {
    return null;
  }
  if (heroVideoObserver) {
    return heroVideoObserver;
  }

  heroVideoObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const video = entry.target as HTMLVideoElement;
      if (video.dataset.loaded === 'true') {
        observer.unobserve(video);
        return;
      }

      setupHeroVideoPlayer(video, false).catch(err => {
        console.error('Failed to initialize HLS player for video:', err);
      });
      observer.unobserve(video);
    });
  }, {
    rootMargin: '0px 0px 200px 0px',
    threshold: 0.25
  });

  return heroVideoObserver;
}

export function initializeLazyHeroVideos(root: ParentNode = document): void {
  const lazyVideos = root.querySelectorAll<HTMLVideoElement>('video.lazy-video');
  const observer = getHeroVideoObserver();

  lazyVideos.forEach(video => {
    if (video.dataset.loaded === 'true') return;

    if (observer) {
      observer.observe(video);
      return;
    }

    setupHeroVideoPlayer(video, false).catch(err => {
      console.error('Failed to initialize HLS player for video:', err);
    });
  });
}

export function initializeOpenHeroVideo(): void {
  const openVideo = document.querySelector<HTMLVideoElement>('.project-item.active video.lazy-video');
  if (!openVideo) return;

  setupHeroVideoPlayer(openVideo, true).catch(err => {
    console.error('Failed to initialize HLS player for initial open project:', err);
  });
}

export function cleanupActiveHeroPlayers(): void {
  const cleanedVideos = new Set<HTMLVideoElement>();

  const activeVideos = document.querySelectorAll<HTMLVideoElement>('video.hls-video');
  activeVideos.forEach(video => {
    destroyHeroVideoPlayer(video);
    cleanedVideos.add(video);
  });

  const videosWithHlsInstance = document.querySelectorAll<HTMLVideoElement>('video');
  videosWithHlsInstance.forEach(video => {
    if (!video.hlsInstance || cleanedVideos.has(video)) {
      return;
    }
    destroyHeroVideoPlayer(video);
  });
}

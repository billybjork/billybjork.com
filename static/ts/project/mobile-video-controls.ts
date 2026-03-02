/**
 * Mobile Video Controls Module
 * Custom video controls for mobile devices where native iOS controls have issues.
 * Desktop retains native controls.
 */

// Mobile detection using touch capability + viewport width
const MOBILE_MAX_WIDTH = 768;

function isMobileDevice(): boolean {
  const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const isNarrowViewport = window.innerWidth <= MOBILE_MAX_WIDTH;
  return hasTouch && isNarrowViewport;
}

// Format time as MM:SS or HH:MM:SS
function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

interface MobileControlsState {
  isDragging: boolean;
  hideTimeout: number | null;
  controlsVisible: boolean;
}

const videoStates = new WeakMap<HTMLVideoElement, MobileControlsState>();

function getVideoState(video: HTMLVideoElement): MobileControlsState {
  let state = videoStates.get(video);
  if (!state) {
    state = { isDragging: false, hideTimeout: null, controlsVisible: true };
    videoStates.set(video, state);
  }
  return state;
}

function createControlsHTML(videoId: string): string {
  return `
    <div class="mobile-video-controls" data-for="${videoId}">
      <button class="mvc-play-overlay" aria-label="Play" type="button">
        <svg class="mvc-play-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M8 5v14l11-7z"/>
        </svg>
        <svg class="mvc-pause-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
        </svg>
      </button>
      <div class="mvc-bottom-bar">
        <button class="mvc-play-btn" aria-label="Play" type="button">
          <svg class="mvc-play-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8 5v14l11-7z"/>
          </svg>
          <svg class="mvc-pause-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
          </svg>
        </button>
        <span class="mvc-time mvc-current-time" aria-live="off">0:00</span>
        <div class="mvc-progress-container" role="slider" aria-label="Video progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="0">
          <div class="mvc-progress-track">
            <div class="mvc-progress-buffered"></div>
            <div class="mvc-progress-played"></div>
            <div class="mvc-progress-thumb" aria-hidden="true"></div>
          </div>
        </div>
        <span class="mvc-time mvc-duration" aria-live="off">0:00</span>
        <button class="mvc-fullscreen-btn" aria-label="Toggle fullscreen" type="button">
          <svg class="mvc-fullscreen-enter" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
          </svg>
          <svg class="mvc-fullscreen-exit" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>
          </svg>
        </button>
      </div>
    </div>
  `;
}

function updateProgressBar(video: HTMLVideoElement, controls: HTMLElement): void {
  const duration = video.duration || 0;
  const currentTime = video.currentTime || 0;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  const playedBar = controls.querySelector<HTMLElement>('.mvc-progress-played');
  const thumb = controls.querySelector<HTMLElement>('.mvc-progress-thumb');
  const progressContainer = controls.querySelector<HTMLElement>('.mvc-progress-container');

  if (playedBar) playedBar.style.width = `${progress}%`;
  if (thumb) thumb.style.left = `${progress}%`;
  if (progressContainer) {
    progressContainer.setAttribute('aria-valuenow', Math.round(progress).toString());
  }
}

function updateBufferedBar(video: HTMLVideoElement, controls: HTMLElement): void {
  const duration = video.duration || 0;
  if (duration <= 0) return;

  const buffered = video.buffered;
  let bufferedEnd = 0;
  for (let i = 0; i < buffered.length; i++) {
    if (buffered.start(i) <= video.currentTime) {
      bufferedEnd = Math.max(bufferedEnd, buffered.end(i));
    }
  }

  const bufferedPercent = (bufferedEnd / duration) * 100;
  const bufferedBar = controls.querySelector<HTMLElement>('.mvc-progress-buffered');
  if (bufferedBar) bufferedBar.style.width = `${bufferedPercent}%`;
}

function updateTimeDisplay(video: HTMLVideoElement, controls: HTMLElement): void {
  const currentTimeEl = controls.querySelector<HTMLElement>('.mvc-current-time');
  const durationEl = controls.querySelector<HTMLElement>('.mvc-duration');

  if (currentTimeEl) currentTimeEl.textContent = formatTime(video.currentTime);
  if (durationEl) durationEl.textContent = formatTime(video.duration);
}

function updatePlayState(video: HTMLVideoElement, controls: HTMLElement): void {
  const isPaused = video.paused;
  controls.classList.toggle('is-playing', !isPaused);
  controls.classList.toggle('is-paused', isPaused);

  const playOverlay = controls.querySelector<HTMLButtonElement>('.mvc-play-overlay');
  const playBtn = controls.querySelector<HTMLButtonElement>('.mvc-play-btn');
  const label = isPaused ? 'Play' : 'Pause';
  if (playOverlay) playOverlay.setAttribute('aria-label', label);
  if (playBtn) playBtn.setAttribute('aria-label', label);
}

function updateFullscreenState(video: HTMLVideoElement, controls: HTMLElement): void {
  const videoWithWebkit = video as HTMLVideoElement & { webkitDisplayingFullscreen?: boolean };
  const isFullscreen = !!document.fullscreenElement || !!videoWithWebkit.webkitDisplayingFullscreen;
  controls.classList.toggle('is-fullscreen', isFullscreen);

  const fsBtn = controls.querySelector<HTMLButtonElement>('.mvc-fullscreen-btn');
  if (fsBtn) {
    fsBtn.setAttribute('aria-label', isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen');
  }
}

function showControls(video: HTMLVideoElement, controls: HTMLElement): void {
  const state = getVideoState(video);
  state.controlsVisible = true;
  controls.classList.add('mvc-visible');

  if (state.hideTimeout) {
    clearTimeout(state.hideTimeout);
    state.hideTimeout = null;
  }
}

function hideControlsDelayed(video: HTMLVideoElement, controls: HTMLElement, delay = 2500): void {
  const state = getVideoState(video);

  if (state.hideTimeout) {
    clearTimeout(state.hideTimeout);
  }

  if (video.paused || state.isDragging) {
    return;
  }

  state.hideTimeout = window.setTimeout(() => {
    if (!video.paused && !state.isDragging) {
      state.controlsVisible = false;
      controls.classList.remove('mvc-visible');
    }
    state.hideTimeout = null;
  }, delay);
}

function toggleControlsVisibility(video: HTMLVideoElement, controls: HTMLElement): void {
  const state = getVideoState(video);
  if (state.controlsVisible) {
    if (!video.paused) {
      state.controlsVisible = false;
      controls.classList.remove('mvc-visible');
    }
  } else {
    showControls(video, controls);
    hideControlsDelayed(video, controls);
  }
}

function seekToPosition(video: HTMLVideoElement, controls: HTMLElement, clientX: number): void {
  const progressContainer = controls.querySelector<HTMLElement>('.mvc-progress-container');
  if (!progressContainer || !video.duration) return;

  const rect = progressContainer.getBoundingClientRect();
  const relativeX = Math.max(0, Math.min(clientX - rect.left, rect.width));
  const percent = relativeX / rect.width;
  video.currentTime = percent * video.duration;
}

function handleProgressInteraction(
  video: HTMLVideoElement,
  controls: HTMLElement,
  event: MouseEvent | TouchEvent
): void {
  event.preventDefault();
  event.stopPropagation();

  const state = getVideoState(video);
  state.isDragging = true;
  controls.classList.add('mvc-dragging');

  const clientX = 'touches' in event && event.touches[0] ? event.touches[0].clientX : (event as MouseEvent).clientX;
  seekToPosition(video, controls, clientX);

  const handleMove = (e: MouseEvent | TouchEvent) => {
    const moveX = 'touches' in e && e.touches[0] ? e.touches[0].clientX : (e as MouseEvent).clientX;
    seekToPosition(video, controls, moveX);
  };

  const handleEnd = () => {
    state.isDragging = false;
    controls.classList.remove('mvc-dragging');
    document.removeEventListener('mousemove', handleMove);
    document.removeEventListener('mouseup', handleEnd);
    document.removeEventListener('touchmove', handleMove);
    document.removeEventListener('touchend', handleEnd);
    hideControlsDelayed(video, controls);
  };

  document.addEventListener('mousemove', handleMove);
  document.addEventListener('mouseup', handleEnd);
  document.addEventListener('touchmove', handleMove, { passive: false });
  document.addEventListener('touchend', handleEnd);
}

function handleProgressKeydown(video: HTMLVideoElement, event: KeyboardEvent): void {
  const step = video.duration * 0.05 || 5;
  switch (event.key) {
    case 'ArrowLeft':
      event.preventDefault();
      video.currentTime = Math.max(0, video.currentTime - step);
      break;
    case 'ArrowRight':
      event.preventDefault();
      video.currentTime = Math.min(video.duration || 0, video.currentTime + step);
      break;
    case 'Home':
      event.preventDefault();
      video.currentTime = 0;
      break;
    case 'End':
      event.preventDefault();
      video.currentTime = video.duration || 0;
      break;
  }
}

function toggleFullscreen(video: HTMLVideoElement, container: HTMLElement): void {
  // iOS Safari doesn't support Fullscreen API on containers, only webkitEnterFullscreen on video
  const videoWithWebkit = video as HTMLVideoElement & {
    webkitEnterFullscreen?: () => void;
    webkitExitFullscreen?: () => void;
    webkitDisplayingFullscreen?: boolean;
  };

  if (videoWithWebkit.webkitEnterFullscreen) {
    // iOS path
    if (videoWithWebkit.webkitDisplayingFullscreen) {
      videoWithWebkit.webkitExitFullscreen?.();
    } else {
      videoWithWebkit.webkitEnterFullscreen();
    }
  } else if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    container.requestFullscreen().catch(() => {});
  }
}

function bindVideoEvents(video: HTMLVideoElement, controls: HTMLElement): () => void {
  const container = video.closest<HTMLElement>('.video-container');

  const onTimeUpdate = () => {
    const state = getVideoState(video);
    if (!state.isDragging) {
      updateProgressBar(video, controls);
      updateTimeDisplay(video, controls);
    }
  };

  const onProgress = () => updateBufferedBar(video, controls);
  const onDurationChange = () => updateTimeDisplay(video, controls);
  const onLoadedMetadata = () => {
    updateTimeDisplay(video, controls);
    updateProgressBar(video, controls);
  };

  const onPlay = () => {
    updatePlayState(video, controls);
    hideControlsDelayed(video, controls, 1500);
  };

  const onPause = () => {
    updatePlayState(video, controls);
    showControls(video, controls);
  };

  const onEnded = () => {
    updatePlayState(video, controls);
    showControls(video, controls);
  };

  const onFullscreenChange = () => updateFullscreenState(video, controls);

  video.addEventListener('timeupdate', onTimeUpdate);
  video.addEventListener('progress', onProgress);
  video.addEventListener('durationchange', onDurationChange);
  video.addEventListener('loadedmetadata', onLoadedMetadata);
  video.addEventListener('play', onPlay);
  video.addEventListener('pause', onPause);
  video.addEventListener('ended', onEnded);
  document.addEventListener('fullscreenchange', onFullscreenChange);
  // iOS fullscreen events
  video.addEventListener('webkitbeginfullscreen', onFullscreenChange);
  video.addEventListener('webkitendfullscreen', onFullscreenChange);

  // UI event handlers
  const playOverlay = controls.querySelector<HTMLButtonElement>('.mvc-play-overlay');
  const playBtn = controls.querySelector<HTMLButtonElement>('.mvc-play-btn');
  const progressContainer = controls.querySelector<HTMLElement>('.mvc-progress-container');
  const fullscreenBtn = controls.querySelector<HTMLButtonElement>('.mvc-fullscreen-btn');

  const togglePlay = (e: Event) => {
    e.stopPropagation();
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  };

  const onControlsTouch = (e: Event) => {
    const target = e.target as HTMLElement;
    // If tapping an interactive element, let it handle it
    if (target.closest('button') || target.closest('.mvc-progress-container')) {
      return;
    }
    e.stopPropagation();
    toggleControlsVisibility(video, controls);
  };

  // Tap on video itself to show/hide controls (needed when controls are hidden with pointer-events: none)
  const onVideoTap = (e: Event) => {
    e.preventDefault();
    toggleControlsVisibility(video, controls);
  };

  const onProgressStart = (e: MouseEvent | TouchEvent) => {
    handleProgressInteraction(video, controls, e);
  };

  const onProgressKeydown = (e: KeyboardEvent) => {
    handleProgressKeydown(video, e);
  };

  const onFullscreenClick = (e: Event) => {
    e.stopPropagation();
    if (container) toggleFullscreen(video, container);
  };

  playOverlay?.addEventListener('click', togglePlay);
  playBtn?.addEventListener('click', togglePlay);
  progressContainer?.addEventListener('mousedown', onProgressStart);
  progressContainer?.addEventListener('touchstart', onProgressStart, { passive: false });
  progressContainer?.addEventListener('keydown', onProgressKeydown);
  fullscreenBtn?.addEventListener('click', onFullscreenClick);
  controls.addEventListener('click', onControlsTouch);
  controls.addEventListener('touchend', onControlsTouch);
  video.addEventListener('click', onVideoTap);
  video.addEventListener('touchend', onVideoTap);

  // Initial state
  updatePlayState(video, controls);
  updateFullscreenState(video, controls);
  showControls(video, controls);
  if (!video.paused) {
    hideControlsDelayed(video, controls);
  }

  // Return cleanup function
  return () => {
    const state = getVideoState(video);
    if (state.hideTimeout) {
      clearTimeout(state.hideTimeout);
    }

    video.removeEventListener('timeupdate', onTimeUpdate);
    video.removeEventListener('progress', onProgress);
    video.removeEventListener('durationchange', onDurationChange);
    video.removeEventListener('loadedmetadata', onLoadedMetadata);
    video.removeEventListener('play', onPlay);
    video.removeEventListener('pause', onPause);
    video.removeEventListener('ended', onEnded);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    video.removeEventListener('webkitbeginfullscreen', onFullscreenChange);
    video.removeEventListener('webkitendfullscreen', onFullscreenChange);

    playOverlay?.removeEventListener('click', togglePlay);
    playBtn?.removeEventListener('click', togglePlay);
    progressContainer?.removeEventListener('mousedown', onProgressStart);
    progressContainer?.removeEventListener('touchstart', onProgressStart);
    progressContainer?.removeEventListener('keydown', onProgressKeydown);
    fullscreenBtn?.removeEventListener('click', onFullscreenClick);
    controls.removeEventListener('click', onControlsTouch);
    controls.removeEventListener('touchend', onControlsTouch);
    video.removeEventListener('click', onVideoTap);
    video.removeEventListener('touchend', onVideoTap);

    videoStates.delete(video);
  };
}

/**
 * Initialize mobile controls for a video element.
 * Returns a cleanup function, or null if not applicable (desktop).
 */
export function initMobileControls(video: HTMLVideoElement): (() => void) | null {
  if (!isMobileDevice()) {
    return null;
  }

  const container = video.closest<HTMLElement>('.video-container');
  if (!container) {
    return null;
  }

  // Check if already initialized
  if (container.querySelector('.mobile-video-controls')) {
    return null;
  }

  // Remove native controls attribute
  video.removeAttribute('controls');

  // Add controls HTML
  const videoId = video.id || `video-${Date.now()}`;
  if (!video.id) video.id = videoId;

  container.insertAdjacentHTML('beforeend', createControlsHTML(videoId));
  container.classList.add('has-mobile-controls');

  const controls = container.querySelector<HTMLElement>('.mobile-video-controls');
  if (!controls) return null;

  const cleanup = bindVideoEvents(video, controls);

  return () => {
    cleanup();
    controls.remove();
    container.classList.remove('has-mobile-controls');
    video.setAttribute('controls', '');
  };
}

/**
 * Destroy mobile controls for a video element.
 */
export function destroyMobileControls(video: HTMLVideoElement): void {
  const container = video.closest<HTMLElement>('.video-container');
  if (!container) return;

  const controls = container.querySelector<HTMLElement>('.mobile-video-controls');
  if (!controls) return;

  const state = getVideoState(video);
  if (state.hideTimeout) {
    clearTimeout(state.hideTimeout);
  }
  videoStates.delete(video);

  controls.remove();
  container.classList.remove('has-mobile-controls');
}

/**
 * Check if mobile controls are needed for current device
 */
export function shouldUseMobileControls(): boolean {
  return isMobileDevice();
}

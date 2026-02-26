import { DEFAULT_HLS_CONFIG, canPlayNativeHls, destroyHlsInstance, loadHlsScript } from '../core/hls';
import { showNotification } from '../core/utils';

type ViewType = 'settings' | 'video';

export interface SwitchPreviewParams {
  hlsUrl: string;
  videoEl: HTMLVideoElement | null;
  currentView: ViewType;
  currentPreviewUrl: string | null;
  spriteLooping: boolean;
  blobPreviewFailed: boolean;
  hlsPreviewErrorShown: boolean;
  objectUrl: string | null;
  setStatus: (message?: string, tone?: string) => void;
}

export interface SwitchPreviewResult {
  hlsPreviewUrl: string | null;
  hlsPreviewErrorShown: boolean;
  objectUrl: string | null;
}

export function renderPreviewStatus(
  modal: HTMLElement | null,
  currentView: ViewType,
  message = '',
  tone = 'info'
): void {
  if (!modal || currentView !== 'video') return;
  const el = modal.querySelector('.edit-hero-preview-status') as HTMLElement | null;
  if (!el) return;
  if (!message) {
    el.hidden = true;
    el.textContent = '';
    el.classList.remove('is-info', 'is-warning', 'is-error', 'is-success');
    return;
  }
  el.hidden = false;
  el.textContent = message;
  el.classList.remove('is-info', 'is-warning', 'is-error', 'is-success');
  el.classList.add(`is-${tone}`);
}

export async function switchPreviewToHls(params: SwitchPreviewParams): Promise<SwitchPreviewResult> {
  const state: SwitchPreviewResult = {
    hlsPreviewUrl: params.currentPreviewUrl,
    hlsPreviewErrorShown: params.hlsPreviewErrorShown,
    objectUrl: params.objectUrl,
  };

  if (!params.hlsUrl || !params.videoEl || params.currentView !== 'video') return state;
  if (params.currentPreviewUrl === params.hlsUrl) return state;

  const video = params.videoEl;
  const resumeTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
  const shouldResumePlayback = !video.paused || params.spriteLooping;
  const canPlayNative = canPlayNativeHls(video);

  const restorePlaybackState = (): void => {
    if (resumeTime > 0) {
      try {
        video.currentTime = resumeTime;
      } catch {
        // Ignore
      }
    }
    if (shouldResumePlayback) {
      video.play().catch(() => {});
    }
  };

  const detachHls = (): void => {
    destroyHlsInstance(video);
  };

  const attachWithHlsJs = (): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!window.Hls || !window.Hls.isSupported()) {
        reject(new Error('HLS.js not supported'));
        return;
      }

      detachHls();
      const hls = new window.Hls(DEFAULT_HLS_CONFIG);
      video.hlsInstance = hls;

      let settled = false;
      const finish = (ok: boolean, error?: Error): void => {
        if (settled) return;
        settled = true;
        if (ok) {
          restorePlaybackState();
          resolve();
        } else {
          detachHls();
          reject(error || new Error('HLS.js failed to initialize'));
        }
      };

      hls.on(window.Hls.Events.MANIFEST_PARSED, () => finish(true));
      hls.on(window.Hls.Events.ERROR, (_: string, data: unknown) => {
        const errorData = data as { fatal?: boolean; details?: string } | null;
        if (errorData && errorData.fatal) {
          finish(false, new Error(errorData.details || 'HLS.js fatal error'));
        }
      });

      hls.loadSource(params.hlsUrl);
      hls.attachMedia(video);
    });

  const attachNatively = (): Promise<void> =>
    new Promise((resolve, reject) => {
      if (!canPlayNative) {
        reject(new Error('Native HLS not supported'));
        return;
      }

      const onLoaded = (): void => {
        cleanup();
        restorePlaybackState();
        resolve();
      };
      const onError = (): void => {
        cleanup();
        reject(new Error('Native HLS failed to load'));
      };
      const cleanup = (): void => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeEventListener('error', onError);
      };

      detachHls();
      video.addEventListener('loadedmetadata', onLoaded);
      video.addEventListener('error', onError);
      video.src = params.hlsUrl;
      video.load();
    });

  let switched = false;
  try {
    await attachWithHlsJs();
    switched = true;
  } catch {
    try {
      await loadHlsScript();
      await attachWithHlsJs();
      switched = true;
    } catch {
      if (canPlayNative) {
        try {
          await attachNatively();
          switched = true;
        } catch {
          // Keep existing preview source on failure.
        }
      }
    }
  }

  if (!switched) {
    video.dataset.previewSource = 'blob';
    if (params.blobPreviewFailed && !state.hlsPreviewErrorShown) {
      state.hlsPreviewErrorShown = true;
      params.setStatus('Preview unavailable: HLS preview could not be initialized.', 'error');
      showNotification('HLS preview could not be initialized. Video will still process, but live preview is unavailable.', 'error', 5000);
    } else {
      params.setStatus();
    }
    return state;
  }

  state.hlsPreviewUrl = params.hlsUrl;
  video.classList.add('hls-video-preview');
  video.dataset.previewSource = 'hls';
  params.setStatus();
  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = null;
  }
  return state;
}

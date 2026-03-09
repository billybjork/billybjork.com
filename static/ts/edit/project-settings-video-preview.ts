import { attachHlsPlayback } from '../core/hls';
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

  let switched = false;
  try {
    await attachHlsPlayback({
      videoElement: video,
      sourceUrl: params.hlsUrl,
    });
    restorePlaybackState();
    switched = true;
  } catch {
    // Keep existing preview source on failure.
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

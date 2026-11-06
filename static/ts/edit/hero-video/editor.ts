import { attachHlsPlayback, destroyHlsInstance } from '../../core/hls';
import { lockBodyScroll, unlockBodyScroll } from '../../core/scroll-lock';
import type {
  HlsProgress,
  MoreThumbnailsResult,
  SpriteSheetResult,
  VideoData,
  VideoThumbnailsResult,
} from '../../types/api';
import { API, postForm, UploadError, uploadWithProgress } from '../api';
import { onEscape } from '../modal';
import { showNotification } from '../notify';
import { formatMegabytes, formatMinutesSeconds } from '../text';
import { buildHeroVideoMarkup } from './markup';
import { SpriteRange } from './sprite-range';
import { renderTimelineFrames } from './timeline';

interface HeroVideoEditorOptions {
  slug: string;
  /** A new video to upload; null re-cuts the sprite from the project's current video. */
  file: File | null;
  onVideoSaved(video: VideoData): void;
}

const THUMBNAIL_POLL_MS = 500;
const THUMBNAIL_RETRY_MS = 1000;
const HLS_POLL_MS = 1000;
// How long a finished progress message stays up before the bar hides or the dialog closes.
const PREVIEW_READY_MESSAGE_MS = 1200;
const HLS_READY_MESSAGE_MS = 1500;
const HLS_FAILED_MESSAGE_MS = 2000;
const SAVED_MESSAGE_MS = 800;
const GENERATING_MESSAGE = 'Generating sprite sheet & thumbnail...';

interface HlsWatch {
  barStart: number;
  barSpan: number;
  progressLabel: string;
  onComplete(): void;
  onError(): void;
}

class HeroVideoEditor {
  private readonly listeners = new AbortController();
  private readonly modal = document.createElement('div');
  private readonly content: HTMLElement;
  private readonly video: HTMLVideoElement;
  private readonly sprite: SpriteRange;
  private readonly progressDiv: HTMLElement;
  private readonly progressFill: HTMLElement;
  private readonly progressText: HTMLElement;
  private readonly processButton: HTMLButtonElement;

  private closed = false;
  private abortUpload: (() => void) | null = null;
  private objectUrl: string | null = null;
  private tempId: string | null = null;
  private hlsSessionId: string | null = null;
  private hlsComplete = false;
  private hlsPreviewUrl: string | null = null;
  private blobPreviewFailed = false;
  private hlsPreviewErrorShown = false;
  private renderedThumbCount = 0;
  private thumbnailTimer: ReturnType<typeof setTimeout> | undefined;
  private stopHlsWatch: (() => void) | null = null;

  constructor(private readonly options: HeroVideoEditorOptions) {
    this.modal.className = 'edit-hero-dialog-modal';
    this.modal.innerHTML = `
      <div class="edit-hero-dialog-overlay"></div>
      <div class="edit-hero-dialog-content edit-hero-dialog-content--video">
        ${buildHeroVideoMarkup(options.file, this.processButtonLabel())}
      </div>
    `;
    const find = <T extends Element>(selector: string): T => this.modal.querySelector<T>(selector) as T;
    this.content = find('.edit-hero-dialog-content');
    this.video = find('.edit-hero-video-player');
    this.progressDiv = find('.edit-hero-progress');
    this.progressFill = find('.edit-hero-progress-fill');
    this.progressText = find('.edit-hero-progress-text');
    this.processButton = find('#hero-video-process');
    this.sprite = new SpriteRange(this.content, this.video);

    const close = (): void => this.close();
    find('.edit-hero-dialog-overlay').addEventListener('click', close);
    find('.edit-hero-dialog-close').addEventListener('click', close);
    find('#hero-video-cancel').addEventListener('click', close);
    this.processButton.addEventListener('click', () => void this.process());
    onEscape(close, this.listeners.signal);
  }

  open(): void {
    document.body.appendChild(this.modal);
    lockBodyScroll();
    if (this.options.file) {
      void this.loadFromUpload(this.options.file);
    } else {
      void this.loadFromExisting();
    }
  }

  private isUpload(): boolean {
    return !!this.options.file;
  }

  private processButtonLabel(): string {
    return this.isUpload() ? 'Confirm & Generate Sprite' : 'Generate New Sprite';
  }

  private setProgress(percent: number, message: string): void {
    this.progressFill.style.width = `${percent}%`;
    this.progressText.textContent = message;
  }

  private hideProgressAfter(ms: number, then?: () => void): void {
    setTimeout(() => {
      if (this.closed) return;
      this.progressDiv.style.display = 'none';
      then?.();
    }, ms);
  }

  private setPreviewStatus(message = '', tone = 'info'): void {
    const status = this.modal.querySelector<HTMLElement>('.edit-hero-preview-status');
    if (!status) return;
    status.hidden = !message;
    status.textContent = message;
    status.classList.remove('is-info', 'is-warning', 'is-error', 'is-success');
    if (message) status.classList.add(`is-${tone}`);
  }

  private applyThumbnails(result: VideoThumbnailsResult): void {
    this.tempId = result.temp_id;
    const totalTime = this.content.querySelector('.edit-hero-total-time');
    if (totalTime) totalTime.textContent = formatMinutesSeconds(result.duration);
    this.sprite.setVideoDuration(result.duration);
    this.drawFrames(result.frames ?? []);

    const loading = this.content.querySelector<HTMLElement>('.edit-hero-timeline-loading');
    if (loading) loading.hidden = false;
    void this.pollThumbnails();

    this.processButton.disabled = false;
  }

  private drawFrames(frames: string[]): void {
    const canvas = this.content.querySelector<HTMLCanvasElement>('.edit-hero-timeline-thumbs');
    const drawn = canvas ? renderTimelineFrames(canvas, frames) : 0;
    if (drawn > 0) this.renderedThumbCount = drawn;
  }

  /** The server decodes any codec for thumbnails and starts encoding HLS while the user picks a range. */
  private async loadFromUpload(file: File): Promise<void> {
    this.progressDiv.style.display = 'block';
    this.progressText.textContent = 'Uploading video...';

    const formData = new FormData();
    formData.append('file', file);
    formData.append('project_slug', this.options.slug);

    const upload = uploadWithProgress<VideoThumbnailsResult>(API.videoThumbnails, formData, {
      onProgress: (progress) => {
        if (progress) {
          this.setProgress((progress.loaded / progress.total) * 50, `Uploading: ${formatMegabytes(progress.loaded)} / ${formatMegabytes(progress.total)} MB`);
        }
      },
    });
    this.abortUpload = upload.abort;

    let result: VideoThumbnailsResult;
    try {
      result = await upload.result;
    } catch (error) {
      if (this.closed) return;
      showNotification(this.uploadFailureMessage(error), 'error');
      this.close();
      return;
    } finally {
      this.abortUpload = null;
    }
    if (this.closed) return;

    this.applyThumbnails(result);

    if (result.hls_session_id) {
      this.hlsSessionId = result.hls_session_id;
      this.setProgress(50, 'Encoding HLS...');
      this.watchHls({
        barStart: 50,
        barSpan: 50,
        progressLabel: 'Encoding HLS',
        onComplete: () => {
          this.setProgress(100, 'HLS ready! Select sprite range and confirm.');
          this.hideProgressAfter(HLS_READY_MESSAGE_MS);
        },
        onError: () => {
          this.progressText.textContent = 'HLS encoding failed. Close this and upload the video again.';
          this.progressFill.classList.add('has-error');
          this.hideProgressAfter(HLS_FAILED_MESSAGE_MS, () => this.progressFill.classList.remove('has-error'));
        },
      });
    } else {
      this.progressDiv.style.display = 'none';
    }

    this.playUploadLocally(file);
    this.sprite.attach(this.listeners.signal);
  }

  private uploadFailureMessage(error: unknown): string {
    return error instanceof UploadError && error.kind === 'network'
      ? 'Network error during thumbnail extraction'
      : (error as UploadError).detail || 'Thumbnail extraction failed';
  }

  private playUploadLocally(file: File): void {
    this.objectUrl = URL.createObjectURL(file);
    const { video } = this;
    const isBlobSource = (): boolean => (video.currentSrc || video.src || '').startsWith('blob:');
    video.addEventListener('error', () => {
      if (!isBlobSource() || this.blobPreviewFailed) return;
      this.blobPreviewFailed = true;
      this.setPreviewStatus('Preview unavailable: this upload codec is not supported by your browser yet. It will appear once HLS finishes encoding.', 'warning');
      showNotification('Browser cannot play this upload codec. Preview will switch to HLS when ready.', 'info', 4500);
    }, { once: true });
    video.addEventListener('loadedmetadata', () => {
      if (!isBlobSource()) return;
      if (video.videoWidth === 0 && !this.blobPreviewFailed) {
        this.blobPreviewFailed = true;
        this.setPreviewStatus('Preview unavailable: browser can only decode audio for this upload. It will appear once HLS finishes encoding.', 'warning');
      } else if (!this.blobPreviewFailed) {
        this.setPreviewStatus();
      }
    }, { once: true });

    video.src = this.objectUrl;
  }

  private async loadFromExisting(): Promise<void> {
    this.progressDiv.style.display = 'block';
    this.setProgress(15, 'Loading current video...');

    try {
      const formData = new FormData();
      formData.append('project_slug', this.options.slug);
      const result = await postForm<VideoThumbnailsResult>(API.videoThumbnailsExisting, formData, 'Failed to load existing video');
      if (this.closed) return;

      this.hlsComplete = true;
      this.applyThumbnails(result);
      this.sprite.attach(this.listeners.signal);

      this.setProgress(65, 'Loading HLS preview...');
      if (result.hls_url) await this.switchPreviewToHls(result.hls_url);

      this.setProgress(100, 'Preview ready. Select sprite range and confirm.');
      this.hideProgressAfter(PREVIEW_READY_MESSAGE_MS);
    } catch (error) {
      if (this.closed) return;
      showNotification(`Failed to load existing hero video: ${(error as Error).message}`, 'error');
      this.close();
    }
  }

  /** The server extracts more frames in the background; each poll returns all of them so far. */
  private async pollThumbnails(warned = false): Promise<void> {
    if (!this.tempId || this.closed) return;
    const loading = this.content.querySelector<HTMLElement>('.edit-hero-timeline-loading');

    try {
      const response = await fetch(API.moreThumbnails(this.tempId));
      if (!response.ok) {
        console.warn(`Timeline thumbnails stopped: HTTP ${response.status}`);
        return;
      }
      const data = await response.json() as MoreThumbnailsResult;
      const frames = data.frames ?? [];
      if (frames.length > this.renderedThumbCount) this.drawFrames(frames);

      if (data.complete) {
        if (loading) loading.hidden = true;
        return;
      }
      if (loading) {
        loading.hidden = false;
        loading.textContent = `Refining timeline preview... (${frames.length} frames)`;
      }
      this.thumbnailTimer = setTimeout(() => void this.pollThumbnails(), THUMBNAIL_POLL_MS);
    } catch (error) {
      if (!warned) console.warn('Timeline thumbnail polling failed; retrying.', error);
      this.thumbnailTimer = setTimeout(() => void this.pollThumbnails(true), THUMBNAIL_RETRY_MS);
    }
  }

  private watchHls(watch: HlsWatch): void {
    const sessionId = this.hlsSessionId;
    if (!sessionId) return;
    this.stopHlsWatch?.();

    let warned = false;
    const warnOnce = (reason: unknown): void => {
      if (!warned) console.warn('HLS progress polling failed; retrying.', reason);
      warned = true;
    };

    const interval = setInterval(async () => {
      let data: HlsProgress;
      try {
        const response = await fetch(API.hlsProgress(sessionId));
        if (!response.ok) {
          warnOnce(`HTTP ${response.status}`);
          return;
        }
        data = await response.json() as HlsProgress;
      } catch (error) {
        warnOnce(error);
        return;
      }

      if (data.status === 'complete') {
        stop();
        this.hlsComplete = true;
        if (data.hls_url) await this.switchPreviewToHls(data.hls_url);
        watch.onComplete();
      } else if (data.status === 'error') {
        stop();
        watch.onError();
      } else {
        const percent = data.progress || 0;
        this.setProgress(
          watch.barStart + (percent / 100) * watch.barSpan,
          data.stage || `${watch.progressLabel}... ${Math.round(percent)}%`,
        );
      }
    }, HLS_POLL_MS);

    const stop = (): void => {
      clearInterval(interval);
      this.stopHlsWatch = null;
    };
    this.stopHlsWatch = stop;
  }

  private async switchPreviewToHls(hlsUrl: string): Promise<void> {
    if (this.closed || this.hlsPreviewUrl === hlsUrl) return;

    const { video } = this;
    const resumeTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const shouldResume = !video.paused || this.sprite.isLooping;

    try {
      await attachHlsPlayback({ videoElement: video, sourceUrl: hlsUrl });
    } catch (error) {
      console.warn('HLS preview could not start; keeping the current preview source.', error);
      if (this.blobPreviewFailed && !this.hlsPreviewErrorShown) {
        this.hlsPreviewErrorShown = true;
        this.setPreviewStatus('Preview unavailable: HLS preview could not be initialized.', 'error');
        showNotification('HLS preview could not be initialized. Video will still process, but live preview is unavailable.', 'error', 5000);
      } else {
        this.setPreviewStatus();
      }
      return;
    }

    if (resumeTime > 0) video.currentTime = resumeTime;
    if (shouldResume) {
      video.play().catch((error: unknown) => console.warn('Preview playback did not resume:', error));
    }
    this.hlsPreviewUrl = hlsUrl;
    this.setPreviewStatus();
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  /** Bar: 20-80% encoding, if still running, then 80-95% sprite generation, then saving. */
  private async process(): Promise<void> {
    this.processButton.disabled = true;
    this.processButton.textContent = 'Processing...';
    this.progressDiv.style.display = 'block';

    clearTimeout(this.thumbnailTimer);
    this.stopHlsWatch?.();

    if (this.hlsSessionId && !this.hlsComplete) {
      this.setProgress(20, 'Encoding video...');
      this.watchHls({
        barStart: 20,
        barSpan: 60,
        progressLabel: 'Encoding video',
        onComplete: () => this.setProgress(80, GENERATING_MESSAGE),
        // The sprite request reports the failure.
        onError: () => {},
      });
    } else {
      this.setProgress(80, GENERATING_MESSAGE);
    }

    const warnBeforeLeaving = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving, { signal: this.listeners.signal });

    const formData = new FormData();
    if (this.tempId) formData.append('temp_id', this.tempId);
    formData.append('project_slug', this.options.slug);
    formData.append('sprite_start', String(this.sprite.start));
    formData.append('sprite_duration', String(this.sprite.duration));
    if (this.hlsSessionId) formData.append('hls_session_id', this.hlsSessionId);

    try {
      const result = await postForm<SpriteSheetResult>(API.generateSpriteSheet, formData, 'Sprite sheet generation failed');
      this.tempId = null;
      this.stopHlsWatch?.();

      this.setProgress(95, 'Saving...');
      this.options.onVideoSaved(result.video);
      this.setProgress(100, 'Complete!');
      showNotification(this.isUpload() ? 'Video processed successfully!' : 'Hero sprite updated successfully!', 'success');
      setTimeout(() => this.close(), SAVED_MESSAGE_MS);
    } catch (error) {
      this.stopHlsWatch?.();
      showNotification(`Video processing failed: ${(error as Error).message}`, 'error');
      this.processButton.disabled = false;
      this.processButton.textContent = this.processButtonLabel();
      this.progressDiv.style.display = 'none';
    } finally {
      window.removeEventListener('beforeunload', warnBeforeLeaving);
    }
  }

  private close(): void {
    if (this.closed) return;
    this.closed = true;

    this.abortUpload?.();
    this.stopHlsWatch?.();
    clearTimeout(this.thumbnailTimer);
    this.listeners.abort();
    destroyHlsInstance(this.video);
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.modal.remove();
    unlockBodyScroll();
  }
}

export function openHeroVideoEditor(options: HeroVideoEditorOptions): void {
  new HeroVideoEditor(options).open();
}

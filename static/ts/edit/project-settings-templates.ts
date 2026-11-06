import { escapeHtml } from './text';

interface VideoViewMarkupOptions {
  isUploadFlow: boolean;
  file: File | null;
  processButtonText: string;
}

export function buildProjectVideoViewMarkup({
  isUploadFlow,
  file,
  processButtonText,
}: VideoViewMarkupOptions): string {
  const modalTitle = isUploadFlow ? 'Process Hero Video' : 'Update Hero Sprite';
  const fileInfoText = isUploadFlow && file
    ? `${escapeHtml(file.name)} (${(file.size / (1024 * 1024)).toFixed(1)} MB)`
    : 'Using current hero HLS stream';
  const initialProgressText = isUploadFlow ? 'Uploading...' : 'Loading current video...';

  return `
      <div class="edit-settings-header">
        <h2>${modalTitle}</h2>
        <button class="edit-settings-close">&times;</button>
      </div>
      <div class="edit-hero-video-preview">
        <video class="edit-hero-video-player" controls playsinline></video>
      </div>
      <div class="edit-hero-file-info">${fileInfoText}</div>
      <div class="edit-hero-preview-status" hidden></div>
      <div class="edit-hero-timeline">
        <div class="edit-hero-timeline-track">
          <canvas class="edit-hero-timeline-thumbs"></canvas>
          <div class="edit-hero-timeline-dim-left"></div>
          <div class="edit-hero-timeline-dim-right"></div>
          <div class="edit-hero-sprite-range">
            <div class="edit-hero-sprite-handle edit-hero-sprite-handle--start" data-handle="start">
              <div class="edit-hero-sprite-handle-grip"></div>
            </div>
            <div class="edit-hero-sprite-handle edit-hero-sprite-handle--end" data-handle="end">
              <div class="edit-hero-sprite-handle-grip"></div>
            </div>
          </div>
          <div class="edit-hero-playhead"></div>
        </div>
      </div>
      <div class="edit-hero-timeline-loading" hidden>Refining timeline preview...</div>
      <p class="edit-hero-thumbnail-note">Hero poster is always frame 0. Sprite range only affects the sprite sheet.</p>
      <div class="edit-hero-time-display">
        <span class="edit-hero-current-time">0:00</span>
        <span class="edit-hero-sprite-info">Sprite: 0:00 - 0:03 (3.0s)</span>
        <span class="edit-hero-total-time">0:00</span>
      </div>
      <div class="edit-hero-progress" style="display: none;">
        <div class="edit-hero-progress-bar">
          <div class="edit-hero-progress-fill"></div>
        </div>
        <div class="edit-hero-progress-text">${initialProgressText}</div>
      </div>
      <div class="edit-hero-actions">
        <button type="button" class="edit-btn edit-btn-secondary" id="hero-video-cancel">Cancel</button>
        <button type="button" class="edit-btn edit-btn-primary" id="hero-video-process" disabled>${processButtonText}</button>
      </div>
    `;
}

import { escapeHtml, escapeHtmlAttr } from '../core/text';

interface VideoDataTemplate {
  hls?: string;
}

interface ProjectDataTemplate {
  name: string;
  slug: string;
  date: string;
  youtube?: string | null;
  draft?: boolean;
  pinned?: boolean;
  video?: VideoDataTemplate;
}

interface VideoViewMarkupOptions {
  isUploadFlow: boolean;
  file: File | null;
  processButtonText: string;
}

export function buildProjectSettingsMarkup(data: ProjectDataTemplate): string {
  return `
      <div class="edit-settings-header">
        <h2>Project Settings</h2>
        <button class="edit-settings-close">&times;</button>
      </div>
      <form class="edit-settings-form" id="settings-form">
        <div class="edit-form-group">
          <label for="settings-name">Project Name</label>
          <input type="text" id="settings-name" name="name" value="${escapeHtmlAttr(data.name || '')}" required>
        </div>
        <div class="edit-form-group">
          <label for="settings-slug">URL Slug</label>
          <input type="text" id="settings-slug" name="slug" value="${escapeHtmlAttr(data.slug || '')}" required pattern="[a-z0-9\\-]+">
        </div>
        <div class="edit-form-group">
          <label for="settings-date">Date</label>
          <input type="date" id="settings-date" name="date" value="${data.date || ''}" required>
        </div>
        <div class="edit-form-group">
          <label for="settings-youtube">YouTube Link</label>
          <input type="url" id="settings-youtube" name="youtube" value="${escapeHtmlAttr(data.youtube || '')}" placeholder="https://youtube.com/watch?v=...">
        </div>
        <div class="edit-form-row">
          <div class="edit-form-group edit-form-checkbox">
            <label>
              <input type="checkbox" id="settings-draft" name="draft" ${data.draft ? 'checked' : ''}>
              Draft
            </label>
          </div>
          <div class="edit-form-group edit-form-checkbox">
            <label>
              <input type="checkbox" id="settings-pinned" name="pinned" ${data.pinned ? 'checked' : ''}>
              Pinned
            </label>
          </div>
        </div>

        <div class="edit-form-section">
          <h3>Hero Video</h3>
          <div class="edit-form-group">
            <label>Current Video</label>
            ${
              data.video?.hls
                ? `<div class="edit-video-info">
                    <span>HLS: ${data.video.hls.split('/').pop()}</span>
                    <div class="edit-video-actions">
                      <button type="button" class="edit-btn-small" id="update-hero-sprite">Update Sprite</button>
                      <button type="button" class="edit-btn-small" id="upload-hero-video">Replace</button>
                    </div>
                   </div>`
                : `<button type="button" class="edit-btn edit-btn-secondary" id="upload-hero-video">Upload Hero Video</button>`
            }
            <input type="file" id="hero-video-input" accept="video/*" style="display: none;">
          </div>
        </div>

        <div class="edit-settings-actions">
          <button type="button" class="edit-btn edit-btn-danger" id="delete-project">Delete Project</button>
          <div class="edit-settings-actions-right">
            <button type="button" class="edit-btn edit-btn-secondary" id="settings-cancel">Cancel</button>
            <button type="submit" class="edit-btn edit-btn-primary">Save Settings</button>
          </div>
        </div>
      </form>
    `;
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

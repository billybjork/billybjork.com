/**
 * Project Settings Modal
 * Handles project metadata editing, hero video upload, and sprite range selection
 */

import { showNotification, fetchJSON, withShowDrafts, lockBodyScroll, unlockBodyScroll } from '../core/utils';

const MIN_SPRITE_DURATION = 1;
const MAX_SPRITE_DURATION = 6;
const DEFAULT_SPRITE_DURATION = 3;

interface VideoData {
  hls?: string;
  spriteSheet?: string;
  thumbnail?: string;
  frames?: number;
  columns?: number;
  rows?: number;
  frame_width?: number;
  frame_height?: number;
  fps?: number;
  duration?: number;
}

interface ProjectData {
  name: string;
  slug: string;
  date: string;
  youtube?: string | null;
  draft?: boolean;
  pinned?: boolean;
  video?: VideoData;
  markdown?: string;
  revision?: string;
}

type ViewType = 'settings' | 'video';
type VideoFlowMode = 'upload' | 'existing';

interface ProjectSettingsState {
  modal: HTMLElement | null;
  projectSlug: string | null;
  projectData: ProjectData | null;
  currentView: ViewType;
  videoFile: File | null;
  videoFlowMode: VideoFlowMode;
  spriteStart: number;
  spriteDuration: number;
  objectUrl: string | null;
  activeXhr: XMLHttpRequest | null;
  videoEl: HTMLVideoElement | null;
  videoDuration: number;
  escHandler: ((e: KeyboardEvent) => void) | null;
  _isDraggingSprite: boolean;
  _mouseMoveHandler: ((e: MouseEvent) => void) | null;
  _mouseUpHandler: (() => void) | null;
  _keyHandler: ((e: KeyboardEvent) => void) | null;
  _beforeUnloadHandler: ((e: BeforeUnloadEvent) => void) | null;
  _spriteLooping: boolean;
  _dragTarget: 'range' | 'start' | 'end' | null;
  _dragOffset: number;
  _wasLoopingBeforeDrag: boolean;
  _touchMoveHandler: ((e: TouchEvent) => void) | null;
  _touchEndHandler: (() => void) | null;
  _rafId: number | null;
  _cachedTrack: HTMLElement | null;
  _cachedRange: HTMLElement | null;
  _cachedDimLeft: HTMLElement | null;
  _cachedDimRight: HTMLElement | null;
  _cachedInfo: Element | null;
  _tempId: string | null;
  _hlsSessionId: string | null;
  _hlsComplete: boolean;
  _hlsPollTimer: ReturnType<typeof setInterval> | null;
  _thumbnailPollTimer: ReturnType<typeof setTimeout> | null;
  _hlsScriptPromise: Promise<void> | null;
  _hlsPreviewUrl: string | null;
  _blobPreviewFailed: boolean;
  _previewCodecErrorShown: boolean;
  _hlsPreviewErrorShown: boolean;
  _renderedThumbCount: number;
}

const ProjectSettings: ProjectSettingsState & {
  show(slug: string): Promise<void>;
  hide(): void;
  createModal(): void;
  setupBaseListeners(): void;
  renderSettingsView(): void;
  setupSettingsListeners(): void;
  showVideoView(file?: File | null): void;
  getProcessButtonText(): string;
  extractServerThumbnails(file: File, content: Element): void;
  extractExistingVideoThumbnails(content: Element): Promise<void>;
  pollRemainingThumbnails(): void;
  pollHlsProgress(progressFill: HTMLElement, progressText: HTMLElement, progressDiv: HTMLElement): void;
  loadHlsScript(): Promise<void>;
  switchPreviewToHls(hlsUrl: string): Promise<void>;
  updatePreviewStatus(message?: string, tone?: string): void;
  renderServerThumbnails(framesB64: string[]): void;
  setupVideoListeners(content: Element): void;
  updateSpriteLoopUI(): void;
  showSettingsView(): void;
  cleanupVideoState(): void;
  handleDrag(clientX: number): void;
  updateSpriteRange(): void;
  updatePlayhead(): void;
  processVideo(): Promise<void>;
  handleProcessingError(message: string, processBtn: HTMLButtonElement | null, progressDiv: HTMLElement | null): void;
  cancelUpload(): void;
  formatTime(seconds: number): string;
  escAttr(str: string): string;
  escHtml(str: string): string;
  saveSettings(): Promise<void>;
  saveVideoData(videoData: VideoData): Promise<void>;
  deleteProject(): Promise<void>;
} = {
  modal: null,
  projectSlug: null,
  projectData: null,
  currentView: 'settings',
  videoFile: null,
  videoFlowMode: 'upload',
  spriteStart: 0,
  spriteDuration: DEFAULT_SPRITE_DURATION,
  objectUrl: null,
  activeXhr: null,
  videoEl: null,
  videoDuration: 0,
  escHandler: null,
  _isDraggingSprite: false,
  _mouseMoveHandler: null,
  _mouseUpHandler: null,
  _keyHandler: null,
  _beforeUnloadHandler: null,
  _spriteLooping: false,
  _dragTarget: null,
  _dragOffset: 0,
  _wasLoopingBeforeDrag: false,
  _touchMoveHandler: null,
  _touchEndHandler: null,
  _rafId: null,
  _cachedTrack: null,
  _cachedRange: null,
  _cachedDimLeft: null,
  _cachedDimRight: null,
  _cachedInfo: null,
  _tempId: null,
  _hlsSessionId: null,
  _hlsComplete: false,
  _hlsPollTimer: null,
  _thumbnailPollTimer: null,
  _hlsScriptPromise: null,
  _hlsPreviewUrl: null,
  _blobPreviewFailed: false,
  _previewCodecErrorShown: false,
  _hlsPreviewErrorShown: false,
  _renderedThumbCount: 0,

  /**
   * Show settings modal for a project
   */
  async show(slug: string): Promise<void> {
    this.projectSlug = slug;

    // Pause any playing videos in the project
    const projectItem = document.querySelector(`#project-${slug}`);
    if (projectItem) {
      projectItem.querySelectorAll('video').forEach((video) => (video as HTMLVideoElement).pause());
    }

    try {
      this.projectData = await fetchJSON<ProjectData>(`/api/project/${slug}`);
      this.createModal();
    } catch (error) {
      console.error('Failed to load project:', error);
      showNotification('Failed to load project settings', 'error');
    }
  },

  /**
   * Create the modal
   */
  createModal(): void {
    this.currentView = 'settings';
    this.modal = document.createElement('div');
    this.modal.className = 'edit-settings-modal';
    this.modal.innerHTML = `
      <div class="edit-settings-overlay"></div>
      <div class="edit-settings-content"></div>
    `;

    document.body.appendChild(this.modal);
    lockBodyScroll();

    this.renderSettingsView();
    this.setupBaseListeners();
  },

  /**
   * Setup base listeners (overlay, escape)
   */
  setupBaseListeners(): void {
    if (!this.modal) return;

    // Overlay click
    const overlay = this.modal.querySelector('.edit-settings-overlay');
    if (overlay) {
      overlay.addEventListener('click', () => {
        if (this.currentView === 'video') {
          this.showSettingsView();
        } else {
          this.hide();
        }
      });
    }

    // Escape key
    this.escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.modal) {
        e.preventDefault();
        e.stopPropagation();
        if (this.currentView === 'video') {
          this.cancelUpload();
        } else {
          this.hide();
        }
      }
    };
    document.addEventListener('keydown', this.escHandler, true);
  },

  /**
   * Render the settings form view
   */
  renderSettingsView(): void {
    this.currentView = 'settings';
    const data = this.projectData;
    if (!this.modal || !data) return;

    const content = this.modal.querySelector('.edit-settings-content');
    if (!content) return;

    // Remove video class
    content.classList.remove('edit-settings-content--video');

    content.innerHTML = `
      <div class="edit-settings-header">
        <h2>Project Settings</h2>
        <button class="edit-settings-close">&times;</button>
      </div>
      <form class="edit-settings-form" id="settings-form">
        <div class="edit-form-group">
          <label for="settings-name">Project Name</label>
          <input type="text" id="settings-name" name="name" value="${this.escAttr(data.name || '')}" required>
        </div>
        <div class="edit-form-group">
          <label for="settings-slug">URL Slug</label>
          <input type="text" id="settings-slug" name="slug" value="${this.escAttr(data.slug || '')}" required pattern="[a-z0-9\\-]+">
        </div>
        <div class="edit-form-group">
          <label for="settings-date">Date</label>
          <input type="date" id="settings-date" name="date" value="${data.date || ''}" required>
        </div>
        <div class="edit-form-group">
          <label for="settings-youtube">YouTube Link</label>
          <input type="url" id="settings-youtube" name="youtube" value="${this.escAttr(data.youtube || '')}" placeholder="https://youtube.com/watch?v=...">
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

    this.setupSettingsListeners();
  },

  /**
   * Setup settings-specific listeners
   */
  setupSettingsListeners(): void {
    if (!this.modal) return;
    const content = this.modal.querySelector('.edit-settings-content');
    if (!content) return;

    const closeBtn = content.querySelector('.edit-settings-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.hide());

    const cancelBtn = content.querySelector('#settings-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.hide());

    const form = content.querySelector('#settings-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.saveSettings();
      });
    }

    const deleteBtn = content.querySelector('#delete-project');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        if (confirm(`Are you sure you want to delete "${this.projectData?.name}"? This cannot be undone.`)) {
          await this.deleteProject();
        }
      });
    }

    // Hero video upload
    const uploadBtn = content.querySelector('#upload-hero-video');
    const updateSpriteBtn = content.querySelector('#update-hero-sprite');
    const fileInput = content.querySelector('#hero-video-input') as HTMLInputElement | null;

    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener('click', () => fileInput.click());

      fileInput.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        const file = target.files?.[0];
        if (file) {
          if (!file.type.startsWith('video/')) {
            showNotification('Please select a video file', 'error');
            return;
          }
          this.showVideoView(file);
        }
      });
    }

    if (updateSpriteBtn) {
      updateSpriteBtn.addEventListener('click', () => {
        if (!this.projectData?.video?.hls) {
          showNotification('No existing hero video found for this project.', 'error');
          return;
        }
        this.showVideoView();
      });
    }
  },

  /**
   * Show the video processing view (replaces settings form in-place)
   */
  showVideoView(file: File | null = null): void {
    const isUploadFlow = !!file;
    this.currentView = 'video';
    this.videoFile = file;
    this.videoFlowMode = isUploadFlow ? 'upload' : 'existing';
    this.spriteStart = 0;
    this.spriteDuration = DEFAULT_SPRITE_DURATION;
    this.videoDuration = 0;
    this._spriteLooping = false;
    this._tempId = null;

    // Reset HLS state
    this._hlsSessionId = null;
    this._hlsComplete = false;
    this._hlsPreviewUrl = null;
    this._blobPreviewFailed = false;
    this._previewCodecErrorShown = false;
    this._hlsPreviewErrorShown = false;
    this._renderedThumbCount = 0;

    if (!this.modal) return;
    const content = this.modal.querySelector('.edit-settings-content');
    if (!content) return;

    content.classList.add('edit-settings-content--video');
    const processButtonText = this.getProcessButtonText();
    const modalTitle = isUploadFlow ? 'Process Hero Video' : 'Update Hero Sprite';
    const fileInfoText = isUploadFlow && file
      ? `${this.escHtml(file.name)} (${(file.size / (1024 * 1024)).toFixed(1)} MB)`
      : 'Using current hero HLS stream';
    const initialProgressText = isUploadFlow ? 'Uploading...' : 'Loading current video...';

    content.innerHTML = `
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

    // Get reference to video element
    this.videoEl = content.querySelector('.edit-hero-video-player');
    this.updatePreviewStatus();

    // Close goes back to settings
    const closeBtn = content.querySelector('.edit-settings-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.cancelUpload());

    // Action buttons
    const cancelBtn = content.querySelector('#hero-video-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.cancelUpload());

    const processBtn = content.querySelector('#hero-video-process');
    if (processBtn) processBtn.addEventListener('click', () => this.processVideo());

    if (isUploadFlow && file) {
      // Immediately upload to server for thumbnail extraction
      this.extractServerThumbnails(file, content);
      return;
    }

    // Load preview frames from the currently-saved HLS URL
    void this.extractExistingVideoThumbnails(content);
  },

  /**
   * Label for the primary action button in the video modal.
   */
  getProcessButtonText(): string {
    return this.videoFlowMode === 'existing' ? 'Generate New Sprite' : 'Confirm & Generate Sprite';
  },

  /**
   * Extract thumbnails using server-side ffmpeg.
   * Supports any codec (ProRes, HEVC, etc.) that ffmpeg can decode.
   *
   * Also triggers auto-HLS encoding in parallel - HLS starts immediately
   * while user selects sprite range. Progress is shown in the main progress bar.
   */
  extractServerThumbnails(file: File, content: Element): void {
    const processBtn = content.querySelector('#hero-video-process') as HTMLButtonElement | null;
    const progressDiv = content.querySelector('.edit-hero-progress') as HTMLElement | null;
    const progressFill = content.querySelector('.edit-hero-progress-fill') as HTMLElement | null;
    const progressText = content.querySelector('.edit-hero-progress-text') as HTMLElement | null;

    if (!progressDiv || !progressFill || !progressText) return;

    progressDiv.style.display = 'block';
    progressText.textContent = 'Uploading video...';

    const formData = new FormData();
    formData.append('file', file);
    // Pass project_slug to auto-start HLS encoding in parallel
    if (this.projectSlug) formData.append('project_slug', this.projectSlug);

    const xhr = new XMLHttpRequest();
    this.activeXhr = xhr;

    // Upload progress: 0-50% of bar
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const pct = (e.loaded / e.total) * 50;
        progressFill.style.width = `${pct}%`;
        const mb = (e.loaded / (1024 * 1024)).toFixed(1);
        const totalMb = (e.total / (1024 * 1024)).toFixed(1);
        progressText.textContent = `Uploading: ${mb} / ${totalMb} MB`;
      }
    });

    xhr.addEventListener('load', () => {
      this.activeXhr = null;

      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const result = JSON.parse(xhr.responseText);
          if (result.success) {
            // Store temp_id for later processing
            this._tempId = result.temp_id;
            this.videoDuration = result.duration;

            // Update UI with duration
            const totalTimeEl = content.querySelector('.edit-hero-total-time');
            if (totalTimeEl) totalTimeEl.textContent = this.formatTime(this.videoDuration);
            this.updateSpriteRange();

            // Render first frame immediately on timeline
            this.renderServerThumbnails(result.frames);
            const timelineLoading = content.querySelector('.edit-hero-timeline-loading') as HTMLElement | null;
            if (timelineLoading) timelineLoading.hidden = false;

            // Start polling for remaining thumbnail frames
            this.pollRemainingThumbnails();

            // Enable process button
            if (processBtn) processBtn.disabled = false;

            // Start HLS progress polling if session ID returned
            // Progress bar continues from 50% to 100% for HLS encoding
            if (result.hls_session_id) {
              this._hlsSessionId = result.hls_session_id;
              progressFill.style.width = '50%';
              progressText.textContent = 'Encoding HLS...';
              this.pollHlsProgress(progressFill, progressText, progressDiv);
            } else {
              progressDiv.style.display = 'none';
            }

            // Set local preview source; if unsupported, we'll switch to HLS when ready
            this.objectUrl = URL.createObjectURL(file);
            this.videoEl = content.querySelector('.edit-hero-video-player');

            if (this.videoEl) {
              this.videoEl.classList.remove('hls-video-preview');
              this.videoEl.dataset.previewSource = 'blob';

              this.videoEl.addEventListener(
                'error',
                () => {
                  if (!this.videoEl) return;
                  const src = this.videoEl.currentSrc || this.videoEl.src || '';
                  if (!src.startsWith('blob:') || this._previewCodecErrorShown) return;
                  this._blobPreviewFailed = true;
                  this._previewCodecErrorShown = true;
                  this.updatePreviewStatus(
                    'Preview unavailable: this upload codec is not supported by your browser yet. It will appear once HLS finishes encoding.',
                    'warning'
                  );
                  showNotification('Browser cannot play this upload codec. Preview will switch to HLS when ready.', 'info', 4500);
                },
                { once: true }
              );

              this.videoEl.addEventListener(
                'loadedmetadata',
                () => {
                  if (!this.videoEl) return;
                  const src = this.videoEl.currentSrc || this.videoEl.src || '';
                  if (!src.startsWith('blob:')) return;
                  if (this.videoEl.videoWidth === 0 && !this._blobPreviewFailed) {
                    this._blobPreviewFailed = true;
                    this.updatePreviewStatus(
                      'Preview unavailable: browser can only decode audio for this upload. It will appear once HLS finishes encoding.',
                      'warning'
                    );
                  } else if (!this._blobPreviewFailed) {
                    this.updatePreviewStatus();
                  }
                },
                { once: true }
              );

              if (this.objectUrl) this.videoEl.src = this.objectUrl;

              // Set up video event listeners
              this.setupVideoListeners(content);
            }
          } else {
            throw new Error(result.detail || 'Thumbnail extraction failed');
          }
        } catch (e) {
          showNotification(`Thumbnail extraction failed: ${(e as Error).message}`, 'error');
          this.cancelUpload();
        }
      } else {
        let msg = 'Thumbnail extraction failed';
        try {
          msg = JSON.parse(xhr.responseText).detail || msg;
        } catch {
          // Use default message
        }
        showNotification(msg, 'error');
        this.cancelUpload();
      }
    });

    xhr.addEventListener('error', () => {
      this.activeXhr = null;
      showNotification('Network error during thumbnail extraction', 'error');
      this.cancelUpload();
    });

    xhr.open('POST', '/api/video-thumbnails');
    xhr.send(formData);
  },

  /**
   * Extract timeline thumbnails from the current project's saved HLS URL.
   */
  async extractExistingVideoThumbnails(content: Element): Promise<void> {
    const processBtn = content.querySelector('#hero-video-process') as HTMLButtonElement | null;
    const progressDiv = content.querySelector('.edit-hero-progress') as HTMLElement | null;
    const progressFill = content.querySelector('.edit-hero-progress-fill') as HTMLElement | null;
    const progressText = content.querySelector('.edit-hero-progress-text') as HTMLElement | null;

    if (!progressDiv || !progressFill || !progressText) return;
    if (!this.projectSlug) {
      showNotification('Project slug missing. Please reload and try again.', 'error');
      this.cancelUpload();
      return;
    }

    progressDiv.style.display = 'block';
    progressFill.style.width = '15%';
    progressText.textContent = 'Loading current video...';

    try {
      const formData = new FormData();
      formData.append('project_slug', this.projectSlug);

      const response = await fetch('/api/video-thumbnails-existing', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to load existing video');
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.detail || 'Failed to load existing video');
      }

      this._tempId = result.temp_id;
      this.videoDuration = result.duration;
      this._hlsComplete = true;
      this._hlsSessionId = null;

      const totalTimeEl = content.querySelector('.edit-hero-total-time');
      if (totalTimeEl) totalTimeEl.textContent = this.formatTime(this.videoDuration);
      this.updateSpriteRange();

      this.renderServerThumbnails(result.frames || []);
      const timelineLoading = content.querySelector('.edit-hero-timeline-loading') as HTMLElement | null;
      if (timelineLoading) timelineLoading.hidden = false;
      this.pollRemainingThumbnails();

      if (processBtn) processBtn.disabled = false;

      this.videoEl = content.querySelector('.edit-hero-video-player');
      this.updatePreviewStatus();
      this.setupVideoListeners(content);

      progressFill.style.width = '65%';
      progressText.textContent = 'Loading HLS preview...';
      if (result.hls_url) {
        await this.switchPreviewToHls(result.hls_url);
      }

      progressFill.style.width = '100%';
      progressText.textContent = 'Preview ready. Select sprite range and confirm.';
      setTimeout(() => {
        if (this.currentView === 'video') {
          progressDiv.style.display = 'none';
        }
      }, 1200);
    } catch (error) {
      showNotification(`Failed to load existing hero video: ${(error as Error).message}`, 'error');
      this.cancelUpload();
    }
  },

  /**
   * Poll for remaining thumbnail frames extracted in background.
   */
  pollRemainingThumbnails(): void {
    const poll = async (): Promise<void> => {
      if (!this._tempId || this.currentView !== 'video') return;

      try {
        const res = await fetch(`/api/video-thumbnails/more/${this._tempId}`);
        if (!res.ok) return;

        const data = await res.json();
        const timelineLoading = this.modal?.querySelector('.edit-hero-timeline-loading') as HTMLElement | null;
        // Re-render with all available frames
        if (data.frames && data.frames.length > this._renderedThumbCount) {
          this.renderServerThumbnails(data.frames);
        }

        if (!data.complete) {
          if (timelineLoading) {
            timelineLoading.hidden = false;
            const frameCount = Array.isArray(data.frames) ? data.frames.length : this._renderedThumbCount;
            timelineLoading.textContent = `Refining timeline preview... (${frameCount} frames)`;
          }
          this._thumbnailPollTimer = setTimeout(poll, 500);
        } else if (timelineLoading) {
          timelineLoading.hidden = true;
        }
      } catch {
        // Polling error, keep trying
        this._thumbnailPollTimer = setTimeout(poll, 1000);
      }
    };
    poll();
  },

  /**
   * Poll HLS encoding progress, updating the main progress bar.
   * Progress bar goes from 50% to 100% during HLS encoding.
   */
  pollHlsProgress(progressFill: HTMLElement, progressText: HTMLElement, progressDiv: HTMLElement): void {
    if (!this._hlsSessionId) return;

    this._hlsPollTimer = setInterval(async () => {
      if (!this._hlsSessionId || this.currentView !== 'video') {
        if (this._hlsPollTimer) {
          clearInterval(this._hlsPollTimer);
          this._hlsPollTimer = null;
        }
        return;
      }

      try {
        const res = await fetch(`/api/hls-progress/${this._hlsSessionId}`);
        if (!res.ok) return;

        const data = await res.json();

        if (data.status === 'complete') {
          if (this._hlsPollTimer) {
            clearInterval(this._hlsPollTimer);
            this._hlsPollTimer = null;
          }
          this._hlsComplete = true;

          if (data.hls_url) {
            await this.switchPreviewToHls(data.hls_url);
          }

          progressFill.style.width = '100%';
          progressText.textContent = 'HLS ready! Select sprite range and confirm.';

          // Hide progress bar after a moment
          setTimeout(() => {
            if (progressDiv && this.currentView === 'video') {
              progressDiv.style.display = 'none';
            }
          }, 1500);
        } else if (data.status === 'error') {
          if (this._hlsPollTimer) {
            clearInterval(this._hlsPollTimer);
            this._hlsPollTimer = null;
          }

          progressText.textContent = 'HLS encoding failed - will retry on confirm';
          progressFill.style.background = '#ef4444';

          setTimeout(() => {
            if (progressDiv && this.currentView === 'video') {
              progressDiv.style.display = 'none';
              progressFill.style.background = '';
            }
          }, 2000);
        } else {
          // Map HLS progress (0-100) to bar progress (50-100)
          const hlsProgress = data.progress || 0;
          const barProgress = 50 + hlsProgress * 0.5;
          progressFill.style.width = `${barProgress}%`;
          progressText.textContent = data.stage || `Encoding HLS... ${Math.round(hlsProgress)}%`;
        }
      } catch {
        // Polling error, keep trying
      }
    }, 1000);
  },

  /**
   * Lazy-load HLS.js for editor preview playback.
   */
  loadHlsScript(): Promise<void> {
    if (window.Hls) return Promise.resolve();
    if (this._hlsScriptPromise) return this._hlsScriptPromise;

    const hlsJsSrc = document.body.dataset.hlsJsSrc || 'https://cdn.jsdelivr.net/npm/hls.js@1.5.12';
    this._hlsScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = hlsJsSrc;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load HLS.js'));
      document.head.appendChild(script);
    });

    return this._hlsScriptPromise;
  },

  /**
   * Switch preview playback from local blob source to encoded HLS stream.
   */
  async switchPreviewToHls(hlsUrl: string): Promise<void> {
    if (!hlsUrl || !this.videoEl || this.currentView !== 'video') return;
    if (this._hlsPreviewUrl === hlsUrl) return;

    const video = this.videoEl;
    const resumeTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const shouldResumePlayback = !video.paused || this._spriteLooping;
    const canPlayNative = !!video.canPlayType('application/vnd.apple.mpegurl');

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

    const destroyHlsInstance = (): void => {
      if (video.hlsInstance) {
        video.hlsInstance.destroy();
        video.hlsInstance = null;
      }
    };

    const attachWithHlsJs = (): Promise<void> =>
      new Promise((resolve, reject) => {
        if (!window.Hls || !window.Hls.isSupported()) {
          reject(new Error('HLS.js not supported'));
          return;
        }

        destroyHlsInstance();
        const hls = new window.Hls({
          abrEwmaDefaultEstimate: 5000000,
          capLevelToPlayerSize: true,
        });
        video.hlsInstance = hls;

        let settled = false;
        const finish = (ok: boolean, error?: Error): void => {
          if (settled) return;
          settled = true;
          if (ok) {
            restorePlaybackState();
            resolve();
          } else {
            destroyHlsInstance();
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

        hls.loadSource(hlsUrl);
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

        destroyHlsInstance();
        video.addEventListener('loadedmetadata', onLoaded);
        video.addEventListener('error', onError);
        video.src = hlsUrl;
        video.load();
      });

    let switched = false;
    try {
      await attachWithHlsJs();
      switched = true;
    } catch {
      try {
        await this.loadHlsScript();
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
      if (this._blobPreviewFailed && !this._hlsPreviewErrorShown) {
        this._hlsPreviewErrorShown = true;
        this.updatePreviewStatus('Preview unavailable: HLS preview could not be initialized.', 'error');
        showNotification('HLS preview could not be initialized. Video will still process, but live preview is unavailable.', 'error', 5000);
      } else {
        this.updatePreviewStatus();
      }
      return;
    }

    this._hlsPreviewUrl = hlsUrl;
    video.classList.add('hls-video-preview');
    video.dataset.previewSource = 'hls';
    this.updatePreviewStatus();
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  },

  /**
   * Update preview source status text in the video modal.
   */
  updatePreviewStatus(message = '', tone = 'info'): void {
    if (!this.modal || this.currentView !== 'video') return;
    const el = this.modal.querySelector('.edit-hero-preview-status') as HTMLElement | null;
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
  },

  /**
   * Render server-extracted thumbnail frames on the timeline canvas.
   */
  renderServerThumbnails(framesB64: string[]): void {
    if (!this.modal) return;
    const canvas = this.modal.querySelector('.edit-hero-timeline-thumbs') as HTMLCanvasElement | null;
    if (!canvas || !framesB64 || framesB64.length === 0) return;
    this._renderedThumbCount = framesB64.length;

    const track = canvas.parentElement;
    if (!track) return;
    const trackWidth = track.clientWidth;
    const trackHeight = track.clientHeight;

    // Size canvas to match track at device pixel ratio
    const dpr = window.devicePixelRatio || 1;
    canvas.width = trackWidth * dpr;
    canvas.height = trackHeight * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, trackWidth, trackHeight);

    const numThumbs = framesB64.length;
    const loadedImages: Array<HTMLImageElement | null> = new Array(numThumbs).fill(null);
    let completed = 0;

    const drawSlice = (img: HTMLImageElement, index: number): void => {
      // Integer slice boundaries avoid hairline seams.
      const x0 = Math.floor((index * trackWidth) / numThumbs);
      const x1 = index === numThumbs - 1
        ? trackWidth
        : Math.floor(((index + 1) * trackWidth) / numThumbs);
      const drawWidth = Math.max(1, x1 - x0);

      // "Cover" crop so each slice fills destination without squish.
      const srcAspect = img.width / img.height;
      const dstAspect = drawWidth / trackHeight;
      let sx = 0;
      let sy = 0;
      let sw = img.width;
      let sh = img.height;

      if (srcAspect > dstAspect) {
        sw = Math.max(1, Math.round(img.height * dstAspect));
        sx = Math.max(0, Math.floor((img.width - sw) / 2));
      } else if (srcAspect < dstAspect) {
        sh = Math.max(1, Math.round(img.width / dstAspect));
        sy = Math.max(0, Math.floor((img.height - sh) / 2));
      }

      // Slight overlap hides anti-aliased seam artifacts between slices.
      const dstX = Math.max(0, x0 - (index > 0 ? 1 : 0));
      const dstW = Math.min(trackWidth - dstX, drawWidth + (index > 0 ? 1 : 0));
      ctx.drawImage(img, sx, sy, sw, sh, dstX, 0, dstW, trackHeight);
    };

    const finishOne = (): void => {
      completed++;
      if (completed !== numThumbs) return;

      ctx.clearRect(0, 0, trackWidth, trackHeight);

      // Fill any failed slots with nearest valid neighbor to avoid visible holes.
      let lastValid: HTMLImageElement | null = null;
      for (let i = 0; i < numThumbs; i++) {
        const current = loadedImages[i] ?? null;
        if (current) {
          lastValid = current;
        } else if (lastValid) {
          loadedImages[i] = lastValid;
        }
      }
      let nextValid: HTMLImageElement | null = null;
      for (let i = numThumbs - 1; i >= 0; i--) {
        const current = loadedImages[i] ?? null;
        if (current) {
          nextValid = current;
        } else if (nextValid) {
          loadedImages[i] = nextValid;
        }
      }

      for (let i = 0; i < numThumbs; i++) {
        const img = loadedImages[i];
        if (img) drawSlice(img, i);
      }

      canvas.classList.add('loaded');
    };

    framesB64.forEach((b64Data, i) => {
      const img = new Image();
      img.onload = (): void => {
        loadedImages[i] = img;
        finishOne();
      };
      img.onerror = finishOne;
      img.src = 'data:image/jpeg;base64,' + b64Data;
    });
  },

  /**
   * Set up video element event listeners for playback and scrubbing.
   */
  setupVideoListeners(content: Element): void {
    if (!this.videoEl) return;

    // Video timeupdate handler
    this.videoEl.addEventListener('timeupdate', () => {
      if (!this.videoEl) return;
      this.updatePlayhead();
      const currentTimeEl = content.querySelector('.edit-hero-current-time');
      if (currentTimeEl) currentTimeEl.textContent = this.formatTime(this.videoEl.currentTime);

      // Sprite loop: wrap back to start when reaching end of sprite range
      if (this._spriteLooping && this.videoEl.currentTime >= this.spriteStart + this.spriteDuration) {
        this.videoEl.currentTime = this.spriteStart;
      }
    });

    // Timeline click — click on sprite range to loop, outside to seek freely
    const track = content.querySelector('.edit-hero-timeline-track');
    if (track) {
      track.addEventListener('click', (e) => {
        if (this._isDraggingSprite || !this.videoEl) return;
        const rect = (track as HTMLElement).getBoundingClientRect();
        const pct = ((e as MouseEvent).clientX - rect.left) / rect.width;
        const time = pct * this.videoDuration;

        // Check if click landed inside the sprite range
        const spriteEnd = this.spriteStart + this.spriteDuration;
        if (time >= this.spriteStart && time <= spriteEnd) {
          // Activate sprite loop and play from clicked position within range
          this._spriteLooping = true;
          this.videoEl.currentTime = time;
          this.videoEl.play();
        } else {
          // Click outside sprite range: move sprite position, disable loop
          this._spriteLooping = false;
          this.spriteStart = Math.max(0, Math.min(time, this.videoDuration - this.spriteDuration));
          this.videoEl.currentTime = this.spriteStart;
          this.updateSpriteRange();
        }
        this.updateSpriteLoopUI();
      });
    }

    // Cache timeline elements for efficient updates during drag
    this._cachedTrack = content.querySelector('.edit-hero-timeline-track') as HTMLElement | null;
    this._cachedRange = content.querySelector('.edit-hero-sprite-range') as HTMLElement | null;
    this._cachedDimLeft = content.querySelector('.edit-hero-timeline-dim-left') as HTMLElement | null;
    this._cachedDimRight = content.querySelector('.edit-hero-timeline-dim-right') as HTMLElement | null;
    this._cachedInfo = content.querySelector('.edit-hero-sprite-info');

    // Sprite range drag (middle of range)
    const spriteRange = this._cachedRange;
    if (spriteRange) {
      const startDrag = (clientX: number, target: 'range' | 'start' | 'end'): void => {
        this._isDraggingSprite = true;
        this._dragTarget = target;
        spriteRange.classList.add('is-dragging');
        // Pause video during drag for cleaner scrubbing
        this._wasLoopingBeforeDrag = this._spriteLooping;
        if (this.videoEl && !this.videoEl.paused) {
          this.videoEl.pause();
        }
        if (target === 'range' && this._cachedTrack) {
          // Calculate offset from click position to sprite start for smooth dragging
          const rect = this._cachedTrack.getBoundingClientRect();
          const pct = (clientX - rect.left) / rect.width;
          const clickTime = pct * this.videoDuration;
          this._dragOffset = clickTime - this.spriteStart;
        }
      };

      // Middle drag (range)
      spriteRange.addEventListener('mousedown', (e) => {
        const target = e.target as HTMLElement;
        // Don't start range drag if clicking on a handle
        if (target.closest('.edit-hero-sprite-handle')) return;
        startDrag((e as MouseEvent).clientX, 'range');
        e.preventDefault();
        e.stopPropagation();
      });

      spriteRange.addEventListener('touchstart', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('.edit-hero-sprite-handle')) return;
        const touch = (e as TouchEvent).touches[0];
        if (!touch) return;
        startDrag(touch.clientX, 'range');
        e.preventDefault();
        e.stopPropagation();
      }, { passive: false });

      // Start handle
      const startHandle = spriteRange.querySelector('.edit-hero-sprite-handle--start');
      if (startHandle) {
        startHandle.addEventListener('mousedown', (e) => {
          startDrag((e as MouseEvent).clientX, 'start');
          e.preventDefault();
          e.stopPropagation();
        });
        startHandle.addEventListener('touchstart', (e) => {
          const touch = (e as TouchEvent).touches[0];
          if (!touch) return;
          startDrag(touch.clientX, 'start');
          e.preventDefault();
          e.stopPropagation();
        }, { passive: false });
      }

      // End handle
      const endHandle = spriteRange.querySelector('.edit-hero-sprite-handle--end');
      if (endHandle) {
        endHandle.addEventListener('mousedown', (e) => {
          startDrag((e as MouseEvent).clientX, 'end');
          e.preventDefault();
          e.stopPropagation();
        });
        endHandle.addEventListener('touchstart', (e) => {
          const touch = (e as TouchEvent).touches[0];
          if (!touch) return;
          startDrag(touch.clientX, 'end');
          e.preventDefault();
          e.stopPropagation();
        }, { passive: false });
      }

      // Double-click sprite range to toggle loop playback
      spriteRange.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._spriteLooping = !this._spriteLooping;
        if (this._spriteLooping && this.videoEl) {
          this.videoEl.currentTime = this.spriteStart;
          this.videoEl.play();
        }
        this.updateSpriteLoopUI();
      });
    }

    // Mouse move/up handlers
    this._mouseMoveHandler = (e: MouseEvent): void => {
      if (!this._isDraggingSprite) return;
      this.handleDrag(e.clientX);
    };
    document.addEventListener('mousemove', this._mouseMoveHandler);

    this._mouseUpHandler = (): void => {
      if (!this._isDraggingSprite) return;
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
      this._isDraggingSprite = false;
      this._dragTarget = null;
      this._cachedRange?.classList.remove('is-dragging');
      // Resume looping playback if it was active before drag
      if (this._wasLoopingBeforeDrag && this.videoEl) {
        this.videoEl.currentTime = this.spriteStart;
        this.videoEl.play();
      }
      this._wasLoopingBeforeDrag = false;
    };
    document.addEventListener('mouseup', this._mouseUpHandler);

    // Touch move/end handlers
    this._touchMoveHandler = (e: TouchEvent): void => {
      if (!this._isDraggingSprite) return;
      const touch = e.touches[0];
      if (!touch) return;
      this.handleDrag(touch.clientX);
    };
    document.addEventListener('touchmove', this._touchMoveHandler, { passive: true });

    this._touchEndHandler = (): void => {
      if (!this._isDraggingSprite) return;
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = null;
      }
      this._isDraggingSprite = false;
      this._dragTarget = null;
      this._cachedRange?.classList.remove('is-dragging');
      // Resume looping playback if it was active before drag
      if (this._wasLoopingBeforeDrag && this.videoEl) {
        this.videoEl.currentTime = this.spriteStart;
        this.videoEl.play();
      }
      this._wasLoopingBeforeDrag = false;
    };
    document.addEventListener('touchend', this._touchEndHandler);

    // Arrow key adjustment
    // Plain Arrow: move entire range
    // Shift+Arrow: resize (Shift+Right expands end, Shift+Left shrinks from end)
    this._keyHandler = (e: KeyboardEvent): void => {
      if (this.currentView !== 'video' || !this.modal || !this.videoEl) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (e.shiftKey) {
          // Shrink duration from end
          const newDuration = Math.max(MIN_SPRITE_DURATION, this.spriteDuration - 0.5);
          this.spriteDuration = newDuration;
        } else {
          // Move entire range left
          this.spriteStart = Math.max(0, this.spriteStart - 0.5);
        }
        this.videoEl.currentTime = this.spriteStart;
        this.updateSpriteRange();
      }

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (e.shiftKey) {
          // Expand duration from end
          const maxDuration = Math.min(MAX_SPRITE_DURATION, this.videoDuration - this.spriteStart);
          const newDuration = Math.min(maxDuration, this.spriteDuration + 0.5);
          this.spriteDuration = newDuration;
          this.videoEl.currentTime = this.spriteStart + this.spriteDuration;
        } else {
          // Move entire range right
          this.spriteStart = Math.min(this.videoDuration - this.spriteDuration, this.spriteStart + 0.5);
          this.videoEl.currentTime = this.spriteStart;
        }
        this.updateSpriteRange();
      }
    };
    document.addEventListener('keydown', this._keyHandler);
  },

  /**
   * Update the sprite loop UI indicator
   */
  updateSpriteLoopUI(): void {
    if (!this.modal) return;
    const info = this.modal.querySelector('.edit-hero-sprite-info');
    if (!info) return;
    if (this._spriteLooping) {
      info.classList.add('looping');
    } else {
      info.classList.remove('looping');
    }
  },

  /**
   * Restore the settings form view, cleaning up video state
   */
  showSettingsView(): void {
    this.cleanupVideoState();
    this.renderSettingsView();
  },

  /**
   * Clean up video-related state and listeners
   */
  cleanupVideoState(): void {
    if (this.videoEl && this.videoEl.hlsInstance) {
      this.videoEl.hlsInstance.destroy();
      this.videoEl.hlsInstance = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    if (this._mouseMoveHandler) {
      document.removeEventListener('mousemove', this._mouseMoveHandler);
      this._mouseMoveHandler = null;
    }
    if (this._mouseUpHandler) {
      document.removeEventListener('mouseup', this._mouseUpHandler);
      this._mouseUpHandler = null;
    }
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler);
      this._keyHandler = null;
    }
    if (this._touchMoveHandler) {
      document.removeEventListener('touchmove', this._touchMoveHandler);
      this._touchMoveHandler = null;
    }
    if (this._touchEndHandler) {
      document.removeEventListener('touchend', this._touchEndHandler);
      this._touchEndHandler = null;
    }
    if (this._beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this._beforeUnloadHandler);
      this._beforeUnloadHandler = null;
    }
    // Clean up HLS polling timer
    if (this._hlsPollTimer) {
      clearInterval(this._hlsPollTimer);
      this._hlsPollTimer = null;
    }
    // Clean up thumbnail polling timer
    if (this._thumbnailPollTimer) {
      clearTimeout(this._thumbnailPollTimer);
      this._thumbnailPollTimer = null;
    }
    if (this.activeXhr) {
      this.activeXhr.abort();
      this.activeXhr = null;
    }
    this.videoEl = null;
    this.videoFile = null;
    this.videoFlowMode = 'upload';
    this._tempId = null;
    this._isDraggingSprite = false;
    this._spriteLooping = false;
    // Clean up HLS state
    this._hlsSessionId = null;
    this._hlsComplete = false;
    this._hlsPreviewUrl = null;
    this._blobPreviewFailed = false;
    this._previewCodecErrorShown = false;
    this._hlsPreviewErrorShown = false;
    this._renderedThumbCount = 0;
    this._dragTarget = null;
    this._dragOffset = 0;
    // Clean up RAF and cached elements
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._cachedTrack = null;
    this._cachedRange = null;
    this._cachedDimLeft = null;
    this._cachedDimRight = null;
    this._cachedInfo = null;
  },

  /**
   * Handle drag interaction for sprite range and handles
   */
  handleDrag(clientX: number): void {
    if (!this._dragTarget || !this._cachedTrack || !this.videoEl) return;

    const rect = this._cachedTrack.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const time = pct * this.videoDuration;
    const spriteEnd = this.spriteStart + this.spriteDuration;

    if (this._dragTarget === 'start') {
      // Dragging start handle: adjust spriteStart, recalculate duration
      // When at max duration, "push" the entire range left with the cursor
      let newStart = Math.max(0, Math.min(time, spriteEnd - MIN_SPRITE_DURATION));
      let newEnd = spriteEnd;
      let newDuration = newEnd - newStart;

      // If trying to expand beyond max, push the end along
      if (newDuration > MAX_SPRITE_DURATION) {
        newDuration = MAX_SPRITE_DURATION;
        newEnd = newStart + MAX_SPRITE_DURATION;
        // But don't push past video end
        if (newEnd > this.videoDuration) {
          newEnd = this.videoDuration;
          newStart = newEnd - MAX_SPRITE_DURATION;
        }
      }

      this.spriteStart = newStart;
      this.spriteDuration = newDuration;
      this.videoEl.currentTime = this.spriteStart;
    } else if (this._dragTarget === 'end') {
      // Dragging end handle: adjust duration
      // When at max duration, "push" the entire range right with the cursor
      let newEnd = Math.max(this.spriteStart + MIN_SPRITE_DURATION, Math.min(time, this.videoDuration));
      let newStart = this.spriteStart;
      let newDuration = newEnd - newStart;

      // If trying to expand beyond max, push the start along
      if (newDuration > MAX_SPRITE_DURATION) {
        newDuration = MAX_SPRITE_DURATION;
        newStart = newEnd - MAX_SPRITE_DURATION;
        // But don't push past video start
        if (newStart < 0) {
          newStart = 0;
          newEnd = MAX_SPRITE_DURATION;
        }
      }

      this.spriteStart = newStart;
      this.spriteDuration = newDuration;
      this.videoEl.currentTime = newEnd;
    } else if (this._dragTarget === 'range') {
      // Dragging entire range: preserve duration, use offset for smooth drag
      let newStart = time - this._dragOffset;
      newStart = Math.max(0, Math.min(newStart, this.videoDuration - this.spriteDuration));
      this.spriteStart = newStart;
      this.videoEl.currentTime = this.spriteStart;
    }

    this.updateSpriteRange();
  },

  /**
   * Update the sprite range indicator and dim overlays on the timeline
   */
  updateSpriteRange(): void {
    if (!this.videoDuration) return;

    // Use cached elements during drag, fallback to querySelector for other calls
    const range = this._cachedRange || this.modal?.querySelector('.edit-hero-sprite-range') as HTMLElement | null;
    const info = this._cachedInfo || this.modal?.querySelector('.edit-hero-sprite-info');
    const dimLeft = this._cachedDimLeft || this.modal?.querySelector('.edit-hero-timeline-dim-left') as HTMLElement | null;
    const dimRight = this._cachedDimRight || this.modal?.querySelector('.edit-hero-timeline-dim-right') as HTMLElement | null;
    if (!range) return;

    const startPct = (this.spriteStart / this.videoDuration) * 100;
    const widthPct = (this.spriteDuration / this.videoDuration) * 100;
    range.style.left = `${startPct}%`;
    range.style.width = `${widthPct}%`;

    // Position dim overlays
    if (dimLeft) {
      dimLeft.style.width = `${startPct}%`;
    }
    if (dimRight) {
      dimRight.style.left = `${startPct + widthPct}%`;
      dimRight.style.width = `${100 - startPct - widthPct}%`;
    }

    if (info) {
      const end = this.spriteStart + this.spriteDuration;
      info.textContent = `Sprite: ${this.formatTime(this.spriteStart)} - ${this.formatTime(end)} (${this.spriteDuration.toFixed(1)}s)`;
    }
  },

  /**
   * Update the playhead position on the timeline
   */
  updatePlayhead(): void {
    if (!this.modal || !this.videoEl || !this.videoDuration) return;
    const playhead = this.modal.querySelector('.edit-hero-playhead') as HTMLElement | null;
    if (!playhead) return;
    const pct = (this.videoEl.currentTime / this.videoDuration) * 100;
    playhead.style.left = `${pct}%`;
  },

  /**
   * Generate sprite sheet after user confirms sprite selection.
   * HLS encoding should already be complete or in progress from thumbnail extraction.
   */
  async processVideo(): Promise<void> {
    if (!this.modal) return;

    const processBtn = this.modal.querySelector('#hero-video-process') as HTMLButtonElement | null;
    const progressDiv = this.modal.querySelector('.edit-hero-progress') as HTMLElement | null;
    const progressFill = this.modal.querySelector('.edit-hero-progress-fill') as HTMLElement | null;
    const progressText = this.modal.querySelector('.edit-hero-progress-text') as HTMLElement | null;

    if (!processBtn || !progressDiv || !progressFill || !progressText) return;

    processBtn.disabled = true;
    processBtn.textContent = 'Processing...';
    progressDiv.style.display = 'block';

    // Stop thumbnail polling once processing begins to avoid stale temp_id fetches.
    if (this._thumbnailPollTimer) {
      clearTimeout(this._thumbnailPollTimer);
      this._thumbnailPollTimer = null;
    }

    // Stop the regular HLS polling - we'll start processing-specific polling
    if (this._hlsPollTimer) {
      clearInterval(this._hlsPollTimer);
      this._hlsPollTimer = null;
    }

    // Set initial progress based on HLS state
    // Progress ranges: 20-80% for HLS encoding, 80-95% for sprite generation, 95-100% for saving
    if (this._hlsSessionId && !this._hlsComplete) {
      progressFill.style.width = '20%';
      progressText.textContent = 'Encoding video...';
    } else {
      progressFill.style.width = '80%';
      progressText.textContent = 'Generating sprite sheet & thumbnail...';
    }

    // Start processing-mode HLS polling if HLS not yet complete
    // This continues updating progress while the sprite generation request is in flight
    let processingPollTimer: ReturnType<typeof setInterval> | null = null;
    if (this._hlsSessionId && !this._hlsComplete) {
      processingPollTimer = setInterval(async () => {
        try {
          const res = await fetch(`/api/hls-progress/${this._hlsSessionId}`);
          if (!res.ok) return;

          const data = await res.json();

          if (data.status === 'complete') {
            if (processingPollTimer) {
              clearInterval(processingPollTimer);
              processingPollTimer = null;
            }
            this._hlsComplete = true;
            if (data.hls_url) {
              await this.switchPreviewToHls(data.hls_url);
            }
            // HLS done - now show sprite generation progress
            progressFill.style.width = '80%';
            progressText.textContent = 'Generating sprite sheet & thumbnail...';
          } else if (data.status === 'error') {
            if (processingPollTimer) {
              clearInterval(processingPollTimer);
              processingPollTimer = null;
            }
            // Error will be handled by the server response
          } else {
            // Map HLS progress (0-100) to bar progress (20-80)
            const hlsProgress = data.progress || 0;
            const barProgress = 20 + hlsProgress * 0.6;
            progressFill.style.width = `${barProgress}%`;
            // Show stage info from server, or fallback message
            const stageText = data.stage || `Encoding video... ${Math.round(hlsProgress)}%`;
            progressText.textContent = stageText;
          }
        } catch {
          // Polling error, keep trying
        }
      }, 1000);
    }

    // beforeunload warning
    this._beforeUnloadHandler = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', this._beforeUnloadHandler);

    try {
      const processingTempId = this._tempId;
      // Detach state so any deferred poll callback exits before issuing requests.
      this._tempId = null;

      const formData = new FormData();
      if (processingTempId) formData.append('temp_id', processingTempId);
      if (this.projectSlug) formData.append('project_slug', this.projectSlug);
      formData.append('sprite_start', String(this.spriteStart));
      formData.append('sprite_duration', String(this.spriteDuration));

      // Pass HLS session ID so server can wait for it if needed
      if (this._hlsSessionId) {
        formData.append('hls_session_id', this._hlsSessionId);
      }

      const response = await fetch('/api/generate-sprite-sheet', {
        method: 'POST',
        body: formData,
      });

      // Stop processing poll once we have a response
      if (processingPollTimer) {
        clearInterval(processingPollTimer);
        processingPollTimer = null;
      }

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Sprite sheet generation failed');
      }

      const result = await response.json();

      if (result.success && result.video) {
        progressFill.style.width = '95%';
        progressText.textContent = 'Saving...';

        // Update project data with new video info
        if (this.projectData) {
          this.projectData.video = result.video;
        }
        await this.saveVideoData(result.video);

        progressFill.style.width = '100%';
        progressText.textContent = 'Complete!';

        const successMessage = this.videoFlowMode === 'existing'
          ? 'Hero sprite updated successfully!'
          : 'Video processed successfully!';
        showNotification(successMessage, 'success');

        // Return to settings view after a brief pause
        setTimeout(() => this.showSettingsView(), 800);
      } else {
        throw new Error(result.detail || 'Processing failed');
      }
    } catch (e) {
      // Ensure poll is stopped on error
      if (processingPollTimer) {
        clearInterval(processingPollTimer);
      }
      this.handleProcessingError((e as Error).message, processBtn, progressDiv);
    } finally {
      if (this._beforeUnloadHandler) {
        window.removeEventListener('beforeunload', this._beforeUnloadHandler);
        this._beforeUnloadHandler = null;
      }
    }
  },

  /**
   * Handle a processing error
   */
  handleProcessingError(message: string, processBtn: HTMLButtonElement | null, progressDiv: HTMLElement | null): void {
    if (this._beforeUnloadHandler) {
      window.removeEventListener('beforeunload', this._beforeUnloadHandler);
      this._beforeUnloadHandler = null;
    }
    showNotification(`Video processing failed: ${message}`, 'error');
    if (processBtn) {
      processBtn.disabled = false;
      processBtn.textContent = this.getProcessButtonText();
    }
    if (progressDiv) {
      progressDiv.style.display = 'none';
    }
  },

  /**
   * Cancel upload or return to settings from video view
   */
  cancelUpload(): void {
    if (this.activeXhr) {
      this.activeXhr.abort();
      this.activeXhr = null;
    }
    this.showSettingsView();
  },

  /**
   * Format time as M:SS
   */
  formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  },

  /**
   * Escape HTML attribute value
   */
  escAttr(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  /**
   * Escape HTML text content
   */
  escHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  /**
   * Save settings
   */
  async saveSettings(): Promise<void> {
    if (!this.modal) return;

    const form = this.modal.querySelector('#settings-form') as HTMLFormElement | null;
    if (!form) return;

    const formData = new FormData(form);

    const data = {
      name: formData.get('name'),
      slug: formData.get('slug'),
      original_slug: this.projectSlug,
      date: formData.get('date'),
      youtube: formData.get('youtube') || null,
      draft: formData.get('draft') === 'on',
      pinned: formData.get('pinned') === 'on',
      video: this.projectData?.video,
      markdown: this.projectData?.markdown,
      base_revision: this.projectData?.revision,
    };

    try {
      const result = await fetchJSON<{ revision?: string }>('/api/save-project', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      if (result.revision && this.projectData) {
        this.projectData.revision = result.revision;
      }

      showNotification('Settings saved!', 'success');

      // If slug changed, redirect
      if (data.slug !== this.projectSlug) {
        window.location.href = withShowDrafts(`/${data.slug}`);
      } else {
        this.hide();
        window.location.reload();
      }
    } catch (error) {
      console.error('Save settings error:', error);
      showNotification('Failed to save settings', 'error');
    }
  },

  /**
   * Save video data only
   */
  async saveVideoData(videoData: VideoData): Promise<void> {
    if (!this.projectData) return;

    const data = {
      ...this.projectData,
      original_slug: this.projectSlug,
      video: videoData,
      base_revision: this.projectData.revision,
    };

    const result = await fetchJSON<{ revision?: string }>('/api/save-project', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    // Update revision for subsequent saves
    if (result.revision) {
      this.projectData.revision = result.revision;
    }
  },

  /**
   * Delete project
   */
  async deleteProject(): Promise<void> {
    if (!this.projectSlug) return;

    try {
      await fetchJSON(`/api/project/${this.projectSlug}`, {
        method: 'DELETE',
      });

      showNotification('Project deleted', 'success');
      this.hide();
      window.location.href = withShowDrafts('/');
    } catch (error) {
      console.error('Delete project error:', error);
      showNotification('Failed to delete project', 'error');
    }
  },

  /**
   * Hide modal
   */
  hide(): void {
    this.cleanupVideoState();
    if (this.escHandler) {
      document.removeEventListener('keydown', this.escHandler, true);
      this.escHandler = null;
    }
    if (this.modal) {
      this.modal.remove();
      this.modal = null;
    }
    unlockBodyScroll();
  },
};

export default ProjectSettings;

import type { ProjectData } from '../types/api';
import { openHeroVideoEditor } from './hero-video/editor';
import { capturePosterFromVideo, uploadProcessedImage } from './media-upload';
import { showNotification } from './notify';
import { SLUG_INPUT_PATTERN } from './slug';
import type { BlockStore } from './store';
import { escapeHtml } from './text';

interface ProjectControlsDeps {
  project: ProjectData;
  /** The project's slug as the server knows it, which the slug field may have moved ahead of. */
  savedSlug(): string;
  store: BlockStore;
  markDirty(): void;
  setToolbarTitle(title: string): void;
}

export function makeHeaderEditable(scene: HTMLElement, { project, markDirty, setToolbarTitle }: ProjectControlsDeps): void {
  const header = scene.querySelector<HTMLElement>('.homepage-detail-header');
  const nameEl = scene.querySelector<HTMLElement>('.homepage-detail-title');
  const dateEl = scene.querySelector<HTMLElement>('.homepage-detail-date');
  if (!header || !nameEl || !dateEl) return;

  header.classList.add('edit-project-header-active');
  dateEl.innerHTML = `
    <input type="date" class="edit-project-header-date-input" value="${escapeHtml(project.date || '')}" aria-label="Project date">
  `;
  nameEl.innerHTML = `
    <input type="text" class="edit-project-header-name-input" value="${escapeHtml(project.name || '')}" aria-label="Project name" required>
  `;

  const dateInput = dateEl.querySelector<HTMLInputElement>('input');
  const nameInput = nameEl.querySelector<HTMLInputElement>('input');
  if (!dateInput || !nameInput) return;

  // The header belongs to the homepage scene, whose handlers must not see these.
  [dateInput, nameInput].forEach((input) => {
    for (const type of ['click', 'mousedown', 'pointerdown', 'keydown']) {
      input.addEventListener(type, (event) => event.stopPropagation());
    }
  });

  dateInput.addEventListener('input', () => {
    project.date = dateInput.value;
    markDirty();
  });
  nameInput.addEventListener('input', () => {
    project.name = nameInput.value;
    setToolbarTitle(project.name.trim() || 'Project');
    markDirty();
  });
}

function createMetadataControls({ project, markDirty }: ProjectControlsDeps): HTMLElement {
  const controls = document.createElement('section');
  controls.className = 'edit-inline-project-settings';
  controls.innerHTML = `
    <div class="edit-inline-project-settings-grid">
      <div class="edit-form-group">
        <label for="inline-settings-slug">URL Slug</label>
        <input type="text" id="inline-settings-slug" value="${escapeHtml(project.slug || '')}" pattern="${SLUG_INPUT_PATTERN}" required>
      </div>
      <div class="edit-form-group">
        <label for="inline-settings-youtube">YouTube Link</label>
        <input type="url" id="inline-settings-youtube" value="${escapeHtml(project.youtube || '')}" placeholder="https://youtube.com/watch?v=...">
      </div>
      <fieldset class="edit-inline-project-settings-status">
        <legend>Status</legend>
        <div class="edit-inline-project-settings-flags">
          <label class="edit-form-checkbox">
            <input type="checkbox" id="inline-settings-draft" ${project.draft ? 'checked' : ''}>
            <span>Draft</span>
          </label>
          <label class="edit-form-checkbox">
            <input type="checkbox" id="inline-settings-pinned" ${project.pinned ? 'checked' : ''}>
            <span>Pinned</span>
          </label>
        </div>
      </fieldset>
    </div>
  `;

  const field = (id: string): HTMLInputElement => controls.querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement;
  const slugInput = field('inline-settings-slug');
  const youtubeInput = field('inline-settings-youtube');
  const draftInput = field('inline-settings-draft');
  const pinnedInput = field('inline-settings-pinned');

  slugInput.addEventListener('input', () => {
    project.slug = slugInput.value;
    markDirty();
  });
  youtubeInput.addEventListener('input', () => {
    project.youtube = youtubeInput.value.trim();
    markDirty();
  });
  draftInput.addEventListener('change', () => {
    project.draft = draftInput.checked;
    markDirty();
  });
  pinnedInput.addEventListener('change', () => {
    project.pinned = pinnedInput.checked;
    markDirty();
  });

  return controls;
}

function createHeroControls(scene: HTMLElement, deps: ProjectControlsDeps): HTMLElement {
  const { project, savedSlug, store, markDirty } = deps;
  const controls = document.createElement('div');
  controls.className = 'edit-hero-thumbnail-controls';
  controls.innerHTML = `
    <div class="edit-hero-media-grid">
      <div class="edit-hero-video-panel">
        <div class="edit-hero-video-header">
          <span class="edit-hero-panel-label">Hero Video</span>
          <span class="edit-hero-video-status"></span>
        </div>
        <div class="edit-hero-video-buttons">
          <button type="button" class="edit-btn-small" data-action="update-sprite">Update Sprite</button>
          <button type="button" class="edit-btn-small" data-action="replace-video">Replace</button>
        </div>
        <input type="file" class="edit-hero-video-file" accept="video/*" style="display: none;">
      </div>
      <div class="edit-hero-thumbnail-panel">
        <div class="edit-hero-thumbnail-header">
          <span class="edit-hero-panel-label">OG Image (Social Share)</span>
        </div>
        <div class="edit-hero-thumbnail-content">
          <img class="edit-hero-thumbnail-preview" alt="OG image preview" style="display:none">
          <div class="edit-hero-thumbnail-actions">
            <input type="url" class="edit-hero-thumbnail-input" placeholder="Optional OG override URL...">
            <p class="edit-hero-thumbnail-note">
              Leave blank to use hero poster first, then sprite sheet as fallback.
            </p>
            <div class="edit-hero-thumbnail-buttons">
              <button type="button" class="edit-btn-small" data-action="upload">Upload Override</button>
              <button type="button" class="edit-btn-small" data-action="capture">Capture Frame</button>
              <button type="button" class="edit-btn-small" data-action="clear">Clear Override</button>
            </div>
            <input type="file" class="edit-hero-thumbnail-file" accept="image/*" style="display: none;">
          </div>
        </div>
      </div>
    </div>
  `;

  const find = <T extends Element>(selector: string): T => controls.querySelector<T>(selector) as T;
  const statusEl = find<HTMLElement>('.edit-hero-video-status');
  const updateSpriteButton = find<HTMLButtonElement>('[data-action="update-sprite"]');
  const replaceButton = find<HTMLButtonElement>('[data-action="replace-video"]');
  const videoFileInput = find<HTMLInputElement>('.edit-hero-video-file');
  const ogInput = find<HTMLInputElement>('.edit-hero-thumbnail-input');
  const preview = find<HTMLImageElement>('.edit-hero-thumbnail-preview');
  const uploadButton = find<HTMLButtonElement>('[data-action="upload"]');
  const captureButton = find<HTMLButtonElement>('[data-action="capture"]');
  const clearButton = find<HTMLButtonElement>('[data-action="clear"]');
  const imageFileInput = find<HTMLInputElement>('.edit-hero-thumbnail-file');

  const refresh = (): void => {
    const hls = project.video?.hls?.trim() || '';
    statusEl.textContent = hls ? `Current: ${hls.split('/').pop()}` : 'No hero video yet';
    updateSpriteButton.disabled = !hls;
    replaceButton.textContent = hls ? 'Replace' : 'Upload Hero Video';
    captureButton.disabled = !hls;

    const ogOverride = project.og_image?.trim() || '';
    const previewUrl = ogOverride || project.video?.thumbnail?.trim() || project.video?.spriteSheet?.trim() || '';
    ogInput.value = ogOverride;
    if (previewUrl) preview.src = previewUrl;
    preview.style.display = previewUrl ? '' : 'none';
    clearButton.style.display = ogOverride ? '' : 'none';
  };
  refresh();

  const setOgOverride = (url: string | null): void => {
    const next = url || undefined;
    if (project.og_image !== next) store.addCleanupCandidate(project.og_image);
    project.og_image = next;
    markDirty();
    refresh();
  };

  const openVideoEditor = (file: File | null): void => {
    openHeroVideoEditor({
      slug: savedSlug(),
      file,
      onVideoSaved(video) {
        project.video = { ...video };
        refresh();
        markDirty();
      },
    });
  };

  updateSpriteButton.addEventListener('click', () => {
    if (!project.video?.hls) {
      showNotification('No existing hero video found for this project.', 'error');
      return;
    }
    openVideoEditor(null);
  });

  replaceButton.addEventListener('click', () => videoFileInput.click());
  videoFileInput.addEventListener('change', () => {
    const file = videoFileInput.files?.[0];
    videoFileInput.value = '';
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      showNotification('Please select a video file', 'error');
      return;
    }
    openVideoEditor(file);
  });

  ogInput.addEventListener('change', () => setOgOverride(ogInput.value.trim() || null));

  uploadButton.addEventListener('click', () => imageFileInput.click());
  imageFileInput.addEventListener('change', async () => {
    const file = imageFileInput.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showNotification('Please select an image file', 'error');
      return;
    }

    uploadButton.disabled = true;
    uploadButton.textContent = 'Uploading...';
    showNotification('Uploading OG image override...', 'info');
    try {
      setOgOverride(await uploadProcessedImage(file));
      showNotification('OG image override uploaded!', 'success');
    } catch (error) {
      showNotification(`Upload failed: ${(error as Error).message}`, 'error');
    } finally {
      uploadButton.disabled = false;
      uploadButton.textContent = 'Upload Override';
      imageFileInput.value = '';
    }
  });

  captureButton.addEventListener('click', async () => {
    const video = scene.querySelector<HTMLVideoElement>('.video-container video');
    if (!video) {
      showNotification('No video element found', 'error');
      return;
    }
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      showNotification('Video not ready yet. Please wait for it to load.', 'info');
      return;
    }

    captureButton.disabled = true;
    captureButton.textContent = 'Capturing...';
    try {
      setOgOverride(await capturePosterFromVideo(video));
      showNotification('OG image override captured!', 'success');
    } catch (error) {
      showNotification(`Capture failed: ${(error as Error).message}`, 'error');
    } finally {
      captureButton.textContent = 'Capture Frame';
      refresh();
    }
  });

  clearButton.addEventListener('click', () => {
    setOgOverride(null);
    showNotification('OG image override cleared', 'info');
  });

  return controls;
}

export function createProjectTopControls(scene: HTMLElement, deps: ProjectControlsDeps): HTMLElement {
  const wrapper = document.createElement('section');
  wrapper.className = 'edit-inline-top-controls';
  wrapper.innerHTML = `
    <div class="edit-inline-top-controls-header">
      <h3>Project Controls</h3>
    </div>
  `;
  wrapper.append(createMetadataControls(deps), createHeroControls(scene, deps));
  return wrapper;
}

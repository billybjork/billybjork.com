import { applyAlignment } from '../../core/alignment';
import type { BlockContext, HtmlBlock, ImageBlock, VideoBlock } from '../../types/blocks';
import type { EditorContext } from '../context';
import { ICONS } from '../icons';
import { capturePosterFromVideo, uploadProcessedImage, type VideoUploadProgressUpdate } from '../media-upload';
import { showNotification } from '../notify';
import { clamp } from '../clamp';

function applyMediaStyle(element: HTMLElement, block: ImageBlock | VideoBlock): void {
  if (block.style) element.setAttribute('style', block.style);
  if (block.align) {
    element.style.display = 'block';
    applyAlignment(element, block.align);
  }
}

function selectOnClick(ctx: EditorContext, element: HTMLElement, block: ImageBlock | VideoBlock | HtmlBlock): void {
  element.addEventListener('click', (event) => {
    event.stopPropagation();
    ctx.media.select(element, block);
  });
}

/** In the editor a video never autoplays, even one that will on the published page. */
function applyVideoPlaybackSettings(video: HTMLVideoElement, autoplay: boolean): void {
  video.loop = autoplay;
  video.muted = autoplay;
  video.defaultMuted = autoplay;
  video.playsInline = true;
  video.controls = true;
  video.autoplay = false;
  video.removeAttribute('autoplay');
  video.setAttribute('playsinline', '');
  video.toggleAttribute('muted', autoplay);
  video.pause();
}

export function createMediaCaptionInput(ctx: EditorContext, caption: string | undefined, context: BlockContext): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'media-caption-input';
  input.placeholder = 'Caption (optional)...';
  input.value = caption || '';
  input.addEventListener('input', () => {
    ctx.store.updateFields(context, { caption: input.value }, { render: false });
  });
  return input;
}

function applyVideoPoster(video: HTMLVideoElement, poster: string | null | undefined): void {
  const cleanPoster = (poster ?? '').trim();
  if (!cleanPoster) {
    video.poster = '';
    video.removeAttribute('poster');
    return;
  }

  video.poster = cleanPoster;
  video.setAttribute('poster', cleanPoster);
}

export function renderImageBlock(ctx: EditorContext, block: ImageBlock, context: BlockContext): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'image-block-wrapper';

  if (block.src) {
    const img = document.createElement('img');
    img.src = block.src;
    img.alt = block.alt || '';
    img.className = 'block-image';
    applyMediaStyle(img, block);
    selectOnClick(ctx, img, block);
    wrapper.appendChild(img);

    const altInput = document.createElement('input');
    altInput.type = 'text';
    altInput.className = 'image-alt-input';
    altInput.placeholder = 'Image description...';
    altInput.value = block.alt || '';
    altInput.addEventListener('input', () => {
      ctx.store.updateFields(context, { alt: altInput.value }, { render: false });
    });
    wrapper.appendChild(altInput);
    wrapper.appendChild(createMediaCaptionInput(ctx, block.caption, context));
  } else {
    wrapper.appendChild(createUploadZone(ctx, context, 'image'));
  }

  return wrapper;
}

export function renderVideoBlock(ctx: EditorContext, block: VideoBlock, context: BlockContext): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'video-block-wrapper';

  if (block.src) {
    const video = document.createElement('video');
    video.src = block.src;
    video.className = 'block-video';
    applyVideoPlaybackSettings(video, !!block.autoplay);
    applyMediaStyle(video, block);
    selectOnClick(ctx, video, block);
    wrapper.appendChild(video);

    const posterControls = document.createElement('div');
    posterControls.className = 'video-poster-controls';

    const optionsRow = document.createElement('label');
    optionsRow.className = 'video-option-row';

    const autoplayToggle = document.createElement('input');
    autoplayToggle.type = 'checkbox';
    autoplayToggle.className = 'video-option-checkbox';
    autoplayToggle.checked = !!block.autoplay;
    optionsRow.appendChild(autoplayToggle);

    const autoplayLabel = document.createElement('span');
    autoplayLabel.className = 'video-option-label';
    autoplayLabel.textContent = 'Autoplay (muted loop)';
    optionsRow.appendChild(autoplayLabel);

    const posterInput = document.createElement('input');
    posterInput.type = 'url';
    posterInput.className = 'video-poster-input';
    posterInput.placeholder = 'Poster image URL (optional)...';
    posterInput.value = block.poster || '';

    const actionsRow = document.createElement('div');
    actionsRow.className = 'video-poster-actions';

    const uploadPosterBtn = document.createElement('button');
    uploadPosterBtn.type = 'button';
    uploadPosterBtn.className = 'edit-btn-small video-poster-action';
    uploadPosterBtn.textContent = 'Upload poster';
    actionsRow.appendChild(uploadPosterBtn);

    const captureFrameBtn = document.createElement('button');
    captureFrameBtn.type = 'button';
    captureFrameBtn.className = 'edit-btn-small video-poster-action';
    captureFrameBtn.textContent = 'Use current frame';
    actionsRow.appendChild(captureFrameBtn);

    const clearPosterBtn = document.createElement('button');
    clearPosterBtn.type = 'button';
    clearPosterBtn.className = 'edit-btn-small video-poster-action';
    clearPosterBtn.textContent = 'Clear';
    actionsRow.appendChild(clearPosterBtn);

    const posterUploadInput = document.createElement('input');
    posterUploadInput.type = 'file';
    posterUploadInput.accept = 'image/*';
    posterUploadInput.className = 'video-poster-upload-input';
    posterUploadInput.hidden = true;

    let isPosterActionInFlight = false;
    let currentPoster = (block.poster || '').trim();

    const syncPosterControlState = (): void => {
      const hidePosterFields = autoplayToggle.checked;
      posterControls.classList.toggle('poster-fields-hidden', hidePosterFields);
      posterInput.disabled = hidePosterFields || isPosterActionInFlight;
      uploadPosterBtn.disabled = hidePosterFields || isPosterActionInFlight;
      captureFrameBtn.disabled = hidePosterFields || isPosterActionInFlight;
      clearPosterBtn.disabled = hidePosterFields || isPosterActionInFlight;
    };

    autoplayToggle.addEventListener('change', () => {
      const autoplay = autoplayToggle.checked;
      applyVideoPlaybackSettings(video, autoplay);
      ctx.store.updateFields(context, { autoplay }, { render: false });
      syncPosterControlState();
    });

    const syncPosterToBlock = (poster: string): void => {
      const cleanPoster = poster.trim();
      if (currentPoster !== cleanPoster) ctx.store.addCleanupCandidate(currentPoster);
      currentPoster = cleanPoster;
      applyVideoPoster(video, cleanPoster);
      ctx.store.updateFields(context, { poster: cleanPoster }, { render: false });
      clearPosterBtn.hidden = cleanPoster.length === 0;
      if (posterInput.value !== cleanPoster) {
        posterInput.value = cleanPoster;
      }
    };

    const setPosterActionState = (inFlight: boolean): void => {
      isPosterActionInFlight = inFlight;
      syncPosterControlState();
    };

    posterInput.addEventListener('input', () => {
      syncPosterToBlock(posterInput.value);
    });

    uploadPosterBtn.addEventListener('click', () => {
      if (isPosterActionInFlight) return;
      posterUploadInput.click();
    });

    posterUploadInput.addEventListener('change', async () => {
      const file = posterUploadInput.files?.[0];
      posterUploadInput.value = '';
      if (!file || isPosterActionInFlight) return;

      setPosterActionState(true);
      try {
        const posterUrl = await uploadProcessedImage(file);
        syncPosterToBlock(posterUrl);
        showNotification('Poster uploaded!', 'success');
      } catch (error) {
        showNotification(error instanceof Error ? error.message : 'Poster upload failed', 'error');
      } finally {
        setPosterActionState(false);
      }
    });

    captureFrameBtn.addEventListener('click', async () => {
      if (isPosterActionInFlight) return;

      setPosterActionState(true);
      try {
        const posterUrl = await capturePosterFromVideo(video);
        syncPosterToBlock(posterUrl);
        showNotification('Poster captured from frame!', 'success');
      } catch (error) {
        showNotification(error instanceof Error ? error.message : 'Frame capture failed', 'error');
      } finally {
        setPosterActionState(false);
      }
    });

    clearPosterBtn.addEventListener('click', () => {
      if (isPosterActionInFlight) return;
      syncPosterToBlock('');
    });

    applyVideoPoster(video, currentPoster);
    clearPosterBtn.hidden = currentPoster.length === 0;
    posterInput.value = currentPoster;
    syncPosterControlState();
    posterControls.appendChild(optionsRow);
    posterControls.appendChild(posterInput);
    posterControls.appendChild(actionsRow);
    posterControls.appendChild(posterUploadInput);
    wrapper.appendChild(posterControls);
    wrapper.appendChild(createMediaCaptionInput(ctx, block.caption, context));
  } else {
    wrapper.appendChild(createUploadZone(ctx, context, 'video'));
  }

  return wrapper;
}

function createUploadZone(ctx: EditorContext, context: BlockContext, type: 'image' | 'video'): HTMLElement {
  const zone = document.createElement('div');
  zone.className = 'upload-zone';
  const isVideo = type === 'video';
  zone.innerHTML = `
    <div class="upload-icon">${isVideo ? ICONS.video : ICONS.image}</div>
    <div class="upload-text">Drop ${type} here or click to upload</div>
    ${isVideo
    ? `<div class="upload-zone-progress" hidden>
        <div class="upload-zone-progress-bar">
          <div class="upload-zone-progress-fill"></div>
        </div>
        <div class="upload-zone-progress-text" aria-live="polite"></div>
      </div>`
    : ''}
    <input type="file" class="upload-input" accept="${isVideo ? 'video/*' : 'image/*'}">
  `;

  const progressWrap = zone.querySelector<HTMLElement>('.upload-zone-progress');
  const progressFill = zone.querySelector<HTMLElement>('.upload-zone-progress-fill');
  const progressText = zone.querySelector<HTMLElement>('.upload-zone-progress-text');
  let uploadInFlight = false;

  const updateVideoProgress = (update: VideoUploadProgressUpdate): void => {
    if (!progressWrap || !progressFill || !progressText) return;

    progressWrap.hidden = false;
    progressFill.style.width = `${clamp(update.progress, 0, 100)}%`;
    progressFill.classList.toggle('is-indeterminate', update.stage === 'processing');
    progressText.textContent = update.message;

    zone.classList.toggle('uploading', update.stage !== 'error' && update.stage !== 'complete');
    zone.classList.toggle('upload-error', update.stage === 'error');
  };

  const handleFile = async (file: File): Promise<void> => {
    if (uploadInFlight) return;
    uploadInFlight = true;
    zone.classList.remove('upload-error');

    try {
      if (type === 'image') {
        await ctx.media.uploadImageInto(file, context);
      } else {
        updateVideoProgress({
          stage: 'uploading',
          progress: 0,
          message: 'Starting upload...',
        });
        await ctx.media.uploadVideoInto(file, context, updateVideoProgress);
      }
    } finally {
      uploadInFlight = false;
      input.value = '';
    }
  };

  const input = zone.querySelector<HTMLInputElement>('.upload-input')!;
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (file) {
      await handleFile(file);
    }
  });

  zone.addEventListener('click', (e) => {
    if (uploadInFlight) return;
    if (e.target !== input) input.click();
  });

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (uploadInFlight) return;
    zone.classList.add('drag-over');
  });

  zone.addEventListener('dragleave', () => {
    zone.classList.remove('drag-over');
  });

  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (uploadInFlight) return;
    zone.classList.remove('drag-over');
    const file = e.dataTransfer?.files[0];
    if (file) {
      await handleFile(file);
    }
  });

  return zone;
}

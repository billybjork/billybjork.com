import { describe, expect, it } from 'vitest';

import {
  closeActiveLightbox,
  initializeLightboxMedia,
  openImageLightbox,
  openVideoLightbox,
} from '../../static/ts/project/lightbox';

describe('project lightbox behavior', () => {
  it('marks only eligible inline videos as lightbox triggers', () => {
    document.body.innerHTML = `
      <div class="project-content">
        <video id="eligible" loop></video>
        <video id="native-controls" controls loop></video>
        <div class="video-container">
          <video id="hero-video" loop></video>
        </div>
      </div>
    `;

    initializeLightboxMedia();

    expect(document.getElementById('eligible')?.classList.contains('lightbox-trigger-video')).toBe(true);
    expect(document.getElementById('native-controls')?.classList.contains('lightbox-trigger-video')).toBe(false);
    expect(document.getElementById('hero-video')?.classList.contains('lightbox-trigger-video')).toBe(false);
  });

  it('opens and closes an image lightbox while locking body scroll', () => {
    document.body.innerHTML = `
      <div class="project-content">
        <img id="gallery-image" src="http://localhost/image.webp" alt="Gallery image">
      </div>
    `;

    const image = document.getElementById('gallery-image');
    if (!(image instanceof HTMLImageElement)) {
      throw new Error('Failed to create image fixture');
    }

    openImageLightbox(image);

    const overlay = document.querySelector<HTMLElement>('.image-lightbox');
    expect(overlay).not.toBeNull();
    expect(document.body.classList.contains('modal-open')).toBe(true);

    expect(closeActiveLightbox()).toBe(true);
    overlay?.dispatchEvent(new Event('transitionend'));

    expect(document.querySelector('.image-lightbox')).toBeNull();
    expect(document.body.classList.contains('modal-open')).toBe(false);
  });

  it('opens video lightboxes with muted looping playback and no native controls', () => {
    document.body.innerHTML = `
      <div class="project-content">
        <video id="inline-video" src="http://localhost/inline.mp4" autoplay loop muted playsinline></video>
      </div>
    `;

    const video = document.getElementById('inline-video');
    if (!(video instanceof HTMLVideoElement)) {
      throw new Error('Failed to create video fixture');
    }

    openVideoLightbox(video);

    const lightboxVideo = document.querySelector<HTMLVideoElement>('.image-lightbox video');
    expect(lightboxVideo).not.toBeNull();
    expect(lightboxVideo?.controls).toBe(false);
    expect(lightboxVideo?.muted).toBe(true);
    expect(lightboxVideo?.loop).toBe(true);
    expect(lightboxVideo?.hasAttribute('autoplay')).toBe(true);
  });
});

import type { Alignment, ImageBlock, VideoBlock } from '../types/blocks';

export function createImageElement(
  block: ImageBlock,
  onClick?: (element: HTMLImageElement, block: ImageBlock) => void
): HTMLImageElement {
  const img = document.createElement('img');
  img.src = block.src;
  img.alt = block.alt || '';
  if (block.style) img.setAttribute('style', block.style);
  if (block.align) applyAlignment(img, block.align);
  if (onClick) {
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick(img, block);
    });
  }
  return img;
}

export function createVideoElement(
  block: VideoBlock,
  onClick?: (element: HTMLVideoElement, block: VideoBlock) => void
): HTMLVideoElement {
  const video = document.createElement('video');
  video.src = block.src;
  if (block.poster) {
    video.poster = block.poster;
    video.setAttribute('poster', block.poster);
  }
  applyVideoPlaybackSettings(video, !!block.autoplay);
  if (block.style) video.setAttribute('style', block.style);
  if (block.align) applyAlignment(video, block.align);

  if (onClick) {
    video.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick(video, block);
    });
  }
  return video;
}

export function applyVideoPlaybackSettings(video: HTMLVideoElement, autoplay: boolean): void {
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

export function applyAlignment(element: HTMLElement, align: Alignment): void {
  element.style.display = 'block';
  element.style.marginLeft = '';
  element.style.marginRight = '';

  if (align === 'center') {
    element.style.marginLeft = 'auto';
    element.style.marginRight = 'auto';
  } else if (align === 'right') {
    element.style.marginLeft = 'auto';
  }
}

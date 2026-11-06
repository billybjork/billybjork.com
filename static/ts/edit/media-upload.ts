import { API, postForm, readErrorDetail, uploadWithProgress } from './api';
import { formatMegabytes } from './text';

const MAX_IMAGE_WIDTH = 2000;
const IMAGE_QUALITY = 0.8;
// Video upload stages share one bar: sending is 0-65%, then the server's processing.
const UPLOAD_SHARE_OF_BAR = 0.65;
const PROCESSING_BAR_PERCENT = 72;
const FRAME_READY_TIMEOUT_MS = 8000;

export interface VideoUploadProgressUpdate {
  stage: 'uploading' | 'processing' | 'complete' | 'error';
  progress: number;
  message: string;
}

/** Downscales to the site's maximum width and converts to WebP. */
function processImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Could not get canvas context'));
      return;
    }

    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > MAX_IMAGE_WIDTH) {
        height = Math.round((height * MAX_IMAGE_WIDTH) / width);
        width = MAX_IMAGE_WIDTH;
      }

      canvas.width = width;
      canvas.height = height;

      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to create blob'));
          }
        },
        'image/webp',
        IMAGE_QUALITY
      );

      URL.revokeObjectURL(img.src);
    };

    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error('Failed to load image'));
    };

    img.src = URL.createObjectURL(file);
  });
}

function ensureVideoFrameReady(video: HTMLVideoElement): Promise<void> {
  if (
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    video.videoWidth > 0 &&
    video.videoHeight > 0
  ) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('Video frame is not ready. Try playing or scrubbing the video first.'));
    }, FRAME_READY_TIMEOUT_MS);

    const handleReady = () => {
      if (
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      ) {
        cleanup();
        resolve();
      }
    };

    const handleError = () => {
      cleanup();
      reject(new Error('Unable to read the video frame.'));
    };

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      video.removeEventListener('loadeddata', handleReady);
      video.removeEventListener('canplay', handleReady);
      video.removeEventListener('seeked', handleReady);
      video.removeEventListener('error', handleError);
    };

    video.addEventListener('loadeddata', handleReady);
    video.addEventListener('canplay', handleReady);
    video.addEventListener('seeked', handleReady);
    video.addEventListener('error', handleError);

    if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
      video.load();
    }

    handleReady();
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('Failed to capture video frame.'));
      }
    }, type, quality);
  });
}

export async function uploadImage(file: File | Blob): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('type', 'image');
  const { url } = await postForm<{ url: string }>(API.uploadMedia, formData, 'Image upload failed');
  return url;
}

export async function uploadProcessedImage(file: File): Promise<string> {
  return uploadImage(await processImage(file));
}

export async function uploadContentVideo(
  file: File,
  onProgress?: (update: VideoUploadProgressUpdate) => void
): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);

  const { result } = uploadWithProgress<{ url?: string }>(API.processContentVideo, formData, {
    onProgress(progress) {
      if (!progress) {
        onProgress?.({ stage: 'uploading', progress: 10, message: 'Uploading video...' });
        return;
      }
      const percent = (progress.loaded / progress.total) * 100;
      onProgress?.({
        stage: 'uploading',
        progress: Math.max(1, Math.round(percent * UPLOAD_SHARE_OF_BAR)),
        message: `Uploading video... ${Math.round(percent)}% (${formatMegabytes(progress.loaded)} / ${formatMegabytes(progress.total)} MB)`,
      });
    },
    onSent() {
      onProgress?.({ stage: 'processing', progress: PROCESSING_BAR_PERCENT, message: 'Upload complete. Processing video...' });
    },
  });

  try {
    const { url } = await result;
    if (!url) throw new Error('Upload failed: no URL returned');
    onProgress?.({ stage: 'complete', progress: 100, message: 'Video ready!' });
    return url;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload failed';
    onProgress?.({ stage: 'error', progress: 100, message });
    throw error;
  }
}

async function capturePosterOnServer(sourceUrl: string, frameTime: number): Promise<string> {
  const response = await fetch(API.contentVideoPoster, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_url: sourceUrl, frame_time: frameTime }),
  });
  if (!response.ok) {
    throw new Error(await readErrorDetail(response) || `Poster extraction failed: ${response.status}`);
  }
  const payload = await response.json() as { url?: string };
  if (!payload.url) throw new Error('Poster extraction returned no URL');
  return payload.url;
}

/**
 * Captures the current frame in the browser, or on the server when the browser
 * cannot, as with a cross-origin video that taints the canvas.
 */
export async function capturePosterFromVideo(video: HTMLVideoElement): Promise<string> {
  const sourceUrl = (video.currentSrc || video.src || video.querySelector('source')?.src || '').trim();
  const frameTime = Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : 0;

  try {
    await ensureVideoFrameReady(video);

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not initialize frame capture.');

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await uploadImage(await canvasToBlob(canvas, 'image/webp', IMAGE_QUALITY));
  } catch (error) {
    if (!sourceUrl) throw error;
    console.warn('Browser frame capture failed; asking the server.', error);
    return capturePosterOnServer(sourceUrl, frameTime);
  }
}

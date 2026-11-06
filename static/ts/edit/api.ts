import type { FetchJSONOptions } from '../types/api';

/** Every /api route the editor calls; routers/admin.py and routers/admin_media.py own the other side. */
export const API = {
  project: (slug: string) => `/api/project/${slug}`,
  about: '/api/about',
  saveProject: '/api/save-project',
  saveAbout: '/api/save-about',
  createProject: '/api/create-project',
  cleanupAssets: '/api/cleanup-assets',
  uploadMedia: '/api/upload-media',
  processContentVideo: '/api/process-content-video',
  contentVideoPoster: '/api/content-video-poster',
  videoThumbnails: '/api/video-thumbnails',
  videoThumbnailsExisting: '/api/video-thumbnails-existing',
  moreThumbnails: (tempId: string) => `/api/video-thumbnails/more/${tempId}`,
  hlsProgress: (sessionId: string) => `/api/hls-progress/${sessionId}`,
  generateSpriteSheet: '/api/generate-sprite-sheet',
};

/** The server's `detail` message, or undefined when the error body is not JSON, as from a proxy. */
export async function readErrorDetail(response: Response): Promise<string | undefined> {
  const body = await response.json().catch(() => null) as { detail?: string } | null;
  return body?.detail;
}

export async function fetchJSON<T>(url: string, options: FetchJSONOptions = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(await readErrorDetail(response) || `HTTP error! status: ${response.status}`);
  }

  return await response.json() as T;
}

export function postJSON<T>(url: string, body: unknown): Promise<T> {
  return fetchJSON<T>(url, { method: 'POST', body: JSON.stringify(body) });
}

export async function postForm<T>(url: string, formData: FormData, fallback: string): Promise<T> {
  const response = await fetch(url, { method: 'POST', body: formData });
  if (!response.ok) {
    throw new Error(await readErrorDetail(response) || fallback);
  }
  return await response.json() as T;
}

interface UploadProgress {
  loaded: number;
  total: number;
}

interface UploadHandlers {
  /** Fires with sizes when the browser knows them, and with null when it does not. */
  onProgress?: (progress: UploadProgress | null) => void;
  onSent?: () => void;
}

export class UploadError extends Error {
  constructor(message: string, readonly kind: 'http' | 'network' | 'aborted', readonly detail?: string) {
    super(message);
  }
}

/** fetch cannot report upload progress, so uploads the user watches go through XHR. */
export function uploadWithProgress<T>(
  url: string,
  formData: FormData,
  handlers: UploadHandlers = {}
): { result: Promise<T>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const result = new Promise<T>((resolve, reject) => {
    xhr.upload.addEventListener('progress', (event) => {
      const known = event.lengthComputable && event.total > 0;
      handlers.onProgress?.(known ? { loaded: event.loaded, total: event.total } : null);
    });
    xhr.upload.addEventListener('load', () => handlers.onSent?.());

    xhr.addEventListener('load', () => {
      let payload: (T & { detail?: string }) | null = null;
      try {
        payload = JSON.parse(xhr.responseText || '{}');
      } catch (error) {
        console.warn('Upload response was not JSON:', error);
      }
      if (xhr.status >= 200 && xhr.status < 300 && payload) {
        resolve(payload);
      } else {
        reject(new UploadError(payload?.detail || `Upload failed: ${xhr.status}`, 'http', payload?.detail));
      }
    });
    xhr.addEventListener('error', () => reject(new UploadError('Upload failed: network error', 'network')));
    xhr.addEventListener('abort', () => reject(new UploadError('Upload canceled', 'aborted')));

    xhr.open('POST', url);
    xhr.send(formData);
  });
  return { result, abort: () => xhr.abort() };
}

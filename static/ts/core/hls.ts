const DEFAULT_HLS_JS_SRC = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.12';
const HLS_MIME_TYPE = 'application/vnd.apple.mpegurl';

export const DEFAULT_HLS_CONFIG: HlsConfig = {
  abrEwmaDefaultEstimate: 5000000,
  capLevelToPlayerSize: true,
};

export type HlsPlaybackMode = 'hlsjs' | 'native';

export interface AttachHlsPlaybackOptions {
  videoElement: HTMLVideoElement;
  sourceUrl: string;
  signal?: AbortSignal;
  onManifestParsed?: (hls: Hls) => void;
}

export interface AttachHlsPlaybackResult {
  mode: HlsPlaybackMode;
  hls?: Hls;
}

let hlsScriptPromise: Promise<void> | null = null;

function createAbortError(): Error {
  const error = new Error('HLS playback initialization aborted');
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function loadHlsScript(): Promise<void> {
  if (window.Hls) {
    return Promise.resolve();
  }
  if (hlsScriptPromise) {
    return hlsScriptPromise;
  }

  hlsScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = document.body.dataset.hlsJsSrc || DEFAULT_HLS_JS_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      hlsScriptPromise = null;
      script.remove();
      reject(new Error('Failed to load HLS.js'));
    };
    document.head.appendChild(script);
  });

  return hlsScriptPromise;
}

export function canPlayNativeHls(videoElement: HTMLVideoElement): boolean {
  return !!videoElement.canPlayType(HLS_MIME_TYPE);
}

export function resetVideoElementSource(videoElement: HTMLVideoElement): void {
  videoElement.pause();
  videoElement.removeAttribute('src');
  videoElement.load();
}

export function destroyHlsInstance(videoElement: HTMLVideoElement): void {
  if (videoElement.hlsInstance) {
    videoElement.hlsInstance.destroy();
    videoElement.hlsInstance = null;
  }
}

function prepareForPlaybackAttach(videoElement: HTMLVideoElement): void {
  destroyHlsInstance(videoElement);
  resetVideoElementSource(videoElement);
}

function attachHlsJsPlayback(options: AttachHlsPlaybackOptions): Promise<AttachHlsPlaybackResult> {
  const { videoElement, sourceUrl, signal, onManifestParsed } = options;

  return new Promise((resolve, reject) => {
    if (!window.Hls || !window.Hls.isSupported()) {
      reject(new Error('HLS.js not supported'));
      return;
    }

    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    prepareForPlaybackAttach(videoElement);

    const hls = new window.Hls(DEFAULT_HLS_CONFIG);
    videoElement.hlsInstance = hls;

    let settled = false;
    const finish = (result: AttachHlsPlaybackResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      destroyHlsInstance(videoElement);
      reject(error);
    };
    const handleAbort = (): void => {
      fail(createAbortError());
    };
    const cleanup = (): void => {
      signal?.removeEventListener('abort', handleAbort);
    };

    signal?.addEventListener('abort', handleAbort, { once: true });

    hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      if (signal?.aborted) {
        handleAbort();
        return;
      }
      onManifestParsed?.(hls);
      finish({ mode: 'hlsjs', hls });
    });

    hls.on(window.Hls.Events.ERROR, (_event: string, data: unknown) => {
      const errorData = data as { fatal?: boolean; type?: string; details?: string } | null;
      if (!errorData?.fatal) {
        if (errorData?.details === 'bufferAppendError') {
          hls.recoverMediaError();
        }
        return;
      }

      switch (errorData.type) {
        case window.Hls.ErrorTypes.NETWORK_ERROR:
          hls.startLoad();
          break;
        case window.Hls.ErrorTypes.MEDIA_ERROR:
          hls.recoverMediaError();
          break;
        default:
          fail(new Error(errorData.details || 'HLS.js fatal error'));
          break;
      }
    });

    hls.loadSource(sourceUrl);
    hls.attachMedia(videoElement);
  });
}

function attachNativeHlsPlayback(options: AttachHlsPlaybackOptions): Promise<AttachHlsPlaybackResult> {
  const { videoElement, sourceUrl, signal } = options;

  return new Promise((resolve, reject) => {
    if (!canPlayNativeHls(videoElement)) {
      reject(new Error('Native HLS not supported'));
      return;
    }

    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    prepareForPlaybackAttach(videoElement);

    const onLoadedMetadata = (): void => {
      cleanup();
      resolve({ mode: 'native' });
    };
    const onError = (): void => {
      cleanup();
      reject(new Error('Native HLS failed to load'));
    };
    const onAbort = (): void => {
      cleanup();
      resetVideoElementSource(videoElement);
      reject(createAbortError());
    };
    const cleanup = (): void => {
      videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
      videoElement.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };

    videoElement.addEventListener('loadedmetadata', onLoadedMetadata, { once: true });
    videoElement.addEventListener('error', onError, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
    videoElement.src = sourceUrl;
    videoElement.load();
  });
}

export async function attachHlsPlayback(options: AttachHlsPlaybackOptions): Promise<AttachHlsPlaybackResult> {
  const { videoElement } = options;
  const canPlayNative = canPlayNativeHls(videoElement);

  try {
    if (window.Hls && window.Hls.isSupported()) {
      return await attachHlsJsPlayback(options);
    }

    await loadHlsScript();
    if (window.Hls && window.Hls.isSupported()) {
      return await attachHlsJsPlayback(options);
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    if (!canPlayNative) {
      throw error;
    }
  }

  if (!canPlayNative) {
    throw new Error('HLS is not supported in this browser');
  }

  return attachNativeHlsPlayback(options);
}

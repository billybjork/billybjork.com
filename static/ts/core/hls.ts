const HLS_JS_SRC = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.12';
const HLS_MIME_TYPE = 'application/vnd.apple.mpegurl';

const HLS_CONFIG: HlsConfig = {
  abrEwmaDefaultEstimate: 5000000,
  capLevelToPlayerSize: true,
};

interface AttachHlsPlaybackOptions {
  videoElement: HTMLVideoElement;
  sourceUrl: string;
  signal?: AbortSignal;
  onManifestParsed?: (hls: Hls) => void;
}

let hlsScriptPromise: Promise<void> | null = null;

function createAbortError(): Error {
  const error = new Error('HLS playback initialization aborted');
  error.name = 'AbortError';
  return error;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function loadHlsScript(): Promise<void> {
  if (window.Hls) {
    return Promise.resolve();
  }
  if (hlsScriptPromise) {
    return hlsScriptPromise;
  }

  hlsScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = HLS_JS_SRC;
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

function attachHlsJsPlayback(HlsClass: typeof Hls, options: AttachHlsPlaybackOptions): Promise<void> {
  const { videoElement, sourceUrl, signal, onManifestParsed } = options;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    prepareForPlaybackAttach(videoElement);

    const hls = new HlsClass(HLS_CONFIG);
    videoElement.hlsInstance = hls;

    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
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

    hls.on(HlsClass.Events.MANIFEST_PARSED, () => {
      if (signal?.aborted) {
        handleAbort();
        return;
      }
      onManifestParsed?.(hls);
      finish();
    });

    hls.on(HlsClass.Events.ERROR, (_event: string, data: unknown) => {
      const errorData = data as { fatal?: boolean; type?: string; details?: string } | null;
      if (!errorData?.fatal) {
        if (errorData?.details === 'bufferAppendError') {
          hls.recoverMediaError();
        }
        return;
      }

      switch (errorData.type) {
        case HlsClass.ErrorTypes.NETWORK_ERROR:
          hls.startLoad();
          break;
        case HlsClass.ErrorTypes.MEDIA_ERROR:
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

function attachNativeHlsPlayback(options: AttachHlsPlaybackOptions): Promise<void> {
  const { videoElement, sourceUrl, signal } = options;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    prepareForPlaybackAttach(videoElement);

    const onLoadedMetadata = (): void => {
      cleanup();
      resolve();
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

/** Prefers hls.js, even where the browser plays HLS natively; native is the fallback. */
export async function attachHlsPlayback(options: AttachHlsPlaybackOptions): Promise<void> {
  const canPlayNative = !!options.videoElement.canPlayType(HLS_MIME_TYPE);

  try {
    await loadHlsScript();
    if (window.Hls?.isSupported()) {
      return await attachHlsJsPlayback(window.Hls, options);
    }
  } catch (error) {
    if (isAbortError(error) || !canPlayNative) {
      throw error;
    }
  }

  if (!canPlayNative) {
    throw new Error('HLS is not supported in this browser');
  }

  return attachNativeHlsPlayback(options);
}

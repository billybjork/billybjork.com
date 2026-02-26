const DEFAULT_HLS_JS_SRC = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.12';
const HLS_MIME_TYPE = 'application/vnd.apple.mpegurl';

export const DEFAULT_HLS_CONFIG: HlsConfig = {
  abrEwmaDefaultEstimate: 5000000,
  capLevelToPlayerSize: true,
};

let hlsScriptPromise: Promise<void> | null = null;

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
    script.onerror = () => reject(new Error('Failed to load HLS.js'));
    document.head.appendChild(script);
  });

  return hlsScriptPromise;
}

export function canPlayNativeHls(videoElement: HTMLVideoElement): boolean {
  return !!videoElement.canPlayType(HLS_MIME_TYPE);
}

export function destroyHlsInstance(videoElement: HTMLVideoElement): void {
  if (videoElement.hlsInstance) {
    videoElement.hlsInstance.destroy();
    videoElement.hlsInstance = null;
  }
}

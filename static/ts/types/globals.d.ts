declare namespace Prism {
  function highlightAllUnder(element: Element): void;
}

declare const Prism: typeof Prism | undefined;

declare namespace Hls {
  const Events: {
    MEDIA_ATTACHED: string;
    MANIFEST_PARSED: string;
    FRAG_LOADED: string;
    LEVEL_SWITCHED: string;
    ERROR: string;
  };

  const ErrorTypes: {
    NETWORK_ERROR: string;
    MEDIA_ERROR: string;
    OTHER_ERROR: string;
  };

  function isSupported(): boolean;
}

declare class Hls {
  constructor(config?: HlsConfig);
  loadSource(url: string): void;
  attachMedia(media: HTMLMediaElement): void;
  on(event: string, callback: (event: string, data: unknown) => void): void;
  startLoad(): void;
  recoverMediaError(): void;
  destroy(): void;
  levels: HlsLevel[];
  startLevel: number;
  static isSupported(): boolean;
  static Events: typeof Hls.Events;
  static ErrorTypes: typeof Hls.ErrorTypes;
}

interface HlsConfig {
  abrEwmaDefaultEstimate?: number;
  capLevelToPlayerSize?: boolean;
}

interface HlsLevel {
  width?: number;
  height: number;
  bitrate: number;
}

interface HTMLVideoElement {
  hlsInstance?: Hls | null;
}

interface Window {
  Hls: typeof Hls;
  Prism: typeof Prism;
}

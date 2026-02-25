/**
 * Global type declarations for external libraries and browser APIs
 */

// Prism.js syntax highlighting
declare namespace Prism {
  function highlightAllUnder(element: Element): void;
  function highlightAll(): void;
  function highlight(code: string, grammar: unknown, language: string): string;
}

declare const Prism: typeof Prism | undefined;

// HLS.js video streaming
declare namespace Hls {
  const Events: {
    MEDIA_ATTACHED: string;
    MANIFEST_PARSED: string;
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
  currentLevel: number;
  nextLevel: number;
  autoLevelEnabled: boolean;
  static isSupported(): boolean;
  static Events: typeof Hls.Events;
  static ErrorTypes: typeof Hls.ErrorTypes;
}

interface HlsConfig {
  abrEwmaDefaultEstimate?: number;
  capLevelToPlayerSize?: boolean;
}

interface HlsLevel {
  height: number;
  bitrate: number;
}

// Extend HTMLVideoElement with HLS instance
interface HTMLVideoElement {
  hlsInstance?: Hls | null;
  videoLayoutCleanup?: (() => void) | null;
}

// Window extensions for our modules
interface Window {
  // Edit mode modules
  EditMode: typeof import('../edit/mode').default;

  // Project modules
  ProjectSettings: typeof import('../edit/project-settings').default;
  ProjectCreate: typeof import('../edit/project-create').default;

  // External libraries
  Hls: typeof Hls;
  Prism: typeof Prism;
}

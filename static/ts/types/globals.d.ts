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
}

// Window extensions for our modules
interface Window {
  // Edit mode modules
  EditUtils: typeof import('../core/utils').EditUtils;
  EditBlocks: typeof import('../edit/blocks').default;
  EditMode: typeof import('../edit/mode').default;
  EditMedia: typeof import('../edit/media').default;
  EditSlash: typeof import('../edit/slash').default;
  EditUndo: typeof import('../edit/undo').default;

  // Project modules
  ProjectLoader: typeof import('../project/loader').default;
  ProjectSettings?: unknown;
  ProjectCreate?: unknown;

  // Three.js visualization module
  ThreeVisualization?: typeof import('../visualization/index');

  // Utility functions
  copyToClipboard: (text: string, message?: string) => void;
  handleProjectContent: (projectItem: HTMLElement, smoothScroll?: boolean) => Promise<void>;
  closeAllOpenProjects: () => void;
  cleanupActiveHLSPlayers: () => void;
  checkAndHighlightCode?: (element: Element) => void;

  // External libraries
  Hls: typeof Hls;
  Prism: typeof Prism;
  THREE: typeof import('three');
}

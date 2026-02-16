/**
 * CustomEvent type declarations for project events
 */

export interface ProjectEventDetail {
  element: HTMLElement | null;
  slug: string;
  isOpen: boolean;
  smoothScroll?: boolean;
  error?: Error;
}

export interface ProjectsLoadedEventDetail {
  page: number;
}

export interface CodeHighlightingReadyEvent extends Event {
  type: 'codeHighlightingReady';
}

export interface ProjectBeforeLoadEvent extends CustomEvent<ProjectEventDetail> {
  type: 'project:beforeLoad';
}

export interface ProjectBeforeSwapEvent extends CustomEvent<ProjectEventDetail> {
  type: 'project:beforeSwap';
}

export interface ProjectAfterSwapEvent extends CustomEvent<ProjectEventDetail> {
  type: 'project:afterSwap';
}

export interface ProjectLoadedEvent extends CustomEvent<ProjectEventDetail> {
  type: 'project:loaded';
}

export interface ProjectErrorEvent extends CustomEvent<ProjectEventDetail> {
  type: 'project:error';
}

export interface ProjectsLoadedEvent extends CustomEvent<ProjectsLoadedEventDetail> {
  type: 'projects:loaded';
}

/**
 * Event type map for strongly-typed event listeners
 */
export interface ProjectEventMap {
  'project:beforeLoad': ProjectBeforeLoadEvent;
  'project:beforeSwap': ProjectBeforeSwapEvent;
  'project:afterSwap': ProjectAfterSwapEvent;
  'project:loaded': ProjectLoadedEvent;
  'project:error': ProjectErrorEvent;
  'projects:loaded': ProjectsLoadedEvent;
  'codeHighlightingReady': CodeHighlightingReadyEvent;
}

/**
 * Helper to dispatch typed custom events
 */
export function dispatchProjectEvent<K extends keyof ProjectEventMap>(
  eventName: K,
  detail: ProjectEventMap[K] extends CustomEvent<infer D> ? D : never
): void {
  document.body.dispatchEvent(new CustomEvent(eventName, {
    bubbles: true,
    detail,
  }));
}

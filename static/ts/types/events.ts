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

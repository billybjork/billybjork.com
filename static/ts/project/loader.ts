/**
 * Project Loader Module
 * Handles AJAX-based project navigation, infinite scroll,
 * and browser history management.
 */

import type { ProjectEventDetail, ProjectsLoadedEventDetail } from '../types/events';
import { checkAndHighlightCode } from './code-highlighting';

// ========== STATE ==========

let currentAbortController: AbortController | null = null;

// ========== HELPERS ==========

/**
 * Check for code blocks and highlight them using the bundled code-highlighting module.
 * Prism.js is loaded lazily by the code-highlighting module itself.
 */
function loadCodeHighlightingIfNeeded(targetElement: Element): void {
  if (!targetElement.querySelector('pre code')) {
    return;
  }

  // Use the bundled checkAndHighlightCode function
  checkAndHighlightCode(targetElement);
}

/**
 * Check if show_drafts is active (from URL or sessionStorage)
 */
function isShowDraftsActive(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.has('show_drafts')) {
    return params.get('show_drafts') === 'true';
  }
  return sessionStorage.getItem('bb_show_drafts') === 'true';
}

/**
 * Build URL with show_drafts parameter if active
 */
function buildUrl(path: string, extraParams: Record<string, string | number | null | undefined> = {}): string {
  const url = new URL(path, window.location.origin);
  Object.entries(extraParams).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  });
  if (isShowDraftsActive()) {
    url.searchParams.set('show_drafts', 'true');
  }
  return url.toString();
}

/**
 * Whether project open/close should sync browser URL/history.
 */
function isProjectUrlSyncEnabled(): boolean {
  return document.body.dataset.projectUrlSync !== 'false';
}

/**
 * Dispatch a custom event on the document body
 */
export function dispatchEvent<T extends object>(eventName: string, detail: T = {} as T): void {
  document.body.dispatchEvent(new CustomEvent(eventName, {
    bubbles: true,
    detail: detail
  }));
}

/**
 * Show notification
 */
function showNotification(message: string, isError: boolean = false): void {
  const notification = document.createElement('div');
  notification.className = `copy-notification${isError ? ' error' : ''}`;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    if (notification.parentNode) {
      document.body.removeChild(notification);
    }
  }, 4000);
}

/**
 * Fetch HTML content from a URL
 */
async function fetchHTML(url: string, signal?: AbortSignal): Promise<string> {
  const requestUrl = new URL(url, window.location.origin);
  requestUrl.searchParams.set('_partial', '1');

  const response = await fetch(requestUrl.toString(), {
    method: 'GET',
    headers: {
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'text/html'
    },
    signal: signal
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return await response.text();
}

// ========== PROJECT OPERATIONS ==========

interface OpenProjectOptions {
  pushUrl?: boolean;
  smoothScroll?: boolean;
}

/**
 * Open a project by fetching its details
 */
export async function openProject(slug: string, options: OpenProjectOptions = {}): Promise<void> {
  const defaultPushUrl = isProjectUrlSyncEnabled();
  const { pushUrl = defaultPushUrl, smoothScroll = true } = options;

  const projectItem = document.querySelector<HTMLElement>(`.project-item[data-slug="${slug}"]`);
  if (!projectItem) {
    console.error(`Project item not found for slug: ${slug}`);
    return;
  }

  if (projectItem.classList.contains('active')) {
    return;
  }

  const detailsContainer = document.getElementById(`details-${slug}`);
  if (!detailsContainer) {
    console.error(`Details container not found for slug: ${slug}`);
    return;
  }

  if (currentAbortController) {
    currentAbortController.abort();
  }
  currentAbortController = new AbortController();

  closeAllProjects();

  dispatchEvent<ProjectEventDetail>('project:beforeLoad', {
    element: detailsContainer,
    slug: slug,
    isOpen: true
  });

  try {
    const url = buildUrl(`/${slug}`);
    const html = await fetchHTML(url, currentAbortController.signal);

    dispatchEvent<ProjectEventDetail>('project:beforeSwap', {
      element: detailsContainer,
      slug: slug,
      isOpen: true
    });

    detailsContainer.innerHTML = html;
    projectItem.classList.add('active');

    if (pushUrl) {
      const stateUrl = buildUrl(`/${slug}`);
      history.pushState({ slug: slug, isOpen: true }, '', stateUrl);
    }

    dispatchEvent<ProjectEventDetail>('project:afterSwap', {
      element: detailsContainer,
      slug: slug,
      isOpen: true,
      smoothScroll: smoothScroll
    });

    loadCodeHighlightingIfNeeded(detailsContainer);

    dispatchEvent<ProjectEventDetail>('project:loaded', {
      element: detailsContainer,
      slug: slug,
      isOpen: true
    });

  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return;
    }
    console.error('Failed to load project:', error);
    dispatchEvent<ProjectEventDetail>('project:error', {
      element: detailsContainer,
      slug: slug,
      isOpen: false,
      error: error instanceof Error ? error : new Error(String(error))
    });
    showNotification('Failed to load content. Please try again.', true);
  } finally {
    currentAbortController = null;
  }
}

interface CloseProjectOptions {
  pushUrl?: boolean;
}

/**
 * Close a specific project
 */
export async function closeProject(slug: string, options: CloseProjectOptions = {}): Promise<void> {
  const defaultPushUrl = isProjectUrlSyncEnabled();
  const { pushUrl = defaultPushUrl } = options;

  const projectItem = document.querySelector<HTMLElement>(`.project-item[data-slug="${slug}"]`);
  if (!projectItem) return;

  const detailsContainer = document.getElementById(`details-${slug}`);
  if (!detailsContainer) return;

  dispatchEvent<ProjectEventDetail>('project:beforeSwap', {
    element: detailsContainer,
    slug: slug,
    isOpen: false
  });

  detailsContainer.innerHTML = '';
  projectItem.classList.remove('active');

  if (pushUrl) {
    const stateUrl = buildUrl('/');
    history.pushState({ slug: null, isOpen: false }, '', stateUrl);
  }

  dispatchEvent<ProjectEventDetail>('project:afterSwap', {
    element: detailsContainer,
    slug: slug,
    isOpen: false
  });
}

/**
 * Close all open projects
 */
export function closeAllProjects(): void {
  const openProjects = document.querySelectorAll<HTMLElement>('.project-item.active');
  openProjects.forEach(projectItem => {
    const slug = projectItem.dataset.slug;
    if (!slug) return;

    const detailsContainer = document.getElementById(`details-${slug}`);

    dispatchEvent<ProjectEventDetail>('project:beforeSwap', {
      element: detailsContainer,
      slug: slug,
      isOpen: false
    });

    if (detailsContainer) {
      detailsContainer.innerHTML = '';
    }
    projectItem.classList.remove('active');

    dispatchEvent<ProjectEventDetail>('project:afterSwap', {
      element: detailsContainer,
      slug: slug,
      isOpen: false
    });
  });
}

// ========== INFINITE SCROLL ==========

/**
 * Load more projects for infinite scroll
 */
export async function loadMoreProjects(sentinel: HTMLElement): Promise<void> {
  const page = parseInt(sentinel.dataset.page ?? '', 10);
  if (!page || sentinel.dataset.loading === 'true') return;

  sentinel.dataset.loading = 'true';

  try {
    const url = buildUrl('/', { page: page });
    const html = await fetchHTML(url);

    sentinel.insertAdjacentHTML('beforebegin', html);
    sentinel.remove();

    dispatchEvent<ProjectsLoadedEventDetail>('projects:loaded', {
      page: page
    });

  } catch (error) {
    console.error('Failed to load more projects:', error);
    sentinel.dataset.loading = 'false';
    showNotification('Failed to load more projects.', true);
  }
}

let sentinelObserver: IntersectionObserver | null = null;

function initializeSentinelObserver(): void {
  if (sentinelObserver) {
    sentinelObserver.disconnect();
  }

  sentinelObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const sentinel = entry.target as HTMLElement;
        if (sentinel.dataset.page) {
          loadMoreProjects(sentinel);
        }
      }
    });
  }, {
    rootMargin: '100px',
    threshold: 0
  });

  observeSentinels();
}

function observeSentinels(): void {
  const sentinels = document.querySelectorAll<HTMLElement>('[id^="infinite-scroll-sentinel-"]');
  sentinels.forEach(sentinel => {
    if (sentinel.dataset.page && sentinelObserver) {
      sentinelObserver.observe(sentinel);
    }
  });
}

// ========== BROWSER NAVIGATION ==========

interface HistoryState {
  slug: string | null;
  isOpen: boolean;
}

function handlePopState(event: PopStateEvent): void {
  if (!isProjectUrlSyncEnabled()) {
    return;
  }

  const state = event.state as HistoryState | null;

  if (state && state.slug && state.isOpen) {
    openProject(state.slug, { pushUrl: false });
  } else {
    const currentPath = window.location.pathname;
    if (currentPath === '/') {
      closeAllProjects();
    } else if (currentPath !== '/me') {
      window.location.reload();
    }
  }
}

// ========== CLICK HANDLERS ==========

function handleProjectClick(event: MouseEvent): void {
  const target = event.target as HTMLElement;

  // Check for project header click
  const projectHeader = target.closest<HTMLElement>('.project-header');
  if (projectHeader) {
    const projectItem = projectHeader.closest<HTMLElement>('.project-item');
    if (projectItem) {
      const slug = projectItem.dataset.slug;
      if (slug) {
        event.preventDefault();
        openProject(slug);
        return;
      }
    }
  }

  // Check for thumbnail click
  const thumbnail = target.closest<HTMLElement>('.thumbnail');
  if (thumbnail) {
    const projectItem = thumbnail.closest<HTMLElement>('.project-item');
    if (projectItem) {
      const slug = projectItem.dataset.slug;
      if (slug) {
        event.preventDefault();
        openProject(slug);
        return;
      }
    }
  }

  // Check for close button click (non-isolation mode only)
  const closeBtn = target.closest<HTMLElement>('.close-project');
  if (closeBtn) {
    const isIsolationMode = document.body.dataset.isolationMode === 'true';
    if (!isIsolationMode) {
      const projectItem = closeBtn.closest<HTMLElement>('.project-item');
      if (projectItem) {
        const slug = projectItem.dataset.slug;
        if (slug) {
          event.preventDefault();
          closeProject(slug);
          return;
        }
      }
    }
  }
}

// ========== INITIALIZATION ==========

function initialize(): void {
  document.body.addEventListener('click', handleProjectClick);
  if (isProjectUrlSyncEnabled()) {
    window.addEventListener('popstate', handlePopState);
  }
  initializeSentinelObserver();

  document.body.addEventListener('projects:loaded', () => {
    observeSentinels();
  });

  if (isProjectUrlSyncEnabled() && !history.state) {
    const pathname = window.location.pathname;
    if (pathname !== '/' && pathname !== '/me') {
      const slug = pathname.slice(1);
      const hasMatchingProject = !!document.querySelector<HTMLElement>(`.project-item[data-slug="${slug}"]`);
      if (hasMatchingProject) {
        history.replaceState({ slug: slug, isOpen: true }, '');
      } else {
        history.replaceState({ slug: null, isOpen: false }, '');
      }
    } else {
      history.replaceState({ slug: null, isOpen: false }, '');
    }
  }

  loadCodeHighlightingIfNeeded(document.body);
}

export function init(): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }
}

// ========== PUBLIC API ==========

const ProjectLoader = {
  openProject,
  closeProject,
  closeAllProjects,
  loadMoreProjects,
  dispatchEvent,
  init,
};

export default ProjectLoader;

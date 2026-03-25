/**
 * Edit Mode Bootstrap (Dev Only)
 * Provides edit-mode UI controls and keyboard shortcuts.
 * Only activates on localhost — no-op in production.
 */

import { isDevMode, isShowDraftsActive } from '../core/utils';
import { getHomepageRuntime, waitForHomepageRuntime } from '../core/runtime-registry';
import { restorePersistedScroll } from './scroll-restore';

// ========== CONSTANTS ==========

const SHOW_DRAFTS_KEY = 'bb_show_drafts';
const EDIT_MODE_STYLE_HREFS = [
  '/static/css/edit-mode-base.css',
  '/static/css/edit-mode-settings.css',
  '/static/css/edit-mode-extras.css',
] as const;
const NEW_PROJECT_ICON = '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const EDIT_ICON = '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const DRAFTS_ICON = '<svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';

let headerCompactionObserver: ResizeObserver | null = null;
let headerCompactionResizeHandlerBound = false;
let headerCompactionFrame: number | null = null;

// ========== HELPERS ==========

function buildUrlWithShowDrafts(
  pathname: string,
  params: Record<string, string | null | undefined> = {}
): string {
  const url = new URL(pathname, window.location.origin);
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    url.searchParams.set(key, value);
  });
  if (isShowDraftsActive()) {
    url.searchParams.set('show_drafts', 'true');
  }
  return url.toString();
}

function readProjectSlugFromPath(): string | null {
  const pathname = window.location.pathname.replace(/\/+$/, '');
  if (!pathname || pathname === '/' || pathname === '/me') {
    return null;
  }

  const slug = decodeURIComponent(pathname.slice(1)).trim();
  return slug && !slug.includes('/') ? slug : null;
}

function getActiveProjectSlug(): string | null {
  const homepageSlug = getHomepageRuntime()?.getOpenProjectSlug();
  return homepageSlug || readProjectSlugFromPath();
}

function getEditableProjectContent(): HTMLElement | null {
  return document.querySelector<HTMLElement>('#homepage-detail-content .project-content')
    ?? document.querySelector<HTMLElement>('.project-item.active .project-content')
    ?? document.querySelector<HTMLElement>('.project-content');
}

function hasEditableProjectContent(): boolean {
  return !!getEditableProjectContent();
}

async function activateProjectEditMode(preferredSlug?: string | null): Promise<void> {
  let slug = getActiveProjectSlug();
  if (!slug) {
    slug = preferredSlug ?? null;
  }

  const homepageRuntime = getHomepageRuntime() ?? await waitForHomepageRuntime(1500);
  if (homepageRuntime && slug) {
    slug = await homepageRuntime.waitForProjectReady(slug, 2500);
  }

  if (!slug || !hasEditableProjectContent()) {
    return;
  }

  if (!window.EditMode) {
    await loadEditModeScripts();
  }
  window.EditMode?.init(slug);
}

// ========== SCRIPT LOADING ==========

/**
 * Load edit mode CSS immediately (for button styling)
 */
function loadEditModeCSS(): void {
  EDIT_MODE_STYLE_HREFS.forEach((href) => {
    const alreadyLoaded = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
      .some((link) => {
        const currentHref = link.getAttribute('href') || '';
        return currentHref === href || currentHref.endsWith(href);
      });
    if (alreadyLoaded) return;

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  });
}

/**
 * Ensure edit mode modules are ready
 * In the generated runtime build, all modules are already loaded via /static/build/edit.js
 */
function loadEditModeScripts(): Promise<void> {
  return new Promise((resolve) => {
    loadEditModeCSS();
    // All edit modules are already loaded by the generated edit runtime.
    // Just resolve immediately
    resolve();
  });
}

// ========== UI CONTROLS ==========

function attachHomepageProjectControlHandlers(): void {
  const editBtn = document.querySelector<HTMLButtonElement>('[data-homepage-edit-project]');
  if (!editBtn || editBtn.dataset.editHandlersAttached === 'true') return;

  editBtn.dataset.editHandlersAttached = 'true';
  editBtn.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    await activateProjectEditMode(editBtn.dataset.projectSlug || getActiveProjectSlug());
  });
}

function initHeaderNavCompaction(): void {
  const mainHeader = document.querySelector<HTMLElement>('#main-header');
  const nav = mainHeader?.querySelector<HTMLElement>('nav');
  if (!mainHeader || !nav) return;

  const updateCompaction = (): void => {
    nav.classList.remove('compact-edit-actions');
    if (!nav.querySelector('.new-project-btn, .show-drafts-toggle')) return;

    if (mainHeader.scrollWidth > mainHeader.clientWidth + 1) {
      nav.classList.add('compact-edit-actions');
    }
  };

  const scheduleCompactionUpdate = (): void => {
    if (headerCompactionFrame !== null) {
      cancelAnimationFrame(headerCompactionFrame);
    }
    headerCompactionFrame = requestAnimationFrame(() => {
      headerCompactionFrame = null;
      updateCompaction();
    });
  };

  scheduleCompactionUpdate();

  if (!headerCompactionResizeHandlerBound) {
    window.addEventListener('resize', scheduleCompactionUpdate, { passive: true });
    headerCompactionResizeHandlerBound = true;
  }

  if (typeof ResizeObserver !== 'undefined') {
    headerCompactionObserver?.disconnect();
    headerCompactionObserver = new ResizeObserver(scheduleCompactionUpdate);
    headerCompactionObserver.observe(mainHeader);
    headerCompactionObserver.observe(nav);
  }
}

/**
 * Add new project button to header (or Edit button on /me page)
 */
function addNewProjectButton(): void {
  const header = document.querySelector<HTMLElement>('#main-header nav');
  if (!header || header.querySelector('.new-project-btn')) return;

  const isAboutPage = window.location.pathname === '/me';
  const buttonLabel = isAboutPage ? 'Edit' : 'New Project';
  const buttonIcon = isAboutPage ? EDIT_ICON : NEW_PROJECT_ICON;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'new-project-btn';
  btn.title = buttonLabel;
  btn.setAttribute('aria-label', buttonLabel);
  btn.innerHTML = `${buttonIcon}<span class="btn-label">${buttonLabel}</span>`;
  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (isAboutPage) {
      if (!window.EditMode) {
        await loadEditModeScripts();
      }
      if (window.EditMode) {
        window.EditMode.initAbout();
      }
    } else {
      if (!window.ProjectCreate) {
        await loadEditModeScripts();
      }
      window.ProjectCreate?.show();
    }
  });

  header.insertBefore(btn, header.firstChild);
}

/**
 * Add "Show Drafts" / "Hide Drafts" toggle to header nav (home page only)
 */
function addShowDraftsToggle(): void {
  if (window.location.pathname !== '/') return;

  const header = document.querySelector<HTMLElement>('#main-header nav');
  if (!header || header.querySelector('.show-drafts-toggle')) return;

  const isActive = isShowDraftsActive();

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'show-drafts-toggle' + (isActive ? ' active' : '');
  btn.title = 'Drafts';
  btn.setAttribute('aria-label', isActive ? 'Hide drafts' : 'Show drafts');
  btn.innerHTML = `${DRAFTS_ICON}<span class="btn-label">Drafts</span>`;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const url = new URL(window.location.href);
    if (isActive) {
      url.searchParams.delete('show_drafts');
      sessionStorage.removeItem(SHOW_DRAFTS_KEY);
    } else {
      url.searchParams.set('show_drafts', 'true');
      sessionStorage.setItem(SHOW_DRAFTS_KEY, 'true');
    }
    window.location.href = url.toString();
  });

  const newProjectBtn = header.querySelector('.new-project-btn');
  if (newProjectBtn) {
    header.insertBefore(btn, newProjectBtn);
  } else {
    header.insertBefore(btn, header.firstChild);
  }
}

// ========== KEYBOARD SHORTCUTS ==========

/**
 * Cmd/Ctrl + E keyboard shortcut to enter edit mode
 */
function initEditModeKeyboardShortcut(): void {
  document.addEventListener('keydown', async function(event) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'e') {
      if (document.body.classList.contains('editing')) return;

      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        return;
      }

      event.preventDefault();

      const pathname = window.location.pathname;

      if (pathname === '/me') {
        const url = new URL(window.location.href);
        url.searchParams.set('edit', '');
        window.history.replaceState(window.history.state, '', url.toString());

        if (!window.EditMode) {
          await loadEditModeScripts();
        }
        if (window.EditMode) {
          window.EditMode.initAbout();
        }
        return;
      }

      const url = new URL(window.location.href);
      url.searchParams.set('edit', '');
      window.history.replaceState(window.history.state, '', url.toString());

      await activateProjectEditMode(getActiveProjectSlug());
    }
  });
}

async function bootProjectEditFromUrl(): Promise<void> {
  const pathname = window.location.pathname;
  if (pathname === '/me') {
    return;
  }

  const urlParams = new URLSearchParams(window.location.search);
  if (!urlParams.has('edit') && !urlParams.has('settings')) {
    return;
  }

  if (urlParams.has('settings')) {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete('settings');
    nextUrl.searchParams.set('edit', '');
    window.history.replaceState(window.history.state, '', nextUrl.toString());
  }

  await activateProjectEditMode(readProjectSlugFromPath());
}

// ========== INITIALIZATION ==========

function initializeEditMode(): void {
  restorePersistedScroll();

  // Trigger sync of show_drafts from URL to sessionStorage
  isShowDraftsActive();

  if (window.location.pathname === '/') {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('show_drafts') && isShowDraftsActive()) {
      const url = new URL(window.location.href);
      url.searchParams.set('show_drafts', 'true');
      window.location.replace(url.toString());
      return;
    }
  }

  loadEditModeCSS();

  addNewProjectButton();
  addShowDraftsToggle();
  initHeaderNavCompaction();
  attachHomepageProjectControlHandlers();

  if (window.location.pathname === '/me') {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('edit')) {
      setTimeout(async () => {
        if (!window.EditMode) {
          await loadEditModeScripts();
        }
        if (window.EditMode) {
          window.EditMode.initAbout();
        }
      }, 100);
    }
  }

  void bootProjectEditFromUrl();

  initEditModeKeyboardShortcut();
}

// ========== ENTRY POINT ==========

export function init(): void {
  if (!isDevMode()) return;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeEditMode);
  } else {
    initializeEditMode();
  }
}

const EditBootstrap = {
  init,
  loadEditModeScripts,
  loadEditModeCSS,
  isShowDraftsActive,
  buildUrlWithShowDrafts,
};

export default EditBootstrap;

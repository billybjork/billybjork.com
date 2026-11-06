import { isShowDraftsActive, setShowDraftsRemembered } from './show-drafts';
import { isEditingActive } from '../core/edit-state';
import { getHomepageRuntime, waitForHomepageRuntime } from '../core/runtime-registry';
import { restorePersistedScroll } from './scroll';
import { openEditor } from './session';
import { aboutPage, projectPage } from './page-adapter';
import { ABOUT_PATH, findProjectContent, isAboutPage } from './page-content';
import { showProjectCreateDialog } from './project-create';
import { ICONS } from './icons';

const EDIT_STYLESHEETS = ['edit-mode-base.css', 'edit-mode-project.css', 'edit-mode-extras.css'];

let headerCompactionObserver: ResizeObserver | null = null;
let headerCompactionResizeHandlerBound = false;
let headerCompactionFrame: number | null = null;

function readProjectSlugFromPath(): string | null {
  const pathname = window.location.pathname.replace(/\/+$/, '');
  if (!pathname || pathname === '/' || pathname === ABOUT_PATH) {
    return null;
  }

  const slug = decodeURIComponent(pathname.slice(1)).trim();
  return slug && !slug.includes('/') ? slug : null;
}

function getActiveProjectSlug(): string | null {
  const homepageSlug = getHomepageRuntime()?.getOpenProjectSlug();
  return homepageSlug || readProjectSlugFromPath();
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

  if (!slug || !findProjectContent()) {
    return;
  }

  await openEditor(projectPage(slug));
}

/** /static is served immutable, so these carry the version the server gave edit.js. */
function loadEditModeCSS(): void {
  const editScript = document.querySelector<HTMLScriptElement>('script[src*="build/edit.js"]');
  const version = editScript ? new URL(editScript.src, window.location.href).search : '';
  EDIT_STYLESHEETS.forEach((name) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `/static/css/${name}${version}`;
    document.head.appendChild(link);
  });
}

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

  const onAboutPage = isAboutPage();
  const buttonLabel = onAboutPage ? 'Edit' : 'New Project';
  const buttonIcon = onAboutPage ? ICONS.edit : ICONS.newProject;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'new-project-btn';
  btn.title = buttonLabel;
  btn.setAttribute('aria-label', buttonLabel);
  btn.innerHTML = `${buttonIcon}<span class="btn-label">${buttonLabel}</span>`;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    if (onAboutPage) {
      void openEditor(aboutPage());
    } else {
      showProjectCreateDialog();
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
  btn.innerHTML = `${ICONS.drafts}<span class="btn-label">Drafts</span>`;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const url = new URL(window.location.href);
    if (isActive) {
      url.searchParams.delete('show_drafts');
      setShowDraftsRemembered(false);
    } else {
      url.searchParams.set('show_drafts', 'true');
      setShowDraftsRemembered(true);
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

/**
 * Cmd/Ctrl + E keyboard shortcut to enter edit mode
 */
function initEditModeKeyboardShortcut(): void {
  document.addEventListener('keydown', async function(event) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'e') {
      if (isEditingActive()) return;

      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
        return;
      }

      event.preventDefault();

      if (isAboutPage()) {
        void openEditor(aboutPage());
      } else {
        await activateProjectEditMode(getActiveProjectSlug());
      }
    }
  });
}

function openEditorFromUrl(): void {
  if (!new URLSearchParams(window.location.search).has('edit')) return;
  if (isAboutPage()) {
    void openEditor(aboutPage());
  } else {
    void activateProjectEditMode(readProjectSlugFromPath());
  }
}

function initializeEditMode(): void {
  restorePersistedScroll();

  // Also syncs the show_drafts query parameter into the tab's memory.
  const showDrafts = isShowDraftsActive();

  if (window.location.pathname === '/') {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('show_drafts') && showDrafts) {
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

  openEditorFromUrl();
  initEditModeKeyboardShortcut();
}

export function init(): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeEditMode);
  } else {
    initializeEditMode();
  }
}

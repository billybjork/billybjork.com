/**
 * Edit Mode Bootstrap (Dev Only)
 * Provides edit-mode UI controls and keyboard shortcuts.
 * Only activates on localhost — no-op in production.
 */

import { isDevMode, isShowDraftsActive } from '../core/utils';

// ========== CONSTANTS ==========

const SHOW_DRAFTS_KEY = 'bb_show_drafts';

// ========== HELPERS ==========

function isIsolationMode(): boolean {
  return document.body.dataset.isolationMode === 'true';
}

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

// ========== SCRIPT LOADING ==========

/**
 * Load edit mode CSS immediately (for button styling)
 */
function loadEditModeCSS(): void {
  if (document.querySelector('link[href*="edit-mode.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/static/css/edit-mode.css';
  document.head.appendChild(link);
}

/**
 * Ensure edit mode modules are ready
 * In the bundled version, all modules are already loaded via edit-bundle.js
 */
function loadEditModeScripts(): Promise<void> {
  return new Promise((resolve) => {
    loadEditModeCSS();
    // All edit modules are already bundled and available on window
    // Just resolve immediately
    resolve();
  });
}

// ========== UI CONTROLS ==========

/**
 * Add project controls (Edit, Settings) to an active project item.
 */
function addProjectControls(projectItem: HTMLElement): void {
  const slug = projectItem.dataset.slug;
  if (!slug) return;

  if (projectItem.querySelector('.edit-buttons')) return;

  const editBtns = document.createElement('div');
  editBtns.className = 'edit-buttons';

  const editBtn = document.createElement('button');
  editBtn.className = 'edit-btn-action';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isIsolationMode()) {
      window.location.href = buildUrlWithShowDrafts(`/${slug}`, { edit: '' });
      return;
    }

    if (!window.EditMode) {
      await loadEditModeScripts();
    }
    window.EditMode?.init(slug);
  });

  const settingsBtn = document.createElement('button');
  settingsBtn.className = 'edit-btn-action edit-btn-settings';
  settingsBtn.innerHTML = '&#9881;';
  settingsBtn.title = 'Project Settings';
  settingsBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!window.ProjectSettings) {
      await loadEditModeScripts();
    }
    (window.ProjectSettings as { show?: (slug: string) => void })?.show?.(slug);
  });

  editBtns.appendChild(editBtn);
  editBtns.appendChild(settingsBtn);
  projectItem.appendChild(editBtns);
}

function removeProjectControls(projectItem: HTMLElement): void {
  const editBtns = projectItem.querySelector('.edit-buttons');
  if (editBtns) {
    editBtns.remove();
  }
}

/**
 * Add new project button to header (or Edit button on /me page)
 */
function addNewProjectButton(): void {
  const header = document.querySelector<HTMLElement>('#main-header nav');
  if (!header || header.querySelector('.new-project-btn')) return;

  const isAboutPage = window.location.pathname === '/me';

  const btn = document.createElement('button');
  btn.className = 'new-project-btn';
  btn.textContent = isAboutPage ? 'Edit' : '+ New Project';
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
      (window.ProjectCreate as { show?: () => void })?.show?.();
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
  btn.className = 'show-drafts-toggle' + (isActive ? ' active' : '');
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" style="width:14px;height:14px;vertical-align:-2px;margin-right:5px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>Drafts';
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
        window.history.replaceState({}, '', url);

        if (!window.EditMode) {
          await loadEditModeScripts();
        }
        if (window.EditMode) {
          window.EditMode.initAbout();
        }
        return;
      }

      const projectItem = document.querySelector<HTMLElement>('.project-item.active');
      if (projectItem) {
        const slug = projectItem.dataset.slug;
        if (slug) {
          if (!isIsolationMode()) {
            window.location.href = buildUrlWithShowDrafts(`/${slug}`, { edit: '' });
            return;
          }

          if (!window.EditMode) {
            await loadEditModeScripts();
          }
          window.EditMode?.init(slug);
        }
      }
    }
  });
}

// ========== INITIALIZATION ==========

function initializeEditMode(): void {
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

  document.querySelectorAll<HTMLElement>('.project-item.active').forEach(addProjectControls);

  document.body.addEventListener('project:afterSwap', (event) => {
    const customEvent = event as CustomEvent<{ element?: HTMLElement; isOpen?: boolean }>;
    const { element, isOpen } = customEvent.detail;

    if (element?.classList?.contains('project-details')) {
      const projectItem = element.closest<HTMLElement>('.project-item');
      if (projectItem) {
        if (isOpen) {
          setTimeout(() => addProjectControls(projectItem), 50);
        } else {
          removeProjectControls(projectItem);
        }
      }
    }
  });

  if (isIsolationMode()) {
    const urlParams = new URLSearchParams(window.location.search);
    const projectItem = document.querySelector<HTMLElement>('.project-item.active');
    const slug = projectItem?.dataset.slug;

    if (slug) {
      if (urlParams.has('edit')) {
        setTimeout(async () => {
          if (!window.EditMode) {
            await loadEditModeScripts();
          }
          window.EditMode?.init(slug);
        }, 100);
      } else if (urlParams.has('settings')) {
        window.history.replaceState({}, '', buildUrlWithShowDrafts(`/${slug}`));
        setTimeout(async () => {
          if (!window.ProjectSettings) {
            await loadEditModeScripts();
          }
          (window.ProjectSettings as { show?: (slug: string) => void })?.show?.(slug);
        }, 100);
      }
    }
  }

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

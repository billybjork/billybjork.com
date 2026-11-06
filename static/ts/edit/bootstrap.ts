import { projectSlugFromPath } from '../core/project-path';
import { isEditingActive } from '../core/edit-state';
import { getHomepageRuntime, waitForHomepageRuntime } from '../core/runtime-registry';
import { ICONS } from './icons';
import { aboutPage, projectPage } from './page-adapter';
import { ABOUT_PATH, findProjectContent, isAboutPage } from './page-content';
import { showProjectCreateDialog } from './project-create';
import { restorePersistedScroll } from './scroll';
import { openEditor } from './session';
import { isShowDraftsActive, setShowDraftsRemembered } from './show-drafts';

const EDIT_STYLESHEETS = ['edit-mode-base.css', 'edit-mode-project.css', 'edit-mode-extras.css'];
const HOMEPAGE_RUNTIME_WAIT_MS = 1500;
const PROJECT_READY_WAIT_MS = 2500;

async function editProject(fallbackSlug: string | null = null): Promise<void> {
  let slug = getHomepageRuntime()?.getOpenProjectSlug() || projectSlugFromPath(window.location.pathname) || fallbackSlug;

  const runtime = getHomepageRuntime() ?? await waitForHomepageRuntime(HOMEPAGE_RUNTIME_WAIT_MS);
  if (runtime && slug) {
    slug = await runtime.waitForProjectReady(slug, PROJECT_READY_WAIT_MS);
  }

  if (slug && findProjectContent()) {
    await openEditor(projectPage(slug));
  }
}

function editCurrentPage(): void {
  void (isAboutPage() ? openEditor(aboutPage()) : editProject());
}

/** /static is served immutable, so these carry the version the server gave edit.js. */
function loadEditorStylesheets(): void {
  const editScript = document.querySelector<HTMLScriptElement>('script[src*="build/edit.js"]');
  const version = editScript ? new URL(editScript.src, window.location.href).search : '';
  EDIT_STYLESHEETS.forEach((name) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `/static/css/${name}${version}`;
    document.head.appendChild(link);
  });
}

function attachHomepageEditButton(): void {
  const button = document.querySelector<HTMLButtonElement>('[data-homepage-edit-project]');
  button?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void editProject(button.dataset.projectSlug || null);
  });
}

/** Collapses the injected buttons to icons when the header would otherwise overflow. */
function compactHeaderWhenCrowded(): void {
  const header = document.querySelector<HTMLElement>('#main-header');
  const nav = header?.querySelector<HTMLElement>('nav');
  if (!header || !nav) return;

  let frame: number | null = null;
  const schedule = (): void => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = null;
      nav.classList.remove('compact-edit-actions');
      if (header.scrollWidth > header.clientWidth + 1) {
        nav.classList.add('compact-edit-actions');
      }
    });
  };

  schedule();
  window.addEventListener('resize', schedule, { passive: true });
  const observer = new ResizeObserver(schedule);
  observer.observe(header);
  observer.observe(nav);
}

function createHeaderButton(className: string, label: string, ariaLabel: string, icon: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.title = label;
  button.setAttribute('aria-label', ariaLabel);
  button.innerHTML = `${icon}<span class="btn-label">${label}</span>`;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    onClick();
  });
  return button;
}

function addHeaderButtons(): void {
  const nav = document.querySelector<HTMLElement>('#main-header nav');
  if (!nav) return;

  const primary = isAboutPage()
    ? createHeaderButton('new-project-btn', 'Edit', 'Edit', ICONS.edit, editCurrentPage)
    : createHeaderButton('new-project-btn', 'New Project', 'New Project', ICONS.newProject, showProjectCreateDialog);
  nav.prepend(primary);

  if (window.location.pathname === '/') {
    const active = isShowDraftsActive();
    const drafts = createHeaderButton(
      `show-drafts-toggle${active ? ' active' : ''}`,
      'Drafts',
      active ? 'Hide drafts' : 'Show drafts',
      ICONS.drafts,
      () => {
        const url = new URL(window.location.href);
        if (active) {
          url.searchParams.delete('show_drafts');
        } else {
          url.searchParams.set('show_drafts', 'true');
        }
        setShowDraftsRemembered(!active);
        window.location.href = url.toString();
      },
    );
    nav.prepend(drafts);
  }
}

function listenForEditShortcut(): void {
  document.addEventListener('keydown', (event) => {
    if (!(event.metaKey || event.ctrlKey) || event.key !== 'e' || isEditingActive()) return;

    const active = document.activeElement;
    if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA') return;

    event.preventDefault();
    editCurrentPage();
  });
}

function start(): void {
  restorePersistedScroll();

  // Reading it also remembers a show_drafts query parameter for the tab.
  const showDrafts = isShowDraftsActive();
  if (window.location.pathname === '/' && showDrafts && !new URLSearchParams(window.location.search).has('show_drafts')) {
    const url = new URL(window.location.href);
    url.searchParams.set('show_drafts', 'true');
    window.location.replace(url.toString());
    return;
  }

  loadEditorStylesheets();
  addHeaderButtons();
  compactHeaderWhenCrowded();
  attachHomepageEditButton();
  listenForEditShortcut();

  if (new URLSearchParams(window.location.search).has('edit')) {
    editCurrentPage();
  }
}

export function init(): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
}

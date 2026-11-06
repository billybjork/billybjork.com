import { projectSlugFromPath } from '../core/project-path';
import { isEditingActive } from '../core/edit-state';
import { isShowDraftsActive, rememberShowDrafts, withoutShowDrafts, withShowDrafts } from '../core/show-drafts';
import { getHomepageRuntime } from '../core/runtime-registry';
import { ICONS } from './icons';
import { aboutPage, projectPage } from './page-adapter';
import { isAboutPage } from './page-content';
import { showProjectCreateDialog } from './project-create';
import { restorePersistedScroll } from './scroll';
import { openEditor } from './session';

/** Only the homepage template mounts projects, so a page without its runtime has none to edit. */
async function editProject(): Promise<void> {
  const runtime = getHomepageRuntime();
  const slug = runtime?.getOpenProjectSlug() || projectSlugFromPath(window.location.pathname);
  if (!runtime || !slug) return;

  const readySlug = await runtime.waitForProjectReady(slug);
  if (readySlug) await openEditor(projectPage(readySlug));
}

function editCurrentPage(): void {
  void (isAboutPage() ? openEditor(aboutPage()) : editProject());
}

function attachHomepageEditButton(): void {
  const button = document.querySelector<HTMLButtonElement>('[data-homepage-edit-project]');
  button?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    void editProject();
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
        rememberShowDrafts(!active);
        window.location.href = active ? withoutShowDrafts(window.location.href) : withShowDrafts(window.location.href);
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

/** edit.js is deferred, so the document is parsed and homepage.js has already run. */
export function init(): void {
  restorePersistedScroll();

  const showDrafts = isShowDraftsActive();
  rememberShowDrafts(showDrafts);
  if (window.location.pathname === '/' && showDrafts && !window.location.search.includes('show_drafts')) {
    window.location.replace(withShowDrafts(window.location.href));
    return;
  }

  addHeaderButtons();
  compactHeaderWhenCrowded();
  attachHomepageEditButton();
  listenForEditShortcut();

  if (new URLSearchParams(window.location.search).has('edit')) {
    editCurrentPage();
  }
}

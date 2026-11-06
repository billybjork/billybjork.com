import { ICONS } from './icons';
import type { SaveStatus } from './save';
import { escapeHtml } from './text';

const STATUS_TEXT: Record<SaveStatus, string> = {
  unchanged: 'No unsaved changes',
  pending: '(unsaved)',
  saving: 'Saving...',
  saved: 'All changes saved',
  error: 'Save failed',
  conflict: 'Conflict',
};

const SAVE_BUTTON_CLASS: Partial<Record<SaveStatus, string>> = {
  pending: 'has-changes',
  saving: 'is-saving',
  error: 'has-error',
  conflict: 'has-error',
};

interface ToolbarActions {
  undo(): void;
  redo(): void;
  discard(): void;
  save(): void;
  deleteContent?: () => void;
}

interface FixedToolbar {
  setStatus(status: SaveStatus): void;
  setTitle(title: string): void;
}

export function createFixedToolbar(title: string, actions: ToolbarActions, signal: AbortSignal): FixedToolbar {
  const bar = document.createElement('div');
  bar.className = 'edit-mode-toolbar edit-mode-toolbar-fixed';
  // Keeps the bar pinned on a ?edit load, where it renders before the stylesheets arrive.
  bar.style.cssText = 'position: fixed; inset: 0 0 auto 0; z-index: 1200';
  const deleteButton = actions.deleteContent
    ? `<button class="edit-btn edit-btn-icon edit-btn-icon-danger" data-action="delete" aria-label="Delete project" title="Delete project">${ICONS.trash}</button>`
    : '';
  bar.innerHTML = `
    <div class="edit-toolbar-left">
      <span class="edit-project-name">Editing: ${escapeHtml(title)}</span>
      <span class="edit-status" aria-live="polite"></span>
    </div>
    <div class="edit-toolbar-right">
      ${deleteButton}
      <button class="edit-btn edit-btn-icon" data-action="undo" aria-label="Undo" title="Undo (Cmd/Ctrl+Z)">${ICONS.undo}</button>
      <button class="edit-btn edit-btn-icon" data-action="redo" aria-label="Redo" title="Redo (Cmd/Ctrl+Shift+Z / Cmd/Ctrl+Y)">${ICONS.redo}</button>
      <button class="edit-btn edit-btn-secondary" data-action="cancel">Discard</button>
      <button class="edit-btn edit-btn-primary" data-action="save">Save</button>
    </div>
  `;

  const button = (action: string): HTMLButtonElement | null => bar.querySelector(`[data-action="${action}"]`);
  const on = (action: string, handler: (() => void) | undefined): void => {
    if (handler) button(action)?.addEventListener('click', () => handler());
  };
  on('undo', actions.undo);
  on('redo', actions.redo);
  on('cancel', actions.discard);
  on('save', actions.save);
  on('delete', actions.deleteContent);
  // Undo and redo must not take focus from the field whose edits they act on.
  for (const action of ['undo', 'redo']) {
    button(action)?.addEventListener('mousedown', (event) => event.preventDefault());
  }
  document.body.appendChild(bar);

  const updateLayoutOffset = (): void => {
    const offset = Math.max(56, Math.ceil(bar.getBoundingClientRect().height) + 8);
    document.documentElement.style.setProperty('--edit-toolbar-offset', `${offset}px`);
  };
  window.addEventListener('resize', updateLayoutOffset, { passive: true, signal });
  window.addEventListener('orientationchange', updateLayoutOffset, { signal });
  window.visualViewport?.addEventListener('resize', updateLayoutOffset, { signal });

  const setStatus = (status: SaveStatus): void => {
    const statusEl = bar.querySelector<HTMLElement>('.edit-status');
    if (statusEl) {
      statusEl.textContent = STATUS_TEXT[status];
      statusEl.dataset.status = status;
    }

    const saveButton = button('save');
    if (saveButton) {
      saveButton.classList.remove('has-changes', 'is-saving', 'has-error');
      const stateClass = SAVE_BUTTON_CLASS[status];
      if (stateClass) saveButton.classList.add(stateClass);
      saveButton.disabled = status === 'saving';
      saveButton.textContent = status === 'saving' ? 'Saving...' : 'Save';
    }
    updateLayoutOffset();
  };

  setStatus('unchanged');

  return {
    setStatus,
    setTitle(nextTitle) {
      const nameEl = bar.querySelector('.edit-project-name');
      if (nameEl) nameEl.textContent = `Editing: ${nextTitle}`;
    },
  };
}

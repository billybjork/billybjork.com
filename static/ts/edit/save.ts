import type { SaveResult } from '../types/api';
import { blocksToMarkdown } from './blocks';
import { showNotification } from './notify';
import type { PageAdapter } from './page-adapter';
import type { BlockStore } from './store';

export type SaveStatus = 'unchanged' | 'pending' | 'saving' | 'saved' | 'error' | 'conflict';

type SaveAction = 'edit' | 'save_start' | 'save_ok' | 'save_error' | 'conflict' | 'fade';

const AUTO_SAVE_DELAY_MS = 2000;
const RETRY_DELAY_MS = 5000;
const SAVED_FADE_DELAY_MS = 3000;

function nextStatus(status: SaveStatus, action: SaveAction): SaveStatus {
  switch (action) {
    case 'edit':
      return 'pending';
    case 'save_start':
      return status === 'conflict' ? status : 'saving';
    case 'save_ok':
      return 'saved';
    case 'save_error':
      return 'error';
    case 'conflict':
      return 'conflict';
    case 'fade':
      return status === 'saved' ? 'unchanged' : status;
  }
}

interface SaveController {
  isDirty(): boolean;
  markDirty(): void;
  /** The Save button: saves if needed, then leaves through `exit`. */
  saveAndExit(): Promise<void>;
  /** Ends timers and any request in flight, so nothing saves after the user has left. */
  stop(): void;
}

interface SaveDeps {
  page: PageAdapter;
  store: BlockStore;
  revision: string | null;
  onStatus(status: SaveStatus): void;
  exit(): void;
}

export function createSaveController({ page, store, revision: initialRevision, onStatus, exit }: SaveDeps): SaveController {
  let dirty = false;
  let status: SaveStatus = 'unchanged';
  let revision = initialRevision;
  let autoSaveTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: AbortController | null = null;

  const dispatch = (action: SaveAction): void => {
    status = nextStatus(status, action);
    onStatus(status);
    clearTimeout(fadeTimer);
    if (status === 'saved') {
      fadeTimer = setTimeout(() => dispatch('fade'), SAVED_FADE_DELAY_MS);
    }
  };

  /** The one save request. Resolves 'conflict' on a stale revision and throws on any other failure. */
  const save = async ({ force = false, signal }: { force?: boolean; signal?: AbortSignal }): Promise<'saved' | 'conflict'> => {
    const body = page.saveBody({
      markdown: blocksToMarkdown(store.blocks),
      stamp: force ? { force: true } : { base_revision: revision },
      cleanupCandidates: store.cleanupCandidates(),
    });
    const response = await fetch(page.saveRoute, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });

    if (response.status === 409) return 'conflict';
    if (!response.ok) throw new Error(`Save failed: ${response.status}`);

    const result = await response.json() as SaveResult;
    if (result.revision) revision = result.revision;
    store.clearCleanupCandidates();
    page.onSaved(result);
    dirty = false;
    return 'saved';
  };

  const clearPendingSaves = (): void => {
    clearTimeout(autoSaveTimer);
    clearTimeout(retryTimer);
    inFlight?.abort();
  };

  const attemptSave = async (force: boolean): Promise<'saved' | 'conflict' | 'failed' | 'superseded'> => {
    clearPendingSaves();
    inFlight = new AbortController();
    dispatch('save_start');

    try {
      const outcome = await save({ force, signal: inFlight.signal });
      if (outcome === 'conflict') {
        dispatch('conflict');
        showConflictBanner();
        return 'conflict';
      }
      dispatch('save_ok');
      return 'saved';
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return 'superseded';
      console.error('Save failed:', error);
      dispatch('save_error');
      return 'failed';
    }
  };

  const autoSave = async (): Promise<void> => {
    if (!dirty || status === 'saving' || status === 'conflict') return;
    if (await attemptSave(false) === 'failed') {
      retryTimer = setTimeout(() => {
        if (status === 'error' && dirty) void autoSave();
      }, RETRY_DELAY_MS);
    }
  };

  const showConflictBanner = (): void => {
    document.querySelector('.edit-conflict-banner')?.remove();

    const banner = document.createElement('div');
    banner.className = 'edit-conflict-banner';
    banner.innerHTML = `
      <span class="edit-conflict-message">Content was modified in another session</span>
      <button class="edit-conflict-btn edit-conflict-keep">Keep mine</button>
      <button class="edit-conflict-btn edit-conflict-reload">Load theirs</button>
    `;
    banner.querySelector('.edit-conflict-keep')?.addEventListener('click', async () => {
      banner.remove();
      const outcome = await attemptSave(true);
      if (outcome === 'saved') showNotification('Changes saved (overwritten)', 'success');
      if (outcome === 'failed') showNotification('Force save failed', 'error');
    });
    banner.querySelector('.edit-conflict-reload')?.addEventListener('click', () => {
      banner.remove();
      exit();
    });
    document.body.appendChild(banner);
  };

  return {
    isDirty: () => dirty,

    markDirty() {
      dirty = true;
      dispatch('edit');
      clearTimeout(autoSaveTimer);
      clearTimeout(retryTimer);
      autoSaveTimer = setTimeout(() => void autoSave(), AUTO_SAVE_DELAY_MS);
    },

    async saveAndExit() {
      if (!dirty && status !== 'error') {
        exit();
        return;
      }
      const outcome = await attemptSave(false);
      if (outcome === 'saved') exit();
      if (outcome === 'failed') showNotification('Failed to save', 'error');
    },

    stop() {
      clearPendingSaves();
      clearTimeout(fadeTimer);
    },
  };
}

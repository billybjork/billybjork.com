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

type SaveOutcome = 'saved' | 'conflict' | 'failed' | 'aborted';

export function createSaveController({ page, store, revision: initialRevision, onStatus, exit }: SaveDeps): SaveController {
  let dirty = false;
  let editCount = 0;
  let status: SaveStatus = 'unchanged';
  let revision = initialRevision;
  let stopped = false;
  let autoSaveTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let fadeTimer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: { finished: Promise<SaveOutcome>; controller: AbortController } | null = null;

  const dispatch = (action: SaveAction): void => {
    status = nextStatus(status, action);
    onStatus(status);
    clearTimeout(fadeTimer);
    if (status === 'saved') {
      fadeTimer = setTimeout(() => dispatch('fade'), SAVED_FADE_DELAY_MS);
    }
  };

  /** The one save request. Only what it sent counts as saved: an edit made meanwhile stays dirty. */
  const save = async ({ force, signal }: { force: boolean; signal: AbortSignal }): Promise<'saved' | 'conflict'> => {
    const editsSent = editCount;
    const candidatesSent = store.cleanupCandidates();
    const body = page.saveBody({
      markdown: blocksToMarkdown(store.blocks),
      stamp: force ? { force: true } : { base_revision: revision },
      cleanupCandidates: candidatesSent,
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
    store.forgetCleanupCandidates(candidatesSent);
    page.onSaved(result);
    if (editCount === editsSent) dirty = false;
    return 'saved';
  };

  const clearSaveTimers = (): void => {
    clearTimeout(autoSaveTimer);
    clearTimeout(retryTimer);
  };

  const sendSave = (force: boolean): Promise<SaveOutcome> => {
    const controller = new AbortController();
    dispatch('save_start');

    const finished = (async (): Promise<SaveOutcome> => {
      try {
        const outcome = await save({ force, signal: controller.signal });
        if (outcome === 'conflict') {
          dispatch('conflict');
          showConflictBanner();
        } else if (!dirty) {
          dispatch('save_ok');
        }
        return outcome;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return 'aborted';
        console.error('Save failed:', error);
        dispatch('save_error');
        return 'failed';
      }
    })();

    inFlight = { finished, controller };
    void finished.finally(() => {
      if (inFlight?.finished === finished) inFlight = null;
    });
    return finished;
  };

  /**
   * Saves run one at a time. A save in flight may already have reached the server, so aborting it
   * and resending its base revision could conflict with itself; the next one waits and builds on it.
   */
  const attemptSave = async (force: boolean): Promise<SaveOutcome> => {
    clearSaveTimers();

    while (inFlight) {
      const previous = await inFlight.finished;
      if (stopped) return 'aborted';
      if (!force && previous === 'conflict') return 'conflict';
      if (!force && previous === 'saved' && !dirty) return 'saved';
    }
    return sendSave(force);
  };

  const autoSave = async (): Promise<void> => {
    if (!dirty || status === 'conflict') return;
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
      editCount += 1;
      dispatch('edit');
      clearSaveTimers();
      autoSaveTimer = setTimeout(() => void autoSave(), AUTO_SAVE_DELAY_MS);
    },

    async saveAndExit() {
      if (!dirty && status !== 'error') {
        exit();
        return;
      }
      let outcome = await attemptSave(false);
      while (outcome === 'saved' && dirty) {
        outcome = await attemptSave(false);
      }
      if (outcome === 'saved') exit();
      if (outcome === 'failed') showNotification('Failed to save', 'error');
    },

    stop() {
      stopped = true;
      clearSaveTimers();
      inFlight?.controller.abort();
      clearTimeout(fadeTimer);
    },
  };
}

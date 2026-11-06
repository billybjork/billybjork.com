import { API } from './api';
import { parseIntoBlocks } from './blocks';
import { renderBlocks, runSlashSelection } from './block-shell';
import type { EditorContext } from './context';
import { createHistory } from './history';
import { createInlineToolbar } from './inline-toolbar';
import { createMediaController } from './media-selection';
import { showNotification } from './notify';
import type { LoadedContent, PageAdapter } from './page-adapter';
import { createSaveController } from './save';
import { createScrollAnchors, persistScrollForNavigation } from './scroll';
import { createSlashMenu } from './slash';
import { createBlockStore } from './store';
import { createFixedToolbar } from './toolbar';

let sessionStarted = false;

function setEditQuery(editing: boolean): void {
  const url = new URL(window.location.href);
  if (editing) {
    url.searchParams.set('edit', '');
  } else {
    url.searchParams.delete('edit');
  }
  window.history.replaceState(window.history.state, '', url.toString());
}

async function flushCleanupCandidates(urls: string[]): Promise<void> {
  if (urls.length === 0) return;
  try {
    const response = await fetch(API.cleanupAssets, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
      keepalive: true,
    });
    if (!response.ok) console.warn('Asset cleanup request failed:', response.status);
  } catch (error) {
    console.warn('Asset cleanup request failed:', error);
  }
}

function startSession(page: PageAdapter, content: HTMLElement, loaded: LoadedContent): void {
  const sessionListeners = new AbortController();
  const { signal } = sessionListeners;
  const scrollAnchors = createScrollAnchors();
  const restoreReaderPosition = scrollAnchors.captureModeSwitch(content);

  const editorRoot = document.createElement('div');
  editorRoot.className = 'edit-mode-container';
  const blocksRoot = document.createElement('div');
  blocksRoot.className = 'edit-blocks-container';
  editorRoot.appendChild(blocksRoot);

  const markDirty = (): void => {
    save.markDirty();
    history.record();
  };

  const store = createBlockStore(parseIntoBlocks(loaded.markdown), {
    onEdit: markDirty,
    render: () => scrollAnchors.aroundRender(blocksRoot, () => renderBlocks(ctx)),
    tracksAssets: page.tracksAssets,
  });

  const ctx: EditorContext = {
    store,
    blocksRoot,
    media: createMediaController(store, signal),
    slash: createSlashMenu((selection) => runSlashSelection(ctx, selection), signal),
    inlineToolbar: createInlineToolbar(blocksRoot, signal),
    drag: { sourceIndex: null, dropIndex: null },
  };

  /** Everything a session does on the way out; the page is about to navigate. */
  const leave = (navigate: () => void): void => {
    save.stop();
    sessionListeners.abort();
    setEditQuery(false);
    navigate();
  };

  const reloadOutOfEditor = (): void => {
    persistScrollForNavigation();
    leave(() => window.location.reload());
  };

  const discard = async (): Promise<void> => {
    if (save.isDirty() && !confirm('You have unsaved changes. Discard them?')) return;
    save.stop();
    await flushCleanupCandidates(store.cleanupCandidates());
    reloadOutOfEditor();
  };

  const toolbar = createFixedToolbar(page.toolbarTitle(), {
    undo: () => history.undo(),
    redo: () => history.redo(),
    discard: () => void discard(),
    save: () => void save.saveAndExit(),
    deleteContent: page.deleteContent && (() => void page.deleteContent?.(leave)),
  }, signal);

  const save = createSaveController({
    page,
    store,
    revision: loaded.revision,
    onStatus: toolbar.setStatus,
    exit: reloadOutOfEditor,
  });

  const history = createHistory(ctx, () => save.markDirty());

  document.addEventListener('keydown', (event) => {
    if (ctx.slash.handleKeydown(event)) return;

    const command = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (command && !event.altKey && key === 'z') {
      event.preventDefault();
      if (event.shiftKey) {
        history.redo();
      } else {
        history.undo();
      }
    } else if (command && !event.altKey && key === 'y') {
      event.preventDefault();
      history.redo();
    } else if (command && event.key === 's') {
      event.preventDefault();
      void save.saveAndExit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      void discard();
    }
  }, { signal });

  window.addEventListener('beforeunload', (event) => {
    if (save.isDirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }, { signal });

  content.innerHTML = '';
  content.appendChild(editorRoot);
  content.classList.add('edit-mode-active');
  document.body.classList.add('editing');

  page.mountChrome({ content, store, markDirty, setToolbarTitle: toolbar.setTitle });
  renderBlocks(ctx);
  restoreReaderPosition(blocksRoot, page.stabilityRoot(content));
}

/** Opens the editor on a page. A page holds one session; leaving always navigates. */
export async function openEditor(page: PageAdapter): Promise<void> {
  if (sessionStarted) return;
  sessionStarted = true;

  let loaded: LoadedContent;
  try {
    loaded = await page.load();
  } catch (error) {
    console.error(page.loadErrorMessage, error);
    showNotification(page.loadErrorMessage, 'error');
    sessionStarted = false;
    return;
  }

  const content = page.findContent();
  if (!content) {
    console.error('Editor could not find the page content');
    sessionStarted = false;
    return;
  }

  startSession(page, content, loaded);
  setEditQuery(true);
}

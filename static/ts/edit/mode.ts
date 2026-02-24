/**
 * Edit Mode - Main Block Editor
 * Full block editor with drag-drop and slash commands
 * Supports both project pages and the about page
 */

import type { Block, BlockType, Alignment, TextBlock, ImageBlock, VideoBlock, CodeBlock, HtmlBlock, CalloutBlock, RowBlock } from '../types/blocks';
import type { ProjectData, AboutData } from '../types/api';
import {
  isDevMode,
  setupAutoResizeTextarea,
  createImageElement,
  createVideoElement,
  applyVideoPlaybackSettings,
  insertTextWithUndo,
  handleFormattingShortcuts,
  handleListShortcuts,
  showNotification,
  fetchJSON,
} from '../core/utils';
import { createSandboxedIframe, cleanupIframe } from '../utils/html-sandbox';
import EditBlocks, { createBlock, blocksToMarkdown } from './blocks';
import EditSlash from './slash';
import EditMedia, { type VideoUploadProgressUpdate } from './media';
import EditUndo from './undo';

// ========== ICONS ==========

const ICONS = {
  dragHandle: '<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>',
  delete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
  video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 9l5 3-5 3V9z"/></svg>',
  columns: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="4" width="8" height="16" rx="1.5"/><rect x="13" y="4" width="8" height="16" rx="1.5"/></svg>',
  split: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="4" y="3" width="16" height="7" rx="1.5"/><rect x="4" y="14" width="16" height="7" rx="1.5"/></svg>',
  swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 8 16 13"/><line x1="21" y1="8" x2="3" y2="8"/><polyline points="8 21 3 16 8 11"/><line x1="3" y1="16" x2="21" y2="16"/></svg>',
  divider: '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><circle cx="6" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18" cy="12" r="2"/></svg>',
};

// ========== TYPES ==========

type EditModeType = 'project' | 'about' | null;

enum SaveState {
  UNCHANGED = 'unchanged',
  PENDING = 'pending',
  SAVING = 'saving',
  SAVED = 'saved',
  ERROR = 'error',
  CONFLICT = 'conflict',
}

interface DragState {
  sourceIndex: number | null;
  currentDropIndex: number | null;
  isDragging: boolean;
}

interface UpdateBlockOptions {
  render?: boolean;
  markDirty?: boolean;
}

type RowColumnSide = 'left' | 'right';

interface BlockContext {
  index: number;
  rowSide?: RowColumnSide;
}

type SaveAction =
  | { type: 'edit' }
  | { type: 'save_start' }
  | { type: 'save_ok' }
  | { type: 'save_error' }
  | { type: 'conflict' }
  | { type: 'fade' }
  | { type: 'reset' };

// ========== STATE ==========

let blocks: Block[] = [];
let projectSlug: string | null = null;
let projectData: ProjectData | AboutData | null = null;
let isDirty = false;
let isActive = false;
let container: HTMLElement | null = null;
let toolbar: HTMLElement | null = null;
let editMode: EditModeType = null;

// Auto-save state
let saveState: SaveState = SaveState.UNCHANGED;
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
let savedFadeTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let abortController: AbortController | null = null;
const AUTO_SAVE_DELAY = 2000;
const RETRY_DELAY = 5000;
const SAVED_FADE_DELAY = 3000;

// Revision tracking for conflict detection
let currentRevision: string | null = null;

// Drag & Drop state
const dragState: DragState = {
  sourceIndex: null,
  currentDropIndex: null,
  isDragging: false,
};

// ========== INITIALIZATION ==========

/**
 * Initialize edit mode for a project
 */
export async function init(slug: string): Promise<void> {
  if (!isDevMode()) {
    console.log('Edit mode only available on localhost');
    return;
  }

  projectSlug = slug;
  editMode = 'project';
  isActive = true;

  try {
    const data = await fetchJSON<ProjectData & { revision?: string }>(`/api/project/${slug}`);
    projectData = data;
    currentRevision = data.revision ?? null;
    setupEditor(projectData);

    const url = new URL(window.location.href);
    url.searchParams.set('edit', '');
    window.history.replaceState({}, '', url);
  } catch (error) {
    console.error('Failed to load project:', error);
    showNotification('Failed to load project', 'error');
  }
}

/**
 * Initialize edit mode for the about page
 */
export async function initAbout(): Promise<void> {
  if (!isDevMode()) {
    console.log('Edit mode only available on localhost');
    return;
  }

  editMode = 'about';
  projectSlug = null;
  isActive = true;

  try {
    const data = await fetchJSON<AboutData & { revision?: string }>('/api/about');
    projectData = data;
    currentRevision = data.revision ?? null;
    setupEditor(projectData);

    const url = new URL(window.location.href);
    url.searchParams.set('edit', '');
    window.history.replaceState({}, '', url);
  } catch (error) {
    console.error('Failed to load about content:', error);
    showNotification('Failed to load about content', 'error');
  }
}

/**
 * Setup the editor UI
 */
function setupEditor(data: ProjectData | AboutData): void {
  const contentContainer = editMode === 'about'
    ? document.querySelector<HTMLElement>('.about-content')
    : document.querySelector<HTMLElement>('.project-content');

  if (!contentContainer) {
    console.error('Content container not found');
    return;
  }

  // For project mode, pause any playing videos
  if (editMode === 'project') {
    const projectItem = contentContainer.closest('.project-item');
    if (projectItem) {
      projectItem.querySelectorAll('video').forEach(video => {
        video.pause();
      });
    }

    // Replace the Edit/Settings buttons with Save/Cancel buttons
    const editButtons = projectItem?.querySelector<HTMLElement>('.edit-buttons');
    if (editButtons) {
      editButtons.dataset.originalHtml = editButtons.innerHTML;
      editButtons.innerHTML = `
        <span class="edit-status"></span>
        <button class="edit-btn-action edit-btn-cancel" data-action="cancel">Cancel</button>
        <button class="edit-btn-action edit-btn-save" data-action="save">Save</button>
      `;
      toolbar = editButtons;
      toolbar.querySelector('[data-action="cancel"]')?.addEventListener('click', handleCancel);
      toolbar.querySelector('[data-action="save"]')?.addEventListener('click', handleSave);
    }
  }

  // Parse markdown into blocks
  const markdown = 'markdown' in data ? data.markdown : '';
  blocks = EditBlocks.parseIntoBlocks(markdown || '');

  // Create editor wrapper
  const editorWrapper = document.createElement('div');
  editorWrapper.className = 'edit-mode-container';

  // For about page, include a toolbar since there's no edit-buttons container
  if (editMode === 'about') {
    editorWrapper.innerHTML = `
      <div class="edit-mode-toolbar">
        <div class="edit-toolbar-left">
          <span class="edit-project-name">About Page</span>
          <span class="edit-status"></span>
        </div>
        <div class="edit-toolbar-right">
          <button class="edit-btn edit-btn-secondary" data-action="cancel">Cancel</button>
          <button class="edit-btn edit-btn-primary" data-action="save">Save</button>
        </div>
      </div>
      <div class="edit-blocks-container"></div>
    `;
    toolbar = editorWrapper.querySelector<HTMLElement>('.edit-mode-toolbar');
    toolbar?.querySelector('[data-action="cancel"]')?.addEventListener('click', handleCancel);
    toolbar?.querySelector('[data-action="save"]')?.addEventListener('click', handleSave);
  } else {
    editorWrapper.innerHTML = `
      <div class="edit-blocks-container"></div>
    `;
  }

  // Replace content with editor
  contentContainer.innerHTML = '';
  contentContainer.appendChild(editorWrapper);
  contentContainer.classList.add('edit-mode-active');

  // Get reference to blocks container
  container = editorWrapper.querySelector<HTMLElement>('.edit-blocks-container');

  // Initialize slash commands
  EditSlash.init(handleSlashCommand);

  // Initialize media handling
  EditMedia.init({
    updateBlock,
    insertBlock,
    insertBlockAfter,
    getBlocks: () => blocks,
    renderBlocks,
    markDirty,
    isActive: () => isActive,
  });

  // Initialize undo system
  EditUndo.init({
    getBlocks: () => blocks,
    setBlocks: (newBlocks) => { blocks = newBlocks; },
    renderBlocks,
    markDirty,
  });
  EditUndo.saveState();

  // Add keyboard listener
  document.addEventListener('keydown', handleGlobalKeydown);

  // Mark edit state before block rendering so video elements never autoplay in the editor.
  document.body.classList.add('editing');

  // Render blocks
  renderBlocks();

  // Warn before leaving with unsaved changes
  window.addEventListener('beforeunload', handleBeforeUnload);
}

// ========== CONFLICT RESOLUTION ==========

function buildProjectSavePayload(markdown: string, options: { force?: boolean } = {}): Record<string, unknown> {
  if (editMode !== 'project' || !projectSlug || !projectData) {
    throw new Error('Project data is not loaded');
  }

  const project = projectData as ProjectData;
  const payload: Record<string, unknown> = {
    slug: projectSlug,
    original_slug: projectSlug,
    name: project.name,
    date: project.date,
    pinned: project.pinned ?? false,
    draft: project.draft ?? false,
    youtube: project.youtube || '',
    video: project.video ?? {},
    markdown,
  };

  if (options.force) {
    payload.force = true;
  } else {
    payload.base_revision = currentRevision;
  }

  return payload;
}

/**
 * Show a conflict banner when another session modified the content.
 * Offers two options: force-overwrite with local changes, or reload
 * from server.
 */
function showConflictBanner(): void {
  // Remove any existing banner
  document.querySelector('.edit-conflict-banner')?.remove();

  const banner = document.createElement('div');
  banner.className = 'edit-conflict-banner';
  banner.innerHTML = `
    <span class="edit-conflict-message">Content was modified in another session</span>
    <button class="edit-conflict-btn edit-conflict-keep">Keep mine</button>
    <button class="edit-conflict-btn edit-conflict-reload">Load theirs</button>
  `;

  // Style the banner inline (no need for a separate CSS addition)
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:10000;display:flex;align-items:center;justify-content:center;gap:12px;padding:12px 20px;background:#7c2d12;color:#fff;font-size:14px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3)';

  const keepBtn = banner.querySelector('.edit-conflict-keep') as HTMLButtonElement;
  const reloadBtn = banner.querySelector('.edit-conflict-reload') as HTMLButtonElement;

  [keepBtn, reloadBtn].forEach(btn => {
    btn.style.cssText = 'padding:6px 16px;border:1px solid rgba(255,255,255,.3);border-radius:6px;background:transparent;color:#fff;font-size:13px;cursor:pointer';
  });

  keepBtn.addEventListener('click', async () => {
    banner.remove();
    // Force-save: skip conflict check by sending force flag
    const markdown = blocksToMarkdown(blocks);
    try {
      let response: Response;
      if (editMode === 'about') {
        response = await fetch('/api/save-about', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markdown, force: true }),
        });
      } else {
        const saveData = buildProjectSavePayload(markdown, { force: true });
        response = await fetch('/api/save-project', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(saveData),
        });
      }

      if (response.ok) {
        const result = await response.json();
        if (result.revision) {
          currentRevision = result.revision;
        }
        isDirty = false;
        dispatchSaveAction({ type: 'save_ok' });
        showNotification('Changes saved (overwritten)', 'success');
      } else {
        dispatchSaveAction({ type: 'save_error' });
        showNotification('Force save failed', 'error');
      }
    } catch {
      dispatchSaveAction({ type: 'save_error' });
      showNotification('Force save failed', 'error');
    }
  });

  reloadBtn.addEventListener('click', () => {
    banner.remove();
    // Reload from server — just re-initialize the editor
    cleanup();
    window.location.reload();
  });

  document.body.appendChild(banner);
}

/**
 * Cleanup and exit edit mode
 */
export function cleanup(): void {
  isActive = false;

  // Clear auto-save timers
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
  if (savedFadeTimer) {
    clearTimeout(savedFadeTimer);
    savedFadeTimer = null;
  }
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (abortController) {
    abortController.abort();
    abortController = null;
  }

  // Reset save state
  dispatchSaveAction({ type: 'reset' });
  currentRevision = null;

  // Remove conflict banner if present
  document.querySelector('.edit-conflict-banner')?.remove();

  document.removeEventListener('keydown', handleGlobalKeydown);
  window.removeEventListener('beforeunload', handleBeforeUnload);
  EditSlash.cleanup();
  EditMedia.deselect();
  document.body.classList.remove('editing');

  // Remove edit-mode-active class from the appropriate container
  const contentContainer = editMode === 'about'
    ? document.querySelector('.about-content')
    : document.querySelector('.project-content');
  if (contentContainer) {
    contentContainer.classList.remove('edit-mode-active');
  }

  // Restore original Edit/Settings buttons (project mode only)
  if (editMode === 'project' && toolbar && toolbar.dataset.originalHtml) {
    toolbar.innerHTML = toolbar.dataset.originalHtml;
    delete toolbar.dataset.originalHtml;
  }

  // Remove edit param from URL
  const url = new URL(window.location.href);
  url.searchParams.delete('edit');
  window.history.replaceState({}, '', url);

  // Reset state
  editMode = null;
}

/**
 * Handle beforeunload event
 */
function handleBeforeUnload(e: BeforeUnloadEvent): void {
  if (isDirty) {
    e.preventDefault();
    e.returnValue = '';
  }
}

// ========== TOOLBAR ==========

/**
 * Update toolbar status indicator based on save state
 */
function updateToolbarStatus(): void {
  if (!toolbar) return;
  const status = toolbar.querySelector<HTMLElement>('.edit-status');
  const saveBtn = toolbar.querySelector<HTMLElement>('[data-action="save"]');

  // Remove all state classes
  saveBtn?.classList.remove('has-changes', 'is-saving', 'has-error');

  if (status) {
    switch (saveState) {
      case SaveState.UNCHANGED:
        status.textContent = '';
        status.style.color = '';
        break;
      case SaveState.PENDING:
        status.textContent = '(unsaved)';
        status.style.color = '#eab308';
        saveBtn?.classList.add('has-changes');
        break;
      case SaveState.SAVING:
        status.textContent = 'Saving...';
        status.style.color = '#3b82f6';
        saveBtn?.classList.add('is-saving');
        break;
      case SaveState.SAVED:
        status.textContent = 'Saved';
        status.style.color = '#22c55e';
        break;
      case SaveState.ERROR:
        status.textContent = 'Save failed';
        status.style.color = '#ef4444';
        saveBtn?.classList.add('has-error');
        break;
      case SaveState.CONFLICT:
        status.textContent = 'Conflict';
        status.style.color = '#f97316';
        saveBtn?.classList.add('has-error');
        break;
    }
  }
}

/**
 * Pure save-state reducer.
 */
function nextSaveState(state: SaveState, action: SaveAction): SaveState {
  switch (action.type) {
    case 'edit':
      return SaveState.PENDING;
    case 'save_start':
      return state === SaveState.CONFLICT ? state : SaveState.SAVING;
    case 'save_ok':
      return SaveState.SAVED;
    case 'save_error':
      return SaveState.ERROR;
    case 'conflict':
      return SaveState.CONFLICT;
    case 'fade':
      return state === SaveState.SAVED ? SaveState.UNCHANGED : state;
    case 'reset':
      return SaveState.UNCHANGED;
    default:
      return state;
  }
}

/**
 * Dispatch a save action and trigger side effects from the resulting transition.
 */
function dispatchSaveAction(action: SaveAction): void {
  const nextState = nextSaveState(saveState, action);
  saveState = nextState;
  updateToolbarStatus();

  // Clear fade timer if not in SAVED state
  if (nextState !== SaveState.SAVED && savedFadeTimer) {
    clearTimeout(savedFadeTimer);
    savedFadeTimer = null;
  }

  // Schedule fade for SAVED state
  if (nextState === SaveState.SAVED) {
    if (savedFadeTimer) {
      clearTimeout(savedFadeTimer);
    }
    savedFadeTimer = setTimeout(() => {
      dispatchSaveAction({ type: 'fade' });
    }, SAVED_FADE_DELAY);
  }
}

function applyBlocksUpdate(nextBlocks: Block[], options: UpdateBlockOptions = {}): void {
  const { render = true, markDirty: shouldMarkDirty = true } = options;
  blocks = nextBlocks;
  if (shouldMarkDirty) {
    markDirty();
  }
  if (render) {
    renderBlocks();
  }
}

function updateTopLevelBlock(
  index: number,
  updater: (block: Block) => Block,
  options: UpdateBlockOptions = {}
): boolean {
  const currentBlock = blocks[index];
  if (!currentBlock) return false;

  const updatedBlock = updater(currentBlock);
  if (updatedBlock === currentBlock) return false;
  const nextBlocks = blocks.slice();
  nextBlocks[index] = updatedBlock;
  applyBlocksUpdate(nextBlocks, options);
  return true;
}

function applyBlockUpdates(block: Block, updates: Partial<Block>): Block {
  switch (block.type) {
    case 'text':
      return { ...block, ...(updates as Partial<TextBlock>) };
    case 'image':
      return { ...block, ...(updates as Partial<ImageBlock>) };
    case 'video':
      return { ...block, ...(updates as Partial<VideoBlock>) };
    case 'code':
      return { ...block, ...(updates as Partial<CodeBlock>) };
    case 'html':
      return { ...block, ...(updates as Partial<HtmlBlock>) };
    case 'callout':
      return { ...block, ...(updates as Partial<CalloutBlock>) };
    case 'row':
      return { ...block, ...(updates as Partial<RowBlock>) };
    case 'divider':
    default:
      return { ...block };
  }
}

function updateBlockInContext(
  context: BlockContext,
  updater: (block: Block) => Block,
  options: UpdateBlockOptions = {}
): boolean {
  const rowSide = context.rowSide;
  if (rowSide) {
    return updateTopLevelBlock(
      context.index,
      (parentBlock) => {
        if (parentBlock.type !== 'row') return parentBlock;
        const currentChild = parentBlock[rowSide];
        const updatedChild = updater(currentChild);
        if (updatedChild === currentChild) return parentBlock;
        return rowSide === 'left'
          ? { ...parentBlock, left: updatedChild }
          : { ...parentBlock, right: updatedChild };
      },
      options,
    );
  }

  return updateTopLevelBlock(context.index, updater, options);
}

function updateBlockFieldsInContext(
  context: BlockContext,
  updates: Partial<Block>,
  options: UpdateBlockOptions = {}
): void {
  updateBlockInContext(context, (block) => applyBlockUpdates(block, updates), options);
}

function createBlockWithProps(type: BlockType, props: Partial<Block> = {}): Block {
  return createBlock(type as never, props as never) as Block;
}

/**
 * Schedule auto-save with debounce
 */
function scheduleAutoSave(): void {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
  }

  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  autoSaveTimer = setTimeout(() => {
    performAutoSave();
  }, AUTO_SAVE_DELAY);
}

/**
 * Perform auto-save (silent, no toast)
 */
async function performAutoSave(): Promise<void> {
  if (!isDirty || saveState === SaveState.SAVING || saveState === SaveState.CONFLICT) return;

  // Don't auto-save if project data isn't loaded (prevents creating orphaned files)
  if (editMode === 'project' && !projectData) {
    console.warn('Auto-save skipped: project data not loaded');
    return;
  }

  if (abortController) {
    abortController.abort();
  }
  abortController = new AbortController();

  dispatchSaveAction({ type: 'save_start' });

  try {
    const markdown = blocksToMarkdown(blocks);

    let response: Response;
    if (editMode === 'about') {
      response = await fetch('/api/save-about', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markdown,
          base_revision: currentRevision,
        }),
        signal: abortController.signal,
      });
    } else {
      const saveData = buildProjectSavePayload(markdown);

      response = await fetch('/api/save-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(saveData),
        signal: abortController.signal,
      });
    }

    if (response.status === 409) {
      // Conflict: another session modified the content
      dispatchSaveAction({ type: 'conflict' });
      showConflictBanner();
      return;
    }

    if (!response.ok) {
      throw new Error(`Save failed: ${response.status}`);
    }

    const result = await response.json();
    if (result.revision) {
      currentRevision = result.revision;
    }

    isDirty = false;
    dispatchSaveAction({ type: 'save_ok' });

  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return;
    }
    console.error('Auto-save error:', error);
    dispatchSaveAction({ type: 'save_error' });

    retryTimer = setTimeout(() => {
      if (saveState === SaveState.ERROR && isDirty) {
        performAutoSave();
      }
    }, RETRY_DELAY);
  }
}

// ========== BLOCK RENDERING ==========

/**
 * Render all blocks to the container
 */
export function renderBlocks(): void {
  if (!container) return;

  EditMedia.deselect();

  const cont = container; // Local reference for closure
  cont.innerHTML = '';

  // Keep an insertion affordance at the top of content (right below hero video on project pages).
  cont.appendChild(createAddBlockButton(0, 'top'));

  blocks.forEach((block, index) => {
    if (index > 0) {
      cont.appendChild(createMergeDivider(index));
    }
    cont.appendChild(createBlockWrapper(block, index));
  });

  if (blocks.length > 0) {
    cont.appendChild(createAddBlockButton(blocks.length, 'bottom'));
  }
}

/**
 * Create a block wrapper element with all controls
 */
function createBlockWrapper(block: Block, index: number): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'block-wrapper';
  wrapper.dataset.blockIndex = String(index);
  wrapper.dataset.blockId = block.id;
  wrapper.dataset.blockType = block.type;

  // Drag handle
  const handle = document.createElement('div');
  handle.className = 'block-handle';
  handle.innerHTML = ICONS.dragHandle;
  handle.draggable = true;
  handle.addEventListener('dragstart', (e) => handleDragStart(e, index));
  handle.addEventListener('dragend', handleDragEnd);
  wrapper.appendChild(handle);

  // Block content
  const content = document.createElement('div');
  content.className = 'block-content';
  content.appendChild(renderBlockContent(block, { index }));
  wrapper.appendChild(content);

  // Alignment toolbar (for top-level non-row text/media/callout/html blocks)
  if (block.type !== 'divider' && block.type !== 'code' && block.type !== 'row') {
    wrapper.appendChild(createAlignmentToolbar(block, { index }));
  }

  // Delete button
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'block-delete-btn';
  deleteBtn.innerHTML = ICONS.delete;
  deleteBtn.title = 'Delete block';
  deleteBtn.addEventListener('click', () => deleteBlock(index));
  wrapper.appendChild(deleteBtn);

  // Drag over handling
  wrapper.addEventListener('dragover', (e) => handleDragOver(e, index));
  wrapper.addEventListener('dragleave', handleDragLeave);
  wrapper.addEventListener('drop', (e) => handleDrop(e, index));

  return wrapper;
}

/**
 * Create alignment toolbar with left/center/right buttons
 */
function createAlignmentToolbar(block: Block, context: BlockContext): HTMLElement {
  const alignToolbar = document.createElement('div');
  alignToolbar.className = 'block-align-toolbar';

  const currentAlign = ('align' in block ? block.align : 'left') || 'left';

  const alignments: Array<{ value: Alignment; icon: string; title: string }> = [
    { value: 'left', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>', title: 'Align left' },
    { value: 'center', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>', title: 'Align center' },
    { value: 'right', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg>', title: 'Align right' },
  ];

  alignments.forEach(({ value, icon, title }) => {
    const btn = document.createElement('button');
    btn.className = 'block-align-btn' + (currentAlign === value ? ' active' : '');
    btn.innerHTML = icon;
    btn.title = title;
    btn.type = 'button';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      setBlockAlignment(context, value);
    });
    alignToolbar.appendChild(btn);
  });

  return alignToolbar;
}

/**
 * Set alignment for a block
 */
function setBlockAlignment(context: BlockContext, align: Alignment): void {
  updateBlockInContext(
    context,
    (block) => ('align' in block ? { ...block, align } as Block : block),
  );
}

/**
 * Render block content based on type
 */
function renderBlockContent(block: Block, context: BlockContext): HTMLElement {
  switch (block.type) {
    case 'text':
      return renderTextBlock(block, context);
    case 'image':
      return renderImageBlock(block, context);
    case 'video':
      return renderVideoBlock(block, context);
    case 'code':
      return renderCodeBlock(block, context);
    case 'html':
      return renderHtmlBlock(block, context);
    case 'callout':
      return renderCalloutBlock(block, context);
    case 'row':
      return renderRowBlock(block, context.index);
    case 'divider':
      return renderDividerBlock();
    default:
      return renderTextBlock(block as TextBlock, context);
  }
}

/**
 * Render text block
 */
function renderTextBlock(block: TextBlock, context: BlockContext): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'text-block-wrapper';
  wrapper.appendChild(createLineEditor(block, context));
  return wrapper;
}

type LinePreviewType =
  | 'empty'
  | 'divider'
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'heading-5'
  | 'heading-6'
  | 'quote'
  | 'list'
  | 'paragraph';

interface LinePreviewResult {
  node: Node;
  type: LinePreviewType;
}

/**
 * Create a line-based editor for a text block
 */
function createLineEditor(block: TextBlock, context: BlockContext): HTMLElement {
  const lineContainer = document.createElement('div');
  lineContainer.className = 'text-block-lines';

  if (block.align) {
    lineContainer.style.textAlign = block.align;
  }

  let lines = (block.content || '').split('\n');
  if (!lines.length) lines = [''];

  let activeLineIndex: number | null = null;
  const slashEnabled = !context.rowSide;

  const updateBlockContent = (): void => {
    const nextContent = lines.join('\n');
    updateBlockInContext(
      context,
      (existing) => (existing.type === 'text' ? { ...existing, content: nextContent } : existing),
      { render: false },
    );
  };

  const renderLines = (focusLineIndex: number | null = null, focusCaret: number | { start: number; end?: number } | null = null): void => {
    lineContainer.innerHTML = '';
    lines.forEach((lineText, lineIndex) => {
      const row = buildLineRow(lineText, lineIndex);
      lineContainer.appendChild(row);
    });

    requestAnimationFrame(() => {
      lineContainer.querySelectorAll<HTMLElement>('.text-block-line').forEach((row) => {
        syncLineHeight(row);
      });
    });

    if (focusLineIndex !== null) {
      const row = lineContainer.querySelector<HTMLElement>(`.text-block-line[data-line-index="${focusLineIndex}"]`);
      if (row) {
        activateLine(row, focusCaret);
      }
    }
  };

  const buildLineRow = (lineText: string, lineIndex: number): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'text-block-line';
    row.dataset.lineIndex = String(lineIndex);

    const preview = document.createElement('div');
    preview.className = 'text-block-line-preview';

    const isSingleEmptyLine = lines.length === 1 && !lines[0]?.trim();
    if (isSingleEmptyLine) {
      row.dataset.lineType = 'empty';
      preview.classList.add('text-block-line-placeholder');
      preview.textContent = 'Type something... (type / for commands)';
    } else {
      const rendered = renderLinePreview(lineText);
      row.dataset.lineType = rendered.type;
      preview.appendChild(rendered.node);
    }

    const textarea = document.createElement('textarea');
    textarea.className = 'text-line-input';
    textarea.value = lineText;
    textarea.rows = 1;
    textarea.placeholder = 'Type something... (type / for commands)';

    preview.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      activateLine(row);
    });

    row.addEventListener('click', (e) => {
      if (!row.classList.contains('is-editing')) {
        e.preventDefault();
        e.stopPropagation();
        activateLine(row);
      }
    });

    textarea.addEventListener('input', () => {
      const newValue = textarea.value;
      if (slashEnabled) {
        EditSlash.handleTextareaInput(textarea, context.index);
      }

      if (newValue.includes('\n')) {
        const splitLines = newValue.split('\n');
        lines.splice(lineIndex, 1, ...splitLines);
        updateBlockContent();
        const lastLineText = splitLines[splitLines.length - 1] ?? '';
        renderLines(lineIndex + splitLines.length - 1, lastLineText.length);
        return;
      }

      lines[lineIndex] = newValue;
      updateBlockContent();
      syncLineHeight(row);
    });

    textarea.addEventListener('keydown', (e) => {
      if (slashEnabled && EditSlash.isActive()) {
        if (EditSlash.handleKeydown(e)) return;
      }

      if (handleFormattingShortcuts(e, textarea, markDirty)) {
        lines[lineIndex] = textarea.value;
        updateBlockContent();
        syncLineHeight(row);
        return;
      }

      if (handleListShortcuts(e, textarea, markDirty)) return;

      if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        handleLineSplit(textarea, lineIndex);
        return;
      }

      if (e.key === 'Backspace' && textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
        if (lineIndex > 0) {
          e.preventDefault();
          mergeWithPreviousLine(lineIndex);
        }
        return;
      }

      if (e.key === 'Delete' && textarea.selectionStart === textarea.value.length && textarea.selectionEnd === textarea.value.length) {
        if (lineIndex < lines.length - 1) {
          e.preventDefault();
          mergeWithNextLine(lineIndex);
        }
        return;
      }

      if (e.key === 'ArrowUp' && textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
        if (lineIndex > 0) {
          e.preventDefault();
          renderLines(lineIndex - 1, lines[lineIndex - 1]?.length ?? 0);
        }
        return;
      }

      if (e.key === 'ArrowDown' && textarea.selectionStart === textarea.value.length && textarea.selectionEnd === textarea.value.length) {
        if (lineIndex < lines.length - 1) {
          e.preventDefault();
          renderLines(lineIndex + 1, 0);
        }
      }
    });

    textarea.addEventListener('blur', () => {
      if (activeLineIndex !== lineIndex) return;
      deactivateLine(row);
    });

    row.appendChild(preview);
    row.appendChild(textarea);
    return row;
  };

  const activateLine = (row: HTMLElement, selection: number | { start: number; end?: number } | null = null): void => {
    const lineIndex = Number(row.dataset.lineIndex);

    if (activeLineIndex !== null && activeLineIndex !== lineIndex) {
      const previousRow = lineContainer.querySelector<HTMLElement>(`.text-block-line[data-line-index="${activeLineIndex}"]`);
      if (previousRow) deactivateLine(previousRow);
    }

    activeLineIndex = lineIndex;
    row.classList.add('is-editing');

    const textarea = row.querySelector<HTMLTextAreaElement>('.text-line-input');
    if (!textarea) return;

    textarea.focus();
    if (selection && typeof selection === 'object') {
      textarea.selectionStart = selection.start;
      textarea.selectionEnd = selection.end ?? selection.start;
    } else if (typeof selection === 'number') {
      textarea.selectionStart = selection;
      textarea.selectionEnd = selection;
    } else {
      textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
    }

    syncLineHeight(row);
  };

  const deactivateLine = (row: HTMLElement): void => {
    const textarea = row.querySelector<HTMLTextAreaElement>('.text-line-input');
    const preview = row.querySelector<HTMLElement>('.text-block-line-preview');

    row.classList.remove('is-editing');

    const currentText = textarea?.value ?? '';
    preview?.classList.remove('text-block-line-placeholder');
    if (preview) preview.innerHTML = '';

    const isSingleEmptyLine = lines.length === 1 && !lines[0]?.trim();
    if (isSingleEmptyLine && !currentText.trim()) {
      row.dataset.lineType = 'empty';
      preview?.classList.add('text-block-line-placeholder');
      if (preview) preview.textContent = 'Type something... (type / for commands)';
    } else if (preview) {
      const rendered = renderLinePreview(currentText);
      row.dataset.lineType = rendered.type;
      preview.appendChild(rendered.node);
    }

    activeLineIndex = null;
    syncLineHeight(row);
  };

  const handleLineSplit = (textarea: HTMLTextAreaElement, lineIndex: number): void => {
    const value = textarea.value;
    const cursor = textarea.selectionStart;
    const before = value.slice(0, cursor);
    const after = value.slice(cursor);

    const listContinuation = getListContinuation(before);

    lines[lineIndex] = before;
    const nextLine = listContinuation ? listContinuation + after.replace(/^\s+/, '') : after;
    lines.splice(lineIndex + 1, 0, nextLine);
    updateBlockContent();

    const caret = listContinuation ? listContinuation.length : 0;
    renderLines(lineIndex + 1, caret);
  };

  const mergeWithPreviousLine = (lineIndex: number): void => {
    if (lineIndex <= 0) return;
    const previous = lines[lineIndex - 1] ?? '';
    const current = lines[lineIndex] ?? '';
    const merged = previous + current;
    lines.splice(lineIndex - 1, 2, merged);
    updateBlockContent();
    renderLines(lineIndex - 1, previous.length);
  };

  const mergeWithNextLine = (lineIndex: number): void => {
    if (lineIndex >= lines.length - 1) return;
    const current = lines[lineIndex] ?? '';
    const next = lines[lineIndex + 1] ?? '';
    const merged = current + next;
    lines.splice(lineIndex, 2, merged);
    updateBlockContent();
    renderLines(lineIndex, current.length);
  };

  const syncLineHeight = (row: HTMLElement): void => {
    const preview = row.querySelector<HTMLElement>('.text-block-line-preview');
    const textarea = row.querySelector<HTMLTextAreaElement>('.text-line-input');

    requestAnimationFrame(() => {
      const previewHeight = preview?.offsetHeight ?? 0;
      const inputHeight = textarea?.scrollHeight ?? 0;
      const minHeight = Math.max(27, previewHeight);
      row.style.minHeight = `${minHeight}px`;
      if (row.classList.contains('is-editing')) {
        row.style.height = `${Math.max(minHeight, inputHeight)}px`;
      } else {
        row.style.height = '';
      }
    });
  };

  const getListContinuation = (lineText: string): string | null => {
    const unorderedMatch = lineText.match(/^(\s*)([-*+])\s+/);
    if (unorderedMatch) {
      return `${unorderedMatch[1] ?? ''}${unorderedMatch[2] ?? '-'} `;
    }
    const orderedMatch = lineText.match(/^(\s*)(\d+)\.\s+/);
    if (orderedMatch) {
      const nextNum = parseInt(orderedMatch[2] ?? '1', 10) + 1;
      return `${orderedMatch[1] ?? ''}${nextNum}. `;
    }
    return null;
  };

  renderLines();
  return lineContainer;
}

/**
 * Render a single line of markdown into preview HTML
 */
function renderLinePreview(lineText: string): LinePreviewResult {
  const trimmed = lineText.trim();

  if (!trimmed) {
    const empty = document.createElement('span');
    empty.innerHTML = '&nbsp;';
    return { node: empty, type: 'empty' };
  }

  if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
    const hr = document.createElement('hr');
    hr.className = 'text-line-divider';
    return { node: hr, type: 'divider' };
  }

  const headingMatch = lineText.match(/^(\s*)(#{1,6})\s+(.*)$/);
  if (headingMatch) {
    const level = headingMatch[2]?.length ?? 1;
    const heading = document.createElement(`h${level}`) as HTMLHeadingElement;
    heading.appendChild(renderInlineMarkdown(headingMatch[3] ?? ''));
    return { node: heading, type: `heading-${level}` as LinePreviewType };
  }

  const quoteMatch = lineText.match(/^(\s*)>\s+(.*)$/);
  if (quoteMatch) {
    const quote = document.createElement('blockquote');
    quote.appendChild(renderInlineMarkdown(quoteMatch[2] ?? ''));
    return { node: quote, type: 'quote' };
  }

  if (/^(\s*)([-*+]|\d+\.)\s+/.test(lineText)) {
    const span = document.createElement('span');
    span.appendChild(renderInlineMarkdown(lineText));
    return { node: span, type: 'list' };
  }

  const span = document.createElement('span');
  span.appendChild(renderInlineMarkdown(lineText));
  return { node: span, type: 'paragraph' };
}

/**
 * Render inline markdown into a fragment
 */
function renderInlineMarkdown(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match;

  while ((match = linkRegex.exec(text)) !== null) {
    const offset = match.index;

    if (offset > lastIndex) {
      appendInlineFormatted(fragment, text.slice(lastIndex, offset));
    }

    const safeUrl = sanitizeUrl(match[2] ?? '');
    if (safeUrl) {
      const link = document.createElement('a');
      link.href = safeUrl;
      link.rel = 'noopener';
      link.target = '_blank';
      appendInlineFormatted(link, match[1] ?? '');
      fragment.appendChild(link);
    } else {
      fragment.appendChild(document.createTextNode(match[0]));
    }

    lastIndex = offset + match[0].length;
  }

  if (lastIndex < text.length) {
    appendInlineFormatted(fragment, text.slice(lastIndex));
  }

  return fragment;
}

/**
 * Append formatted inline content into a container
 */
function appendInlineFormatted(container: Node, text: string): void {
  container.appendChild(parseInlineTokens(text));
}

/**
 * Parse inline markdown tokens
 */
function parseInlineTokens(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  // Simplified parsing - just add text for now, real implementation would parse bold/italic/code
  fragment.appendChild(document.createTextNode(text));
  return fragment;
}

/**
 * Basic URL sanitizer for preview links
 */
function sanitizeUrl(url: string): string | null {
  const trimmed = (url || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('#') || trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)) {
      return parsed.href;
    }
  } catch {
    return null;
  }

  return null;
}

function createMediaCaptionInput(caption: string | undefined, context: BlockContext): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'media-caption-input';
  input.placeholder = 'Caption (optional)...';
  input.value = caption || '';
  input.addEventListener('input', () => {
    updateBlockFieldsInContext(context, { caption: input.value }, { render: false });
  });
  return input;
}

/**
 * Render image block
 */
function renderImageBlock(block: ImageBlock, context: BlockContext): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'image-block-wrapper';

  if (block.src) {
    const img = createImageElement(block, (element) => {
      EditMedia.select(element, block);
    });
    img.className = 'block-image';
    wrapper.appendChild(img);

    const altInput = document.createElement('input');
    altInput.type = 'text';
    altInput.className = 'image-alt-input';
    altInput.placeholder = 'Image description...';
    altInput.value = block.alt || '';
    altInput.addEventListener('input', () => {
      updateBlockFieldsInContext(context, { alt: altInput.value }, { render: false });
    });
    wrapper.appendChild(altInput);
    wrapper.appendChild(createMediaCaptionInput(block.caption, context));
  } else {
    wrapper.appendChild(createUploadZone(context, 'image'));
  }

  return wrapper;
}

/**
 * Render video block
 */
function renderVideoBlock(block: VideoBlock, context: BlockContext): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'video-block-wrapper';

  if (block.src) {
    const video = createVideoElement(block, (element) => {
      EditMedia.select(element, block);
    });
    video.className = 'block-video';
    wrapper.appendChild(video);

    const optionsRow = document.createElement('label');
    optionsRow.className = 'video-option-row';

    const autoplayToggle = document.createElement('input');
    autoplayToggle.type = 'checkbox';
    autoplayToggle.className = 'video-option-checkbox';
    autoplayToggle.checked = !!block.autoplay;
    autoplayToggle.addEventListener('change', () => {
      const autoplay = autoplayToggle.checked;
      applyVideoPlaybackSettings(video, autoplay);
      updateBlockFieldsInContext(context, { autoplay }, { render: false });
    });
    optionsRow.appendChild(autoplayToggle);

    const autoplayLabel = document.createElement('span');
    autoplayLabel.className = 'video-option-label';
    autoplayLabel.textContent = 'Autoplay (muted loop)';
    optionsRow.appendChild(autoplayLabel);

    wrapper.appendChild(optionsRow);
    wrapper.appendChild(createMediaCaptionInput(block.caption, context));
  } else {
    wrapper.appendChild(createUploadZone(context, 'video'));
  }

  return wrapper;
}

/**
 * Render code block
 */
function renderCodeBlock(block: CodeBlock, context: BlockContext): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'code-block-wrapper';

  const langSelect = document.createElement('select');
  langSelect.className = 'code-language-select';
  const languages = ['javascript', 'python', 'html', 'css', 'bash', 'json', 'sql', 'go', 'rust', 'text'];
  languages.forEach(lang => {
    const option = document.createElement('option');
    option.value = lang;
    option.textContent = lang;
    if (lang === (block.language || 'javascript')) option.selected = true;
    langSelect.appendChild(option);
  });
  langSelect.addEventListener('change', () => {
    updateBlockFieldsInContext(context, { language: langSelect.value }, { render: false });
  });
  wrapper.appendChild(langSelect);

  const textarea = document.createElement('textarea');
  textarea.className = 'code-textarea';
  textarea.value = block.code || '';
  textarea.placeholder = 'Enter code...';
  textarea.spellcheck = false;

  setupAutoResizeTextarea(textarea, (value) => {
    updateBlockFieldsInContext(context, { code: value }, { render: false });
  });

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      insertTextWithUndo(textarea, '    ');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  wrapper.appendChild(textarea);
  return wrapper;
}

/**
 * Render callout block
 */
function renderCalloutBlock(block: CalloutBlock, context: BlockContext): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'callout-block-wrapper';

  const textarea = document.createElement('textarea');
  textarea.className = 'callout-textarea';
  textarea.value = block.content || '';
  textarea.placeholder = 'Callout content...';

  if (block.align) {
    textarea.style.textAlign = block.align;
  }

  setupAutoResizeTextarea(textarea, (value) => {
    updateBlockFieldsInContext(context, { content: value }, { render: false });
  });

  wrapper.appendChild(textarea);
  return wrapper;
}

/**
 * Render row block (two columns)
 */
function renderRowBlock(block: RowBlock, index: number): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'row-block-wrapper';

  const toolbar = document.createElement('div');
  toolbar.className = 'row-toolbar';

  const splitBtn = document.createElement('button');
  splitBtn.className = 'row-action-btn row-action-btn-split';
  splitBtn.type = 'button';
  splitBtn.innerHTML = ICONS.split;
  splitBtn.title = 'Split columns into blocks';
  splitBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    splitRowIntoBlocks(index);
  });
  toolbar.appendChild(splitBtn);

  const swapBtn = document.createElement('button');
  swapBtn.className = 'row-action-btn';
  swapBtn.type = 'button';
  swapBtn.innerHTML = ICONS.swap;
  swapBtn.title = 'Swap column sides';
  swapBtn.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    swapRowColumns(index);
  });
  toolbar.appendChild(swapBtn);
  wrapper.appendChild(toolbar);

  const columns = document.createElement('div');
  columns.className = 'row-columns';

  const leftCol = document.createElement('div');
  leftCol.className = 'row-column row-column-left';
  leftCol.appendChild(renderBlockContent(block.left, { index, rowSide: 'left' }));

  const rightCol = document.createElement('div');
  rightCol.className = 'row-column row-column-right';
  rightCol.appendChild(renderBlockContent(block.right, { index, rowSide: 'right' }));

  columns.appendChild(leftCol);
  columns.appendChild(rightCol);
  wrapper.appendChild(columns);

  return wrapper;
}

/**
 * Render divider block
 */
function renderDividerBlock(): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'block-divider';
  wrapper.innerHTML = ICONS.divider;
  return wrapper;
}

/**
 * Render HTML block with iframe sandbox for isolation
 */
function renderHtmlBlock(block: HtmlBlock, context: BlockContext): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'html-block-wrapper';

  if (block.align) {
    wrapper.style.textAlign = block.align;
  }

  // Preview container (for iframe or empty placeholder)
  const previewContainer = document.createElement('div');
  previewContainer.className = 'html-block-preview-container';
  wrapper.appendChild(previewContainer);

  let iframe: HTMLIFrameElement | null = null;
  let selectOverlay: HTMLButtonElement | null = null;
  let isEditing = false;
  let isInteractive = false;

  const controls = document.createElement('div');
  controls.className = 'html-block-controls';

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'html-toggle-btn';
  toggleBtn.textContent = 'Edit HTML';
  toggleBtn.type = 'button';
  controls.appendChild(toggleBtn);

  const interactBtn = document.createElement('button');
  interactBtn.className = 'html-toggle-btn';
  interactBtn.textContent = 'Interact';
  interactBtn.type = 'button';
  controls.appendChild(interactBtn);

  function syncInteractionUi(): void {
    if (selectOverlay) {
      selectOverlay.style.display = isInteractive ? 'none' : 'block';
    }
    interactBtn.classList.toggle('is-active', isInteractive);
    interactBtn.textContent = isInteractive ? 'Resize' : 'Interact';
    interactBtn.disabled = isEditing || !iframe;
    interactBtn.style.display = isEditing ? 'none' : '';
  }

  function renderPreview(html: string): void {
    // Clean up existing iframe
    if (iframe) {
      cleanupIframe(iframe);
      iframe.remove();
      iframe = null;
    }

    // Empty block: show placeholder, not iframe
    if (!html.trim()) {
      iframe = null;
      selectOverlay = null;
      previewContainer.innerHTML = '<p class="html-block-empty">Empty HTML block</p>';
      syncInteractionUi();
      return;
    }

    previewContainer.innerHTML = '';
    iframe = createSandboxedIframe(html, { allowFullscreen: true });
    const previewIframe = iframe;
    const hasManualHeight = !!block.style && /(^|;)\s*height\s*:/.test(block.style);
    previewIframe.dataset.autoHeight = hasManualHeight ? 'false' : 'true';
    if (block.style) {
      previewIframe.style.cssText += `; ${block.style}`;
    }
    previewContainer.appendChild(previewIframe);

    selectOverlay = document.createElement('button');
    selectOverlay.type = 'button';
    selectOverlay.className = 'html-block-select-overlay';
    selectOverlay.setAttribute('aria-label', 'Select HTML block for resize');
    selectOverlay.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      EditMedia.select(previewIframe, block);
    });
    previewContainer.appendChild(selectOverlay);
    syncInteractionUi();
  }

  // Initial preview
  renderPreview(block.html || '');

  // Textarea
  const textarea = document.createElement('textarea');
  textarea.className = 'html-textarea';
  textarea.value = block.html || '';
  textarea.placeholder = 'Enter raw HTML...';
  textarea.style.display = 'none';
  const captionInput = createMediaCaptionInput(block.caption, context);
  wrapper.appendChild(textarea);
  wrapper.appendChild(controls);
  wrapper.appendChild(captionInput);

  toggleBtn.addEventListener('click', () => {
    isEditing = !isEditing;
    if (isEditing) {
      // Switch to edit mode
      previewContainer.style.display = 'none';
      textarea.style.display = 'block';
      toggleBtn.textContent = 'Preview';
      isInteractive = false;
      EditMedia.deselect();
      syncInteractionUi();
      textarea.focus();
    } else {
      // Switch to preview mode - update iframe now
      previewContainer.style.display = 'block';
      textarea.style.display = 'none';
      toggleBtn.textContent = 'Edit HTML';
      renderPreview(textarea.value);
    }
  });

  interactBtn.addEventListener('click', () => {
    if (!iframe || isEditing) return;
    isInteractive = !isInteractive;
    if (isInteractive) {
      EditMedia.deselect();
    } else {
      EditMedia.select(iframe, block);
    }
    syncInteractionUi();
  });

  // Update block data on textarea changes (no iframe update - wait for preview toggle)
  setupAutoResizeTextarea(textarea, (value) => {
    updateBlockFieldsInContext(context, { html: value }, { render: false });
  });

  syncInteractionUi();

  return wrapper;
}

// ========== MERGE DIVIDER & ADD BLOCK ==========

function canMergeBlocksIntoRow(afterIndex: number): boolean {
  const leftBlock = blocks[afterIndex - 1];
  const rightBlock = blocks[afterIndex];
  if (!leftBlock || !rightBlock) return false;
  return leftBlock.type !== 'row' && rightBlock.type !== 'row';
}

function mergeBlocksIntoRow(afterIndex: number): void {
  if (!canMergeBlocksIntoRow(afterIndex)) return;

  const leftBlock = blocks[afterIndex - 1];
  const rightBlock = blocks[afterIndex];
  if (!leftBlock || !rightBlock) return;

  const rowBlock = createBlock('row', { left: leftBlock, right: rightBlock }) as RowBlock;
  const nextBlocks = blocks.slice();
  nextBlocks.splice(afterIndex - 1, 2, rowBlock);
  applyBlocksUpdate(nextBlocks);
}

function swapRowColumns(index: number): void {
  updateTopLevelBlock(index, (block) => {
    if (block.type !== 'row') return block;
    return { ...block, left: block.right, right: block.left };
  });
}

function splitRowIntoBlocks(index: number): void {
  const rowBlock = blocks[index];
  if (!rowBlock || rowBlock.type !== 'row') return;

  const nextBlocks = blocks.slice();
  nextBlocks.splice(index, 1, rowBlock.left, rowBlock.right);
  applyBlocksUpdate(nextBlocks);
}

/**
 * Create divider between blocks with add button
 */
function createMergeDivider(afterIndex: number): HTMLElement {
  const divider = document.createElement('div');
  divider.className = 'merge-divider';
  divider.dataset.afterIndex = String(afterIndex);

  const addBtn = document.createElement('button');
  addBtn.className = 'merge-add-btn';
  addBtn.innerHTML = '+';
  addBtn.title = 'Add block';
  addBtn.addEventListener('click', () => {
    const rect = addBtn.getBoundingClientRect();
    EditSlash.showFromButton(rect, afterIndex, addBtn);
  });
  divider.appendChild(addBtn);

  if (canMergeBlocksIntoRow(afterIndex)) {
    const columnsBtn = document.createElement('button');
    columnsBtn.className = 'merge-columns-btn';
    columnsBtn.type = 'button';
    columnsBtn.innerHTML = ICONS.columns;
    columnsBtn.title = 'Turn these two blocks into columns';
    columnsBtn.addEventListener('click', () => {
      mergeBlocksIntoRow(afterIndex);
    });
    divider.appendChild(columnsBtn);
  }

  return divider;
}

/**
 * Create final "+" button to add a block at the end
 */
function createAddBlockButton(insertIndex: number, position: 'top' | 'bottom' = 'bottom'): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = `add-block-wrapper add-block-wrapper-${position}`;

  const btn = document.createElement('button');
  btn.className = 'merge-add-btn';
  btn.innerHTML = '+';
  btn.title = 'Add block';
  btn.addEventListener('click', () => {
    const rect = btn.getBoundingClientRect();
    EditSlash.showFromButton(rect, insertIndex, btn);
  });
  wrapper.appendChild(btn);

  return wrapper;
}

/**
 * Create upload zone for image/video blocks
 */
function createUploadZone(context: BlockContext, type: 'image' | 'video'): HTMLElement {
  const zone = document.createElement('div');
  zone.className = 'upload-zone';
  const isVideo = type === 'video';
  zone.innerHTML = `
    <div class="upload-icon">${isVideo ? ICONS.video : ICONS.image}</div>
    <div class="upload-text">Drop ${type} here or click to upload</div>
    ${isVideo
    ? `<div class="upload-zone-progress" hidden>
        <div class="upload-zone-progress-bar">
          <div class="upload-zone-progress-fill"></div>
        </div>
        <div class="upload-zone-progress-text" aria-live="polite"></div>
      </div>`
    : ''}
    <input type="file" class="upload-input" accept="${isVideo ? 'video/*' : 'image/*'}">
  `;

  const progressWrap = zone.querySelector<HTMLElement>('.upload-zone-progress');
  const progressFill = zone.querySelector<HTMLElement>('.upload-zone-progress-fill');
  const progressText = zone.querySelector<HTMLElement>('.upload-zone-progress-text');
  let uploadInFlight = false;

  const updateVideoProgress = (update: VideoUploadProgressUpdate): void => {
    if (!progressWrap || !progressFill || !progressText) return;

    progressWrap.hidden = false;
    progressFill.style.width = `${Math.max(0, Math.min(100, update.progress))}%`;
    progressFill.classList.toggle('is-indeterminate', update.stage === 'processing');
    progressText.textContent = update.message;

    zone.classList.toggle('uploading', update.stage !== 'error' && update.stage !== 'complete');
    zone.classList.toggle('upload-error', update.stage === 'error');
  };

  const handleFile = async (file: File): Promise<void> => {
    if (uploadInFlight) return;
    uploadInFlight = true;
    zone.classList.remove('upload-error');

    try {
      if (type === 'image') {
        await EditMedia.handleImageUploadForBlock(file, context.index, context.rowSide);
      } else {
        updateVideoProgress({
          stage: 'uploading',
          progress: 0,
          message: 'Starting upload...',
        });
        await EditMedia.handleVideoUploadForBlock(file, context.index, {
          rowSide: context.rowSide,
          onProgress: updateVideoProgress,
        });
      }
    } finally {
      uploadInFlight = false;
      input.value = '';
      if (type === 'image') {
        zone.classList.remove('uploading');
      }
    }
  };

  const input = zone.querySelector<HTMLInputElement>('.upload-input')!;
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (file) {
      await handleFile(file);
    }
  });

  zone.addEventListener('click', (e) => {
    if (uploadInFlight) return;
    if (e.target !== input) input.click();
  });

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (uploadInFlight) return;
    zone.classList.add('drag-over');
  });

  zone.addEventListener('dragleave', () => {
    zone.classList.remove('drag-over');
  });

  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (uploadInFlight) return;
    zone.classList.remove('drag-over');
    const file = e.dataTransfer?.files[0];
    if (file) {
      await handleFile(file);
    }
  });

  return zone;
}

// ========== DRAG & DROP ==========

function handleDragStart(e: DragEvent, index: number): void {
  dragState.sourceIndex = index;
  dragState.isDragging = true;

  const wrapper = container?.querySelector(`[data-block-index="${index}"]`);
  if (wrapper) {
    wrapper.classList.add('dragging');
  }

  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  }
}

function handleDragEnd(): void {
  dragState.isDragging = false;
  dragState.sourceIndex = null;
  dragState.currentDropIndex = null;

  container?.querySelectorAll('.dragging, .drag-over-top, .drag-over-bottom').forEach(el => {
    el.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
  });
}

function handleDragOver(e: DragEvent, index: number): void {
  e.preventDefault();
  if (!dragState.isDragging) return;

  const wrapper = e.currentTarget as HTMLElement;
  const rect = wrapper.getBoundingClientRect();
  const midpoint = rect.top + rect.height / 2;

  container?.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
    el.classList.remove('drag-over-top', 'drag-over-bottom');
  });

  if (e.clientY < midpoint) {
    wrapper.classList.add('drag-over-top');
    dragState.currentDropIndex = index;
  } else {
    wrapper.classList.add('drag-over-bottom');
    dragState.currentDropIndex = index + 1;
  }
}

function handleDragLeave(e: Event): void {
  const target = e.currentTarget as HTMLElement;
  target.classList.remove('drag-over-top', 'drag-over-bottom');
}

function handleDrop(e: DragEvent, _index: number): void {
  e.preventDefault();
  if (!dragState.isDragging || dragState.sourceIndex === null) return;

  const fromIndex = dragState.sourceIndex;
  let toIndex = dragState.currentDropIndex;

  if (toIndex === null) return;

  if (fromIndex < toIndex) {
    toIndex--;
  }

  if (fromIndex !== toIndex) {
    const nextBlocks = blocks.slice();
    const [movedBlock] = nextBlocks.splice(fromIndex, 1);
    if (movedBlock) {
      nextBlocks.splice(toIndex, 0, movedBlock);
      applyBlocksUpdate(nextBlocks);
    }
  }

  handleDragEnd();
}

// ========== BLOCK OPERATIONS ==========

/**
 * Insert a new block at the specified index
 */
export function insertBlock(index: number, type: BlockType, props: Partial<Block> = {}): void {
  const newBlock = createBlockWithProps(type, props);
  const insertIndex = Math.max(0, Math.min(index, blocks.length));
  const nextBlocks = blocks.slice();
  nextBlocks.splice(insertIndex, 0, newBlock);
  applyBlocksUpdate(nextBlocks);

  if (type === 'text' || type === 'callout') {
    setTimeout(() => {
      const textarea = container?.querySelector<HTMLTextAreaElement>(
        `[data-block-index="${insertIndex}"] .text-line-input, ` +
        `[data-block-index="${insertIndex}"] .block-textarea, ` +
        `[data-block-index="${insertIndex}"] .callout-textarea`
      );
      if (textarea) textarea.focus();
    }, 50);
  }
}

/**
 * Insert block after the specified block ID
 */
export function insertBlockAfter(blockId: string, type: BlockType, props: Partial<Block> = {}): void {
  const index = blocks.findIndex(b => b.id === blockId);
  if (index !== -1) {
    insertBlock(index + 1, type, props);
  }
}

/**
 * Delete a block
 */
export function deleteBlock(index: number): void {
  if (blocks.length <= 1) {
    applyBlocksUpdate([createBlock('text') as Block]);
  } else {
    const nextBlocks = blocks.slice();
    nextBlocks.splice(index, 1);
    applyBlocksUpdate(nextBlocks);
  }
}

// ========== SLASH COMMAND HANDLER ==========

interface SlashExecuteData {
  commandId: BlockType;
  insertIndex: number;
  replaceBlockIndex: number | null;
}

interface SlashUpdateData {
  index: number;
  content: string;
}

/**
 * Handle slash command execution
 */
function handleSlashCommand(
  action: 'execute' | 'updateContent',
  data: SlashExecuteData | SlashUpdateData
): void {
  if (action === 'execute') {
    const execData = data as SlashExecuteData;
    if (execData.replaceBlockIndex !== null) {
      const focusIndex = execData.replaceBlockIndex;
      updateTopLevelBlock(focusIndex, () => createBlock(execData.commandId) as Block);
      if (execData.commandId === 'text' || execData.commandId === 'callout') {
        setTimeout(() => {
          const textarea = container?.querySelector<HTMLTextAreaElement>(
            `[data-block-index="${focusIndex}"] .text-line-input, ` +
            `[data-block-index="${focusIndex}"] .block-textarea, ` +
            `[data-block-index="${focusIndex}"] .callout-textarea`
          );
          if (textarea) textarea.focus();
        }, 50);
      }
    } else {
      insertBlock(execData.insertIndex, execData.commandId);
    }
  } else if (action === 'updateContent') {
    const updateData = data as SlashUpdateData;
    updateTopLevelBlock(
      updateData.index,
      (block) => ('content' in block ? { ...block, content: updateData.content } as Block : block),
      { render: false, markDirty: false },
    );
  }
}

// ========== KEYBOARD HANDLER ==========

/**
 * Global keyboard handler
 */
function handleGlobalKeydown(e: KeyboardEvent): void {
  if (!isActive) return;

  if (EditSlash.isActive()) {
    if (EditSlash.handleKeydown(e)) return;
  }

  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) {
      EditUndo.redo();
    } else {
      EditUndo.undo();
    }
    return;
  }

  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    EditUndo.redo();
    return;
  }

  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    handleSave();
  }

  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    handleCancel();
  }
}

// ========== SAVE/CANCEL ==========

/**
 * Mark content as dirty (unsaved changes) and schedule auto-save
 */
export function markDirty(): void {
  isDirty = true;
  EditUndo.saveState();
  dispatchSaveAction({ type: 'edit' });
  scheduleAutoSave();
}

/**
 * Handle manual save
 */
async function handleSave(): Promise<void> {
  if (!isDirty && saveState !== SaveState.ERROR) {
    cleanup();
    window.location.reload();
    return;
  }

  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }

  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  if (abortController) {
    abortController.abort();
  }

  dispatchSaveAction({ type: 'save_start' });

  try {
    const markdown = blocksToMarkdown(blocks);

    let response: Response;
    if (editMode === 'about') {
      response = await fetch('/api/save-about', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          markdown,
          base_revision: currentRevision,
        }),
      });
    } else {
      const saveData = buildProjectSavePayload(markdown);

      response = await fetch('/api/save-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(saveData),
      });
    }

    if (response.status === 409) {
      dispatchSaveAction({ type: 'conflict' });
      showConflictBanner();
      return;
    }

    if (!response.ok) {
      throw new Error(`Save failed: ${response.status}`);
    }

    const result = await response.json();
    if (result.revision) {
      currentRevision = result.revision;
    }

    isDirty = false;
    dispatchSaveAction({ type: 'save_ok' });

    cleanup();
    window.location.reload();

  } catch (error) {
    console.error('Save error:', error);
    dispatchSaveAction({ type: 'save_error' });
    showNotification('Failed to save', 'error');
  }
}

/**
 * Handle cancel
 */
function handleCancel(): void {
  if (isDirty) {
    if (!confirm('You have unsaved changes. Discard them?')) {
      return;
    }
  }
  cleanup();
  window.location.reload();
}

// ========== UPDATE BLOCK ==========

/**
 * Update a block's data
 */
export function updateBlock(
  index: number,
  updates: Partial<Block>,
  options: UpdateBlockOptions = {}
): void {
  updateBlockFieldsInContext({ index }, updates, options);
}

// ========== PUBLIC API ==========

const EditMode = {
  // Initialization
  init,
  initAbout,
  cleanup,

  // State
  get blocks() { return blocks; },
  get isActive() { return isActive; },
  get isDirty() { return isDirty; },
  get projectSlug() { return projectSlug; },
  get editMode() { return editMode; },

  // Block operations
  insertBlock,
  insertBlockAfter,
  deleteBlock,
  updateBlock,
  renderBlocks,
  markDirty,

  // Save/Cancel
  save: handleSave,
  cancel: handleCancel,
};

export default EditMode;

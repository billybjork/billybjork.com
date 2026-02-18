/**
 * Edit Mode - Main Block Editor
 * Full block editor with drag-drop and slash commands
 * Supports both project pages and the about page
 */

import type { Block, BlockType, Alignment, TextBlock, ImageBlock, VideoBlock, CodeBlock, HtmlBlock, CalloutBlock, RowBlock } from '../types/blocks';
import type { ProjectData, AboutData } from '../types/api';
import {
  generateId,
  isDevMode,
  setupAutoResizeTextarea,
  createImageElement,
  createVideoElement,
  applyAlignment,
  insertTextWithUndo,
  handleFormattingShortcuts,
  handleListShortcuts,
  showNotification,
  fetchJSON,
} from '../core/utils';
import { createSandboxedIframe, cleanupIframe } from '../utils/html-sandbox';
import EditBlocks, { createBlock, blocksToMarkdown } from './blocks';
import EditSlash from './slash';
import EditMedia from './media';
import EditUndo from './undo';

// ========== TYPES ==========

type EditModeType = 'project' | 'about' | null;

enum SaveState {
  UNCHANGED = 'unchanged',
  PENDING = 'pending',
  SAVING = 'saving',
  SAVED = 'saved',
  ERROR = 'error',
}

interface DragState {
  sourceIndex: number | null;
  currentDropIndex: number | null;
  isDragging: boolean;
}

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
    projectData = await fetchJSON<ProjectData>(`/api/project/${slug}`);
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
    projectData = await fetchJSON<AboutData>('/api/about');
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

  // Add keyboard listener
  document.addEventListener('keydown', handleGlobalKeydown);

  // Render blocks
  renderBlocks();

  // Add editing class to body
  document.body.classList.add('editing');

  // Warn before leaving with unsaved changes
  window.addEventListener('beforeunload', handleBeforeUnload);
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
  saveState = SaveState.UNCHANGED;

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
    }
  }
}

/**
 * Set the save state and update UI
 */
function setSaveState(state: SaveState): void {
  saveState = state;
  updateToolbarStatus();

  // Clear fade timer if not in SAVED state
  if (state !== SaveState.SAVED && savedFadeTimer) {
    clearTimeout(savedFadeTimer);
    savedFadeTimer = null;
  }

  // Schedule fade for SAVED state
  if (state === SaveState.SAVED) {
    savedFadeTimer = setTimeout(() => {
      if (saveState === SaveState.SAVED) {
        setSaveState(SaveState.UNCHANGED);
      }
    }, SAVED_FADE_DELAY);
  }
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
  if (!isDirty || saveState === SaveState.SAVING) return;

  // Don't auto-save if project data isn't loaded (prevents creating orphaned files)
  if (editMode === 'project' && !projectData) {
    console.warn('Auto-save skipped: project data not loaded');
    return;
  }

  if (abortController) {
    abortController.abort();
  }
  abortController = new AbortController();

  setSaveState(SaveState.SAVING);

  try {
    const markdown = blocksToMarkdown(blocks);

    let response: Response;
    if (editMode === 'about') {
      response = await fetch('/api/save-about', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown }),
        signal: abortController.signal,
      });
    } else {
      // Preserve all existing project data, only update markdown
      const project = projectData as ProjectData;
      const saveData = {
        slug: projectSlug,
        name: project.name,
        date: project.date,
        pinned: project.pinned ?? false,
        draft: project.draft ?? false,
        youtube: project.youtube || '',
        video: project.video,
        markdown: markdown,
      };

      response = await fetch('/api/save-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(saveData),
        signal: abortController.signal,
      });
    }

    if (!response.ok) {
      throw new Error(`Save failed: ${response.status}`);
    }

    isDirty = false;
    setSaveState(SaveState.SAVED);

  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return;
    }
    console.error('Auto-save error:', error);
    setSaveState(SaveState.ERROR);

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

  blocks.forEach((block, index) => {
    if (index > 0) {
      cont.appendChild(createMergeDivider(index));
    }
    cont.appendChild(createBlockWrapper(block, index));
  });

  cont.appendChild(createAddBlockButton(blocks.length));
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
  handle.innerHTML = '\u22ee\u22ee';
  handle.draggable = true;
  handle.addEventListener('dragstart', (e) => handleDragStart(e, index));
  handle.addEventListener('dragend', handleDragEnd);
  wrapper.appendChild(handle);

  // Block content
  const content = document.createElement('div');
  content.className = 'block-content';
  content.appendChild(renderBlockContent(block, index));
  wrapper.appendChild(content);

  // Alignment toolbar (for most block types, except divider and code)
  if (block.type !== 'divider' && block.type !== 'code') {
    wrapper.appendChild(createAlignmentToolbar(block, index));
  }

  // Delete button
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'block-delete-btn';
  deleteBtn.innerHTML = '\u00d7';
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
function createAlignmentToolbar(block: Block, index: number): HTMLElement {
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
      setBlockAlignment(index, value);
    });
    alignToolbar.appendChild(btn);
  });

  return alignToolbar;
}

/**
 * Set alignment for a block
 */
function setBlockAlignment(index: number, align: Alignment): void {
  const block = blocks[index];
  if (block && 'align' in block) {
    (block as { align: Alignment }).align = align;
    markDirty();
    renderBlocks();
  }
}

/**
 * Render block content based on type
 */
function renderBlockContent(block: Block, index: number): HTMLElement {
  switch (block.type) {
    case 'text':
      return renderTextBlock(block, index);
    case 'image':
      return renderImageBlock(block, index);
    case 'video':
      return renderVideoBlock(block, index);
    case 'code':
      return renderCodeBlock(block, index);
    case 'html':
      return renderHtmlBlock(block, index);
    case 'callout':
      return renderCalloutBlock(block, index);
    case 'row':
      return renderRowBlock(block, index);
    case 'divider':
      return renderDividerBlock();
    default:
      return renderTextBlock(block as TextBlock, index);
  }
}

/**
 * Render text block
 */
function renderTextBlock(block: TextBlock, index: number): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'text-block-wrapper';
  wrapper.appendChild(createLineEditor(block, index));
  return wrapper;
}

/**
 * Create a line-based editor for a text block
 */
function createLineEditor(block: TextBlock, index: number): HTMLElement {
  const lineContainer = document.createElement('div');
  lineContainer.className = 'text-block-lines';

  if (block.align) {
    lineContainer.style.textAlign = block.align;
  }

  let lines = (block.content || '').split('\n');
  if (!lines.length) lines = [''];

  let activeLineIndex: number | null = null;

  const updateBlockContent = (): void => {
    block.content = lines.join('\n');
    markDirty();
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
      preview.classList.add('text-block-line-placeholder');
      preview.textContent = 'Type something... (type / for commands)';
    } else {
      preview.appendChild(renderLinePreview(lineText));
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
      EditSlash.handleTextareaInput(textarea, index);

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
      if (EditSlash.isActive()) {
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
      preview?.classList.add('text-block-line-placeholder');
      if (preview) preview.textContent = 'Type something... (type / for commands)';
    } else if (preview) {
      preview.appendChild(renderLinePreview(currentText));
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
function renderLinePreview(lineText: string): HTMLElement | DocumentFragment {
  const trimmed = lineText.trim();

  if (!trimmed) {
    const empty = document.createElement('span');
    empty.innerHTML = '&nbsp;';
    return empty;
  }

  if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
    const hr = document.createElement('hr');
    hr.className = 'text-line-divider';
    return hr;
  }

  const headingMatch = lineText.match(/^(\s*)(#{1,6})\s+(.*)$/);
  if (headingMatch) {
    const level = headingMatch[2]?.length ?? 1;
    const heading = document.createElement(`h${level}`) as HTMLHeadingElement;
    heading.appendChild(renderInlineMarkdown(headingMatch[3] ?? ''));
    return heading;
  }

  const quoteMatch = lineText.match(/^(\s*)>\s+(.*)$/);
  if (quoteMatch) {
    const quote = document.createElement('blockquote');
    quote.appendChild(renderInlineMarkdown(quoteMatch[2] ?? ''));
    return quote;
  }

  const span = document.createElement('span');
  span.appendChild(renderInlineMarkdown(lineText));
  return span;
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

/**
 * Render image block
 */
function renderImageBlock(block: ImageBlock, index: number): HTMLElement {
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
      const currentBlock = blocks[index];
      if (currentBlock && currentBlock.type === 'image') {
        (currentBlock as ImageBlock).alt = altInput.value;
        markDirty();
      }
    });
    wrapper.appendChild(altInput);
  } else {
    wrapper.appendChild(createUploadZone(index, 'image'));
  }

  return wrapper;
}

/**
 * Render video block
 */
function renderVideoBlock(block: VideoBlock, index: number): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'video-block-wrapper';

  if (block.src) {
    const video = createVideoElement(block);
    video.className = 'block-video';
    wrapper.appendChild(video);
  } else {
    wrapper.appendChild(createUploadZone(index, 'video'));
  }

  return wrapper;
}

/**
 * Render code block
 */
function renderCodeBlock(block: CodeBlock, index: number): HTMLElement {
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
    const currentBlock = blocks[index];
    if (currentBlock && currentBlock.type === 'code') {
      (currentBlock as CodeBlock).language = langSelect.value;
      markDirty();
    }
  });
  wrapper.appendChild(langSelect);

  const textarea = document.createElement('textarea');
  textarea.className = 'code-textarea';
  textarea.value = block.code || '';
  textarea.placeholder = 'Enter code...';
  textarea.spellcheck = false;

  setupAutoResizeTextarea(textarea, (value) => {
    const currentBlock = blocks[index];
    if (currentBlock && currentBlock.type === 'code') {
      (currentBlock as CodeBlock).code = value;
      markDirty();
    }
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
function renderCalloutBlock(block: CalloutBlock, index: number): HTMLElement {
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
    const currentBlock = blocks[index];
    if (currentBlock && currentBlock.type === 'callout') {
      (currentBlock as CalloutBlock).content = value;
      markDirty();
    }
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

  const leftCol = document.createElement('div');
  leftCol.className = 'row-column row-column-left';
  leftCol.appendChild(renderBlockContent(block.left, index));

  const rightCol = document.createElement('div');
  rightCol.className = 'row-column row-column-right';
  rightCol.appendChild(renderBlockContent(block.right, index));

  wrapper.appendChild(leftCol);
  wrapper.appendChild(rightCol);

  return wrapper;
}

/**
 * Render divider block
 */
function renderDividerBlock(): HTMLElement {
  const hr = document.createElement('hr');
  hr.className = 'block-divider';
  return hr;
}

/**
 * Render HTML block with iframe sandbox for isolation
 */
function renderHtmlBlock(block: HtmlBlock, index: number): HTMLElement {
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

  function renderPreview(html: string): void {
    // Clean up existing iframe
    if (iframe) {
      cleanupIframe(iframe);
      iframe.remove();
      iframe = null;
    }

    // Empty block: show placeholder, not iframe
    if (!html.trim()) {
      previewContainer.innerHTML = '<p class="html-block-empty">Empty HTML block</p>';
      return;
    }

    previewContainer.innerHTML = '';
    iframe = createSandboxedIframe(html, { allowFullscreen: true });
    previewContainer.appendChild(iframe);
  }

  // Initial preview
  renderPreview(block.html || '');

  // Toggle button
  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'html-toggle-btn';
  toggleBtn.textContent = 'Edit HTML';
  toggleBtn.type = 'button';
  wrapper.appendChild(toggleBtn);

  // Textarea
  const textarea = document.createElement('textarea');
  textarea.className = 'html-textarea';
  textarea.value = block.html || '';
  textarea.placeholder = 'Enter raw HTML...';
  textarea.style.display = 'none';
  wrapper.appendChild(textarea);

  let isEditing = false;
  toggleBtn.addEventListener('click', () => {
    isEditing = !isEditing;
    if (isEditing) {
      // Switch to edit mode
      previewContainer.style.display = 'none';
      textarea.style.display = 'block';
      toggleBtn.textContent = 'Preview';
      textarea.focus();
    } else {
      // Switch to preview mode - update iframe now
      previewContainer.style.display = 'block';
      textarea.style.display = 'none';
      toggleBtn.textContent = 'Edit HTML';
      renderPreview(textarea.value);
    }
  });

  // Update block data on textarea changes (no iframe update - wait for preview toggle)
  setupAutoResizeTextarea(textarea, (value) => {
    const currentBlock = blocks[index];
    if (currentBlock && currentBlock.type === 'html') {
      (currentBlock as HtmlBlock).html = value;
      markDirty();
    }
  });

  return wrapper;
}

// ========== MERGE DIVIDER & ADD BLOCK ==========

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

  return divider;
}

/**
 * Create final "+" button to add a block at the end
 */
function createAddBlockButton(insertIndex: number): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'add-block-wrapper';

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
function createUploadZone(index: number, type: 'image' | 'video'): HTMLElement {
  const zone = document.createElement('div');
  zone.className = 'upload-zone';
  zone.innerHTML = `
    <div class="upload-icon">${type === 'image' ? '\uD83D\uDDBC' : '\uD83C\uDFAC'}</div>
    <div class="upload-text">Drop ${type} here or click to upload</div>
    <input type="file" class="upload-input" accept="${type === 'image' ? 'image/*' : 'video/*'}">
  `;

  const input = zone.querySelector<HTMLInputElement>('.upload-input')!;
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (file) {
      if (type === 'image') {
        await EditMedia.handleImageUploadForBlock(file, index);
      } else {
        await EditMedia.handleVideoUploadForBlock(file, index);
      }
    }
  });

  zone.addEventListener('click', (e) => {
    if (e.target !== input) input.click();
  });

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });

  zone.addEventListener('dragleave', () => {
    zone.classList.remove('drag-over');
  });

  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer?.files[0];
    if (file) {
      if (type === 'image') {
        await EditMedia.handleImageUploadForBlock(file, index);
      } else {
        await EditMedia.handleVideoUploadForBlock(file, index);
      }
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
    const [movedBlock] = blocks.splice(fromIndex, 1);
    if (movedBlock) {
      blocks.splice(toIndex, 0, movedBlock);
      markDirty();
      renderBlocks();
    }
  }

  handleDragEnd();
}

// ========== BLOCK OPERATIONS ==========

/**
 * Insert a new block at the specified index
 */
export function insertBlock(index: number, type: BlockType): void {
  const newBlock = createBlock(type);

  blocks.splice(index, 0, newBlock);
  markDirty();
  renderBlocks();

  if (type === 'text' || type === 'callout') {
    setTimeout(() => {
      const textarea = container?.querySelector<HTMLTextAreaElement>(
        `[data-block-index="${index}"] .text-line-input, ` +
        `[data-block-index="${index}"] .block-textarea, ` +
        `[data-block-index="${index}"] .callout-textarea`
      );
      if (textarea) textarea.focus();
    }, 50);
  }
}

/**
 * Insert block after the specified block ID
 */
export function insertBlockAfter(blockId: string, type: BlockType): void {
  const index = blocks.findIndex(b => b.id === blockId);
  if (index !== -1) {
    insertBlock(index + 1, type);
  }
}

/**
 * Delete a block
 */
export function deleteBlock(index: number): void {
  if (blocks.length <= 1) {
    blocks[0] = createBlock('text');
  } else {
    blocks.splice(index, 1);
  }
  markDirty();
  renderBlocks();
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
      blocks[focusIndex] = createBlock(execData.commandId);
      markDirty();
      renderBlocks();
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
    const block = blocks[updateData.index];
    if (block && 'content' in block) {
      (block as TextBlock | CalloutBlock).content = updateData.content;
    }
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
  setSaveState(SaveState.PENDING);
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

  setSaveState(SaveState.SAVING);

  try {
    const markdown = blocksToMarkdown(blocks);

    let response: Response;
    if (editMode === 'about') {
      response = await fetch('/api/save-about', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown }),
      });
    } else {
      // Preserve all existing project data, only update markdown
      const project = projectData as ProjectData;
      const saveData = {
        slug: projectSlug,
        name: project.name,
        date: project.date,
        pinned: project.pinned ?? false,
        draft: project.draft ?? false,
        youtube: project.youtube || '',
        video: project.video,
        markdown: markdown,
      };

      response = await fetch('/api/save-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(saveData),
      });
    }

    if (!response.ok) {
      throw new Error(`Save failed: ${response.status}`);
    }

    isDirty = false;
    setSaveState(SaveState.SAVED);

    cleanup();
    window.location.reload();

  } catch (error) {
    console.error('Save error:', error);
    setSaveState(SaveState.ERROR);
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
export function updateBlock(index: number, updates: Partial<Block>): void {
  const block = blocks[index];
  if (block) {
    Object.assign(block, updates);
    markDirty();
    renderBlocks();
  }
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

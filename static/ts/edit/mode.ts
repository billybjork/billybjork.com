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
  toggleFormat,
  findLinkAtCursor,
  handleFormattingShortcuts,
  handleListShortcuts,
  insertLink,
  showNotification,
  fetchJSON,
} from '../core/utils';
import { createSandboxedIframe, cleanupIframe, applySandboxInlineStyle } from '../utils/html-sandbox';
import { escapeHtmlAttr } from '../core/text';
import EditBlocks, { createBlock, blocksToMarkdown } from './blocks';
import {
  applyBlockUpdates as applyBlockFieldUpdates,
  createBlockWithProps as createBlockWithPropsFromFactory,
  updateBlockFieldsInContext as computeUpdatedBlockFieldsInContext,
  updateBlockInContext as computeUpdatedBlockInContext,
  updateTopLevelBlock as computeUpdatedTopLevelBlock,
  type BlockContext,
} from './block-updates';
import {
  addCleanupCandidateUrl,
  isTrackableAssetUrl,
  trackPosterCleanupCandidatesFromBlock,
} from './asset-cleanup';
import EditSlash from './slash';
import EditMedia, { type VideoUploadProgressUpdate, uploadPosterForVideo, capturePosterFromVideo } from './media';
import EditUndo from './undo';
import { persistScrollForNavigation } from './scroll-restore';
import { ScrollAnchorManager } from './scroll-anchors';
import { slugify, uniqueSlug } from './slugify';
import { INLINE_MAX_DEPTH, findNextInlineMatch, renderInlineMarkdown, sanitizeUrl } from './inline-markdown';
import ProjectSettings from './project-settings';

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
  undo: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h8a8 8 0 0 1 8 8v3"/></svg>',
  redo: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 14l5-5-5-5"/><path d="M20 9h-8a8 8 0 0 0-8 8v3"/></svg>',
};

const INLINE_TOOLBAR_ACTIONS: Array<{
  action: InlineAction;
  title: string;
  ariaLabel: string;
  content: string;
  isHtml?: boolean;
}> = [
  { action: 'bold', content: 'B', ariaLabel: 'Bold', title: 'Bold (Cmd/Ctrl+B)' },
  { action: 'italic', content: 'I', ariaLabel: 'Italic', title: 'Italic (Cmd/Ctrl+I)' },
  { action: 'underline', content: 'U', ariaLabel: 'Underline', title: 'Underline (Cmd/Ctrl+U)' },
  {
    action: 'link',
    ariaLabel: 'Insert/Edit link',
    title: 'Insert/Edit link (Cmd/Ctrl+K)',
    isHtml: true,
    content: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 17H7a5 5 0 0 1 0-10h2"/><path d="M15 7h2a5 5 0 1 1 0 10h-2"/><path d="M8 12h8"/></svg>',
  },
  { action: 'heading-1', content: 'H1', ariaLabel: 'Heading 1', title: 'Heading 1' },
  { action: 'heading-2', content: 'H2', ariaLabel: 'Heading 2', title: 'Heading 2' },
  { action: 'heading-3', content: 'H3', ariaLabel: 'Heading 3', title: 'Heading 3' },
  { action: 'heading-4', content: 'H4', ariaLabel: 'Heading 4', title: 'Heading 4' },
];

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

type SaveAction =
  | { type: 'edit' }
  | { type: 'save_start' }
  | { type: 'save_ok' }
  | { type: 'save_error' }
  | { type: 'conflict' }
  | { type: 'fade' }
  | { type: 'reset' };

type InlineAction = 'bold' | 'italic' | 'underline' | 'link' | 'heading-1' | 'heading-2' | 'heading-3' | 'heading-4';

interface InlineToolbarContext {
  textarea: HTMLTextAreaElement;
  row: HTMLElement;
  onEdit: () => void;
}

interface HeroMediaControlsElement extends HTMLElement {
  refreshState?: () => void;
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
let hiddenProjectControls: HTMLElement | null = null;
let inlineProjectMetadataControls: HTMLElement | null = null;

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
let cleanupCandidateUrls = new Set<string>();
let cleanupFlushErrorLogged = false;

// Drag & Drop state
const dragState: DragState = {
  sourceIndex: null,
  currentDropIndex: null,
  isDragging: false,
};

// Hero thumbnail controls element (injected when edit mode activates for a project with hero video)
let heroThumbnailControls: HTMLElement | null = null;
let inlineToolbar: HTMLElement | null = null;
let inlineToolbarContext: InlineToolbarContext | null = null;
let inlineToolbarEventsBound = false;
let inlineToolbarUpdateRaf: number | null = null;

const scrollAnchors = new ScrollAnchorManager();

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
  const projectItem = editMode === 'project'
    ? contentContainer?.closest<HTMLElement>('.project-item') ?? null
    : null;

  if (!contentContainer) {
    console.error('Content container not found');
    return;
  }

  // For project mode, pause any playing videos
  if (editMode === 'project') {
    if (projectItem) {
      projectItem.querySelectorAll('video').forEach(video => {
        video.pause();
      });
    }

    // Hide project controls while edit mode is active.
    const editButtons = projectItem?.querySelector<HTMLElement>('.edit-buttons');
    if (editButtons) {
      hiddenProjectControls = editButtons;
      editButtons.classList.add('edit-controls-hidden');
    }
  }

  toolbar = createFixedToolbar(data);
  updateToolbarStatus();

  // Parse markdown into blocks
  const markdown = 'markdown' in data ? data.markdown : '';
  blocks = EditBlocks.parseIntoBlocks(markdown || '');
  cleanupCandidateUrls.clear();
  const initialScrollAnchor = scrollAnchors.captureContainerScrollAnchor(contentContainer);
  const initialContentBlockAnchor = scrollAnchors.captureContentBlockAnchor(contentContainer);

  // Create editor wrapper
  const editorWrapper = document.createElement('div');
  editorWrapper.className = 'edit-mode-container';

  editorWrapper.innerHTML = `
    <div class="edit-blocks-container"></div>
  `;

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
    restoreBlocks: restoreBlocksFromHistory,
    markDirty,
  });
  EditUndo.saveState();

  // Add keyboard listener
  document.addEventListener('keydown', handleGlobalKeydown);

  // Mark edit state before block rendering so video elements never autoplay in the editor.
  document.body.classList.add('editing');
  initInlineToolbar();

  if (editMode === 'project' && projectItem) {
    const project = data as ProjectData;
    setupEditableProjectHeader(projectItem, project);

    const details = projectItem.querySelector<HTMLElement>('.project-details');
    const videoContainer = details?.querySelector<HTMLElement>('.video-container');

    inlineProjectMetadataControls = createInlineProjectMetadataControls(project);
    if (inlineProjectMetadataControls) {
      if (videoContainer) {
        videoContainer.before(inlineProjectMetadataControls);
      } else {
        contentContainer.before(inlineProjectMetadataControls);
      }
    }

    heroThumbnailControls = createHeroThumbnailControls(project);
    if (videoContainer) {
      videoContainer.after(heroThumbnailControls);
    } else if (inlineProjectMetadataControls) {
      inlineProjectMetadataControls.after(heroThumbnailControls);
    } else {
      contentContainer.before(heroThumbnailControls);
    }
  }

  // Render blocks
  renderBlocks();
  const stabilityRoot = editMode === 'project'
    ? (contentContainer.closest('.project-item') ?? contentContainer)
    : contentContainer;
  if (initialContentBlockAnchor) {
    scrollAnchors.restoreModeSwitchBlockAnchor({
      anchor: initialContentBlockAnchor,
      container,
      blockCount: blocks.length,
      stabilityRoot,
    });
  } else {
    scrollAnchors.restoreContainerScrollAnchor({
      contentContainer,
      anchor: initialScrollAnchor,
      stabilityRoot,
    });
  }

  // Warn before leaving with unsaved changes
  window.addEventListener('beforeunload', handleBeforeUnload);
}

// ========== CONFLICT RESOLUTION ==========

function buildProjectSavePayload(markdown: string, options: { force?: boolean } = {}): Record<string, unknown> {
  if (editMode !== 'project' || !projectSlug || !projectData) {
    throw new Error('Project data is not loaded');
  }

  const project = projectData as ProjectData;
  const nextSlug = String(project.slug || projectSlug).trim();
  const payload: Record<string, unknown> = {
    slug: nextSlug,
    original_slug: projectSlug,
    name: project.name,
    date: project.date,
    pinned: project.pinned ?? false,
    draft: project.draft ?? false,
    youtube: project.youtube || '',
    video: project.video ?? {},
    markdown,
  };

  if (cleanupCandidateUrls.size > 0) {
    payload.cleanup_candidates = Array.from(cleanupCandidateUrls);
  }

  if (options.force) {
    payload.force = true;
  } else {
    payload.base_revision = currentRevision;
  }

  return payload;
}

function syncProjectSlug(nextSlugValue: unknown): void {
  if (editMode !== 'project' || typeof nextSlugValue !== 'string') return;

  const nextSlug = nextSlugValue.trim();
  if (!nextSlug || !projectData || !('slug' in projectData)) return;

  const previousSlug = projectSlug;
  (projectData as ProjectData).slug = nextSlug;
  if (previousSlug === nextSlug) return;

  projectSlug = nextSlug;

  const projectItem = document.querySelector<HTMLElement>('.project-item.active');
  if (projectItem) {
    projectItem.dataset.slug = nextSlug;
    if (previousSlug && projectItem.id === `project-${previousSlug}`) {
      projectItem.id = `project-${nextSlug}`;
    }
    const details = projectItem.querySelector<HTMLElement>('.project-details');
    if (details && previousSlug && details.id === `details-${previousSlug}`) {
      details.id = `details-${nextSlug}`;
    }
  }

  const slugInput = inlineProjectMetadataControls?.querySelector<HTMLInputElement>('#inline-settings-slug');
  if (slugInput) {
    slugInput.value = nextSlug;
  }

  const url = new URL(window.location.href);
  if (url.pathname !== `/${nextSlug}`) {
    url.pathname = `/${nextSlug}`;
    window.history.replaceState({}, '', url.toString());
  }
}

function applyProjectSaveResult(result: { revision?: string; slug?: string }): void {
  if (result.revision) {
    currentRevision = result.revision;
  }
  if (editMode === 'project') {
    cleanupCandidateUrls.clear();
    syncProjectSlug(result.slug);
  }
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
        applyProjectSaveResult(result);
        isDirty = false;
        dispatchSaveAction({ type: 'save_ok' });
        showNotification('Changes saved (overwritten)', 'success');
      } else {
        dispatchSaveAction({ type: 'save_error' });
        showNotification('Force save failed', 'error');
      }
    } catch (error) {
      console.error('Force save failed:', error);
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
  cleanupCandidateUrls.clear();

  // Remove conflict banner if present
  document.querySelector('.edit-conflict-banner')?.remove();

  document.removeEventListener('keydown', handleGlobalKeydown);
  window.removeEventListener('beforeunload', handleBeforeUnload);
  EditSlash.cleanup();
  EditMedia.deselect();
  teardownInlineToolbar();
  document.body.classList.remove('editing');

  // Remove edit-mode-active class from the appropriate container
  const contentContainer = editMode === 'about'
    ? document.querySelector('.about-content')
    : document.querySelector('.project-content');
  if (contentContainer) {
    contentContainer.classList.remove('edit-mode-active');
  }

  if (toolbar) {
    toolbar.remove();
    toolbar = null;
  }

  // Restore hidden project controls
  if (hiddenProjectControls) {
    hiddenProjectControls.classList.remove('edit-controls-hidden');
    hiddenProjectControls = null;
  }

  // Remove hero thumbnail controls
  if (heroThumbnailControls) {
    heroThumbnailControls.remove();
    heroThumbnailControls = null;
  }
  if (inlineProjectMetadataControls) {
    inlineProjectMetadataControls.remove();
    inlineProjectMetadataControls = null;
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

function createFixedToolbar(data: ProjectData | AboutData): HTMLElement {
  const title = editMode === 'about'
    ? 'About Page'
    : ('name' in data ? data.name : 'Project');

  const bar = document.createElement('div');
  bar.className = 'edit-mode-toolbar edit-mode-toolbar-fixed';
  bar.innerHTML = `
    <div class="edit-toolbar-left">
      <span class="edit-project-name">Editing: ${escapeHtmlAttr(title)}</span>
      <span class="edit-status" aria-live="polite"></span>
    </div>
    <div class="edit-toolbar-right">
      <button class="edit-btn edit-btn-icon" data-action="undo" aria-label="Undo" title="Undo (Cmd/Ctrl+Z)">${ICONS.undo}</button>
      <button class="edit-btn edit-btn-icon" data-action="redo" aria-label="Redo" title="Redo (Cmd/Ctrl+Shift+Z / Cmd/Ctrl+Y)">${ICONS.redo}</button>
      <button class="edit-btn edit-btn-secondary" data-action="cancel">Discard</button>
      <button class="edit-btn edit-btn-primary" data-action="save">Save</button>
    </div>
  `;
  bar.querySelector('[data-action="undo"]')?.addEventListener('click', handleUndoAction);
  bar.querySelector('[data-action="redo"]')?.addEventListener('click', handleRedoAction);
  bar.querySelector('[data-action="undo"]')?.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });
  bar.querySelector('[data-action="redo"]')?.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });
  bar.querySelector('[data-action="cancel"]')?.addEventListener('click', handleCancel);
  bar.querySelector('[data-action="save"]')?.addEventListener('click', handleSave);
  document.body.appendChild(bar);
  return bar;
}

function initInlineToolbar(): void {
  ensureInlineToolbar();
  if (inlineToolbarEventsBound) return;

  document.addEventListener('selectionchange', handleInlineToolbarSelectionChange);
  window.addEventListener('resize', scheduleInlineToolbarUpdate);
  window.addEventListener('scroll', scheduleInlineToolbarUpdate, true);
  inlineToolbarEventsBound = true;
}

function teardownInlineToolbar(): void {
  if (inlineToolbarUpdateRaf !== null) {
    cancelAnimationFrame(inlineToolbarUpdateRaf);
    inlineToolbarUpdateRaf = null;
  }
  if (inlineToolbarEventsBound) {
    document.removeEventListener('selectionchange', handleInlineToolbarSelectionChange);
    window.removeEventListener('resize', scheduleInlineToolbarUpdate);
    window.removeEventListener('scroll', scheduleInlineToolbarUpdate, true);
    inlineToolbarEventsBound = false;
  }
  inlineToolbarContext = null;
  if (inlineToolbar) {
    inlineToolbar.remove();
    inlineToolbar = null;
  }
}

function ensureInlineToolbar(): HTMLElement {
  if (inlineToolbar) return inlineToolbar;

  const toolbarEl = document.createElement('div');
  toolbarEl.className = 'inline-format-toolbar';
  INLINE_TOOLBAR_ACTIONS.forEach(({ action, content, title, ariaLabel, isHtml }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `inline-format-btn inline-format-btn-${action}`;
    btn.dataset.action = action;
    btn.setAttribute('aria-label', ariaLabel);
    btn.title = title;
    if (isHtml) {
      btn.innerHTML = content;
    } else {
      btn.textContent = content;
    }
    btn.addEventListener('mousedown', (event) => {
      event.preventDefault();
    });
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      applyInlineToolbarAction(action);
    });
    toolbarEl.appendChild(btn);
  });
  document.body.appendChild(toolbarEl);
  inlineToolbar = toolbarEl;
  return toolbarEl;
}

function setInlineToolbarContext(context: InlineToolbarContext | null): void {
  inlineToolbarContext = context;
  scheduleInlineToolbarUpdate();
}

function handleInlineToolbarSelectionChange(): void {
  scheduleInlineToolbarUpdate();
}

function scheduleInlineToolbarUpdate(): void {
  if (!isActive) return;
  if (inlineToolbarUpdateRaf !== null) return;
  inlineToolbarUpdateRaf = requestAnimationFrame(() => {
    inlineToolbarUpdateRaf = null;
    updateInlineToolbar();
  });
}

function updateInlineToolbar(): void {
  const toolbarEl = ensureInlineToolbar();
  const context = inlineToolbarContext;

  if (!context || !context.row.isConnected || !context.textarea.isConnected) {
    toolbarEl.classList.remove('visible');
    return;
  }

  const textarea = context.textarea;
  const { selectionStart, selectionEnd } = textarea;
  if (document.activeElement !== textarea || selectionStart === selectionEnd) {
    toolbarEl.classList.remove('visible');
    return;
  }

  const selectionRect = getTextareaSelectionRect(textarea);
  if (!selectionRect) {
    toolbarEl.classList.remove('visible');
    return;
  }

  updateInlineToolbarButtonState(textarea);

  toolbarEl.classList.add('visible');
  const toolbarRect = toolbarEl.getBoundingClientRect();
  const margin = 8;
  let left = selectionRect.left + (selectionRect.width / 2) - (toolbarRect.width / 2);
  left = Math.max(margin, Math.min(left, window.innerWidth - toolbarRect.width - margin));

  let top = selectionRect.top - toolbarRect.height - 10;
  if (top < margin) {
    top = selectionRect.bottom + 10;
  }
  toolbarEl.style.left = `${Math.max(margin, left)}px`;
  toolbarEl.style.top = `${Math.max(margin, top)}px`;
}

function updateInlineToolbarButtonState(textarea: HTMLTextAreaElement): void {
  if (!inlineToolbar) return;

  const { value, selectionStart, selectionEnd } = textarea;
  const hasSelection = selectionStart < selectionEnd;
  const lineHeadingLevel = getLineHeadingLevel(value);
  const linkInfo = hasSelection ? findLinkAtCursor(textarea) : null;
  const linkActive = !!linkInfo && selectionStart >= linkInfo.start && selectionEnd <= linkInfo.end;

  inlineToolbar.querySelectorAll<HTMLButtonElement>('.inline-format-btn').forEach((btn) => {
    const action = btn.dataset.action as InlineAction | undefined;
    if (!action) return;

    let active = false;
    switch (action) {
      case 'bold':
        active = hasSelection && hasInlineFormat(value, selectionStart, selectionEnd, '**', '**', 'bold');
        break;
      case 'italic':
        active = hasSelection && hasInlineFormat(value, selectionStart, selectionEnd, '*', '*', 'italic');
        break;
      case 'underline':
        active = hasSelection && hasInlineFormat(value, selectionStart, selectionEnd, '<u>', '</u>');
        break;
      case 'link':
        active = linkActive;
        break;
      case 'heading-1':
      case 'heading-2':
      case 'heading-3':
      case 'heading-4':
        active = lineHeadingLevel === Number.parseInt(action.slice(-1), 10);
        break;
      default:
        active = false;
    }

    btn.classList.toggle('is-active', active);
  });
}

function applyInlineToolbarAction(action: InlineAction): void {
  if (!inlineToolbarContext) return;
  const { textarea, onEdit } = inlineToolbarContext;

  switch (action) {
    case 'bold':
      toggleFormat(textarea, '**', '**', onEdit);
      break;
    case 'italic':
      toggleFormat(textarea, '*', '*', onEdit);
      break;
    case 'underline':
      toggleFormat(textarea, '<u>', '</u>', onEdit);
      break;
    case 'link':
      void insertLink(textarea, container, () => {
        onEdit();
        scheduleInlineToolbarUpdate();
      });
      return;
    case 'heading-1':
    case 'heading-2':
    case 'heading-3':
    case 'heading-4':
      toggleLineHeading(textarea, Number.parseInt(action.slice(-1), 10));
      onEdit();
      break;
    default:
      return;
  }

  scheduleInlineToolbarUpdate();
}

function toggleLineHeading(textarea: HTMLTextAreaElement, level: number): void {
  const clampedLevel = Math.max(1, Math.min(level, 6));
  const value = textarea.value;
  const selectionStart = textarea.selectionStart;
  const selectionEnd = textarea.selectionEnd;

  const headingMatch = value.match(/^(\s*)(#{1,6})\s+(.*)$/);
  const indentMatch = value.match(/^(\s*)/);
  const indent = headingMatch?.[1] ?? indentMatch?.[1] ?? '';
  const hashes = '#'.repeat(clampedLevel);

  let nextValue = value;
  let oldPrefixLength = indent.length;
  let nextPrefixLength = indent.length;

  if (headingMatch) {
    const currentLevel = headingMatch[2]?.length ?? 1;
    const body = headingMatch[3] ?? '';
    oldPrefixLength = indent.length + currentLevel + 1;
    if (currentLevel === clampedLevel) {
      nextValue = `${indent}${body}`;
      nextPrefixLength = indent.length;
    } else {
      nextValue = `${indent}${hashes} ${body}`;
      nextPrefixLength = indent.length + hashes.length + 1;
    }
  } else {
    const body = value.slice(indent.length).replace(/^\s+/, '');
    nextValue = `${indent}${hashes} ${body}`;
    oldPrefixLength = indent.length;
    nextPrefixLength = indent.length + hashes.length + 1;
  }

  textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(0, textarea.value.length);
  insertTextWithUndo(textarea, nextValue);

  const delta = nextPrefixLength - oldPrefixLength;
  const nextStart = Math.max(0, Math.min(nextValue.length, selectionStart + delta));
  const nextEnd = Math.max(0, Math.min(nextValue.length, selectionEnd + delta));
  textarea.selectionStart = nextStart;
  textarea.selectionEnd = nextEnd;
}

function getLineHeadingLevel(text: string): number | null {
  const match = text.match(/^(\s*)(#{1,6})\s+/);
  if (!match) return null;
  return match[2]?.length ?? null;
}

function hasInlineFormat(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  before: string,
  after: string,
  kind: 'default' | 'bold' | 'italic' = 'default'
): boolean {
  const formatInfo = findInlineFormatAroundSelection(value, selectionStart, selectionEnd, before, after, kind);
  return !!formatInfo;
}

function findInlineFormatAroundSelection(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  before: string,
  after: string,
  kind: 'default' | 'bold' | 'italic' = 'default'
): { innerStart: number; innerEnd: number } | null {
  const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
  const lineEnd = value.indexOf('\n', selectionEnd);
  const effectiveLineEnd = lineEnd === -1 ? value.length : lineEnd;

  let openPos = -1;
  for (let i = selectionStart; i >= lineStart; i -= 1) {
    if (value.slice(i, i + before.length) !== before) continue;
    const charBefore = i > 0 ? value[i - 1] : '';
    const charAfter = i + before.length < value.length ? value[i + before.length] : '';
    if (kind === 'bold' && (charBefore === '*' || charAfter === '*')) continue;
    if (kind === 'italic' && (charBefore === '*' || charAfter === '*')) continue;
    openPos = i;
    break;
  }
  if (openPos === -1) return null;

  let closePos = -1;
  const searchStart = Math.max(openPos + before.length, selectionEnd);
  for (let i = searchStart; i <= effectiveLineEnd - after.length; i += 1) {
    if (value.slice(i, i + after.length) !== after) continue;
    const charBefore = i > 0 ? value[i - 1] : '';
    const charAfter = i + after.length < value.length ? value[i + after.length] : '';
    if (kind === 'bold' && (charBefore === '*' || charAfter === '*')) continue;
    if (kind === 'italic' && (charBefore === '*' || charAfter === '*')) continue;
    closePos = i;
    break;
  }
  if (closePos === -1) return null;

  const innerStart = openPos + before.length;
  const innerEnd = closePos;
  if (selectionStart < innerStart || selectionEnd > innerEnd) return null;
  return { innerStart, innerEnd };
}

function getTextareaSelectionRect(textarea: HTMLTextAreaElement): DOMRect | null {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  if (start === end) return null;

  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement('div');
  const properties = [
    'box-sizing',
    'width',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'line-height',
    'letter-spacing',
    'text-transform',
    'text-align',
    'white-space',
    'word-break',
    'overflow-wrap',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'border-top-width',
    'border-right-width',
    'border-bottom-width',
    'border-left-width',
  ];

  properties.forEach((property) => {
    mirror.style.setProperty(property, style.getPropertyValue(property));
  });

  mirror.style.position = 'fixed';
  mirror.style.left = '-9999px';
  mirror.style.top = '0';
  mirror.style.visibility = 'hidden';
  mirror.style.pointerEvents = 'none';
  mirror.style.height = 'auto';
  mirror.style.minHeight = '0';
  mirror.style.maxHeight = 'none';
  mirror.style.overflow = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.wordWrap = 'break-word';
  mirror.style.width = `${textarea.offsetWidth}px`;

  const before = document.createTextNode(textarea.value.slice(0, start));
  const highlight = document.createElement('span');
  highlight.textContent = textarea.value.slice(start, end) || ' ';
  mirror.appendChild(before);
  mirror.appendChild(highlight);
  document.body.appendChild(mirror);

  const highlightRect = highlight.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  const textareaRect = textarea.getBoundingClientRect();

  const left = textareaRect.left + (highlightRect.left - mirrorRect.left) - textarea.scrollLeft;
  const top = textareaRect.top + (highlightRect.top - mirrorRect.top) - textarea.scrollTop;
  const width = Math.max(1, highlightRect.width);
  const height = Math.max(1, highlightRect.height);

  mirror.remove();
  return new DOMRect(left, top, width, height);
}

/**
 * Update toolbar status indicator based on save state
 */
function updateToolbarStatus(): void {
  if (!toolbar) return;
  const status = toolbar.querySelector<HTMLElement>('.edit-status');
  const saveBtn = toolbar.querySelector<HTMLButtonElement>('[data-action="save"]');

  // Remove all state classes
  saveBtn?.classList.remove('has-changes', 'is-saving', 'has-error');
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save';
  }

  if (status) {
    switch (saveState) {
      case SaveState.UNCHANGED:
        status.textContent = 'No unsaved changes';
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
        if (saveBtn) {
          saveBtn.disabled = true;
          saveBtn.textContent = 'Saving...';
        }
        break;
      case SaveState.SAVED:
        status.textContent = 'All changes saved';
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

  const undoBtn = toolbar.querySelector<HTMLButtonElement>('[data-action="undo"]');
  const redoBtn = toolbar.querySelector<HTMLButtonElement>('[data-action="redo"]');
  if (undoBtn) {
    undoBtn.disabled = false;
  }
  if (redoBtn) {
    redoBtn.disabled = false;
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
  const renderScrollAnchor = render ? scrollAnchors.captureRenderScrollAnchor(container) : null;
  blocks = nextBlocks;
  if (shouldMarkDirty) {
    markDirty();
  }
  if (render) {
    renderBlocks();
    scrollAnchors.restoreRenderScrollAnchor({
      anchor: renderScrollAnchor,
      container,
      blockCount: blocks.length,
    });
  }
}

function updateTopLevelBlock(
  index: number,
  updater: (block: Block) => Block,
  options: UpdateBlockOptions = {}
): boolean {
  const result = computeUpdatedTopLevelBlock(blocks, index, updater);
  if (!result.changed) return false;
  applyBlocksUpdate(result.nextBlocks, options);
  return true;
}

function updateBlockInContext(
  context: BlockContext,
  updater: (block: Block) => Block,
  options: UpdateBlockOptions = {}
): boolean {
  const result = computeUpdatedBlockInContext(blocks, context, updater);
  if (!result.changed) return false;
  applyBlocksUpdate(result.nextBlocks, options);
  return true;
}

function updateBlockFieldsInContext(
  context: BlockContext,
  updates: Partial<Block>,
  options: UpdateBlockOptions = {}
): void {
  const result = computeUpdatedBlockFieldsInContext(blocks, context, updates);
  if (!result.changed) return;
  applyBlocksUpdate(result.nextBlocks, options);
}

function createBlockWithProps(type: BlockType, props: Partial<Block> = {}): Block {
  return createBlockWithPropsFromFactory(
    (nextType, nextProps) => createBlock(nextType as never, nextProps as never) as Block,
    type,
    props
  );
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
    applyProjectSaveResult(result);

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

interface FocusSnapshot {
  blockIndex: number;
  lineIndex: number | null;
  inputClass: string;
  selectionStart: number;
  selectionEnd: number;
}

function getBlockStructureSignature(block: Block): string {
  if (block.type === 'row') {
    return `row:${block.id}:${block.left.type}:${block.left.id}:${block.right.type}:${block.right.id}`;
  }
  return `${block.type}:${block.id}`;
}

function getBlocksStructureSignature(list: Block[]): string {
  return list.map(getBlockStructureSignature).join('|');
}

function captureFocusSnapshot(): FocusSnapshot | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement)) return null;

  const wrapper = active.closest<HTMLElement>('.block-wrapper');
  if (!wrapper) return null;

  const blockIndex = Number.parseInt(wrapper.dataset.blockIndex ?? '', 10);
  if (Number.isNaN(blockIndex)) return null;

  const lineRow = active.closest<HTMLElement>('.text-block-line');
  const lineIndexRaw = lineRow ? Number.parseInt(lineRow.dataset.lineIndex ?? '', 10) : Number.NaN;
  const lineIndex = Number.isNaN(lineIndexRaw) ? null : lineIndexRaw;

  return {
    blockIndex,
    lineIndex,
    inputClass: active.className || '',
    selectionStart: active.selectionStart ?? 0,
    selectionEnd: active.selectionEnd ?? 0,
  };
}

function restoreFocusSnapshot(snapshot: FocusSnapshot | null): void {
  if (!snapshot || !container) return;

  const wrapper = container.querySelector<HTMLElement>(`.block-wrapper[data-block-index="${snapshot.blockIndex}"]`);
  if (!wrapper) return;

  if (snapshot.lineIndex !== null) {
    const row = wrapper.querySelector<HTMLElement>(`.text-block-line[data-line-index="${snapshot.lineIndex}"]`);
    if (row && !row.classList.contains('is-editing')) {
      row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }
  }

  let input: HTMLTextAreaElement | HTMLInputElement | null = null;
  if (snapshot.lineIndex !== null) {
    input = wrapper.querySelector<HTMLTextAreaElement>(`.text-block-line[data-line-index="${snapshot.lineIndex}"] .text-line-input`);
  }

  if (!input && snapshot.inputClass.trim()) {
    const classSelector = snapshot.inputClass
      .split(/\s+/)
      .filter(Boolean)
      .map((className) => `.${className}`)
      .join('');
    if (classSelector) {
      input = wrapper.querySelector<HTMLTextAreaElement | HTMLInputElement>(classSelector);
    }
  }

  if (!input) {
    input = wrapper.querySelector<HTMLTextAreaElement | HTMLInputElement>('textarea, input[type="text"], input[type="url"]');
  }
  if (!input) return;

  input.focus({ preventScroll: true });
  const valueLength = input.value.length;
  const start = Math.max(0, Math.min(valueLength, snapshot.selectionStart));
  const end = Math.max(0, Math.min(valueLength, snapshot.selectionEnd));
  input.selectionStart = start;
  input.selectionEnd = end;
}

function restoreBlocksFromHistory(nextBlocks: Block[]): void {
  const previousBlocks = blocks;
  const focusSnapshot = captureFocusSnapshot();
  EditMedia.deselect();

  const previousSignature = getBlocksStructureSignature(previousBlocks);
  const nextSignature = getBlocksStructureSignature(nextBlocks);

  blocks = nextBlocks;

  if (!container || previousSignature !== nextSignature) {
    renderBlocks();
    restoreFocusSnapshot(focusSnapshot);
    return;
  }

  let requiresFullRender = false;

  for (let index = 0; index < nextBlocks.length; index += 1) {
    const prevBlock = previousBlocks[index];
    const nextBlock = nextBlocks[index];
    if (!prevBlock || !nextBlock) {
      requiresFullRender = true;
      break;
    }

    if (JSON.stringify(prevBlock) === JSON.stringify(nextBlock)) {
      continue;
    }

    const wrapper = container.querySelector<HTMLElement>(`.block-wrapper[data-block-index="${index}"]`);
    if (!wrapper) {
      requiresFullRender = true;
      break;
    }

    const content = wrapper.querySelector<HTMLElement>(':scope > .block-content');
    if (!content) {
      requiresFullRender = true;
      break;
    }

    wrapper.dataset.blockId = nextBlock.id;
    wrapper.dataset.blockType = nextBlock.type;

    content.innerHTML = '';
    content.appendChild(renderBlockContent(nextBlock, { index }));

    const hasAlignmentToolbar = nextBlock.type !== 'divider' && nextBlock.type !== 'code' && nextBlock.type !== 'row';
    const currentAlignmentToolbar = wrapper.querySelector<HTMLElement>(':scope > .block-align-toolbar');
    if (hasAlignmentToolbar) {
      const nextAlignmentToolbar = createAlignmentToolbar(nextBlock, { index });
      if (currentAlignmentToolbar) {
        currentAlignmentToolbar.replaceWith(nextAlignmentToolbar);
      } else {
        wrapper.appendChild(nextAlignmentToolbar);
      }
    } else {
      currentAlignmentToolbar?.remove();
    }
  }

  if (requiresFullRender) {
    renderBlocks();
  } else {
    setInlineToolbarContext(null);
  }

  restoreFocusSnapshot(focusSnapshot);
}

/**
 * Render all blocks to the container
 */
export function renderBlocks(): void {
  if (!container) return;

  EditMedia.deselect();
  setInlineToolbarContext(null);

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
  let suppressNextLineActivationClick = false;
  const slashEnabled = !context.rowSide;

  const headingIdForLine = (lineText: string, targetLineIndex: number): string | null => {
    if (targetLineIndex < 0) return null;
    const slugState = new Set<string>();
    for (let i = 0; i <= targetLineIndex; i += 1) {
      const text = i === targetLineIndex ? lineText : (lines[i] ?? '');
      const headingMatch = text.match(/^(\s*)(#{1,6})\s+(.*)$/);
      if (!headingMatch) continue;

      const tmp = document.createElement('span');
      tmp.appendChild(renderInlineMarkdown(headingMatch[3] ?? ''));
      const baseSlug = slugify(tmp.textContent?.trim() ?? '');
      if (!baseSlug) continue;

      const unique = uniqueSlug(baseSlug, slugState);
      if (i === targetLineIndex) {
        return unique;
      }
    }
    return null;
  };

  type CaretPositionLike = {
    offsetNode: Node;
    offset: number;
  };

  type CaretPointDocument = Document & {
    caretPositionFromPoint?: (x: number, y: number) => CaretPositionLike | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };

  const clamp = (value: number, min: number, max: number): number => (
    Math.max(min, Math.min(max, value))
  );

  const mapLiteralToRawBoundaries = (text: string, rawStart: number): number[] => {
    const map = [rawStart];
    for (let i = 0; i < text.length; i++) {
      map.push(rawStart + i + 1);
    }
    return map;
  };

  const appendBoundaryMap = (target: number[], incoming: number[]): void => {
    if (!incoming.length) return;
    target[target.length - 1] = incoming[0] ?? target[target.length - 1] ?? 0;
    if (incoming.length > 1) {
      target.push(...incoming.slice(1));
    }
  };

  const mapInlineToRawBoundaries = (text: string, rawStart: number, depth = 0): number[] => {
    const map = [rawStart];
    if (!text) return map;

    if (depth >= INLINE_MAX_DEPTH) {
      appendBoundaryMap(map, mapLiteralToRawBoundaries(text, rawStart));
      return map;
    }

    let cursor = 0;
    while (cursor < text.length) {
      const remaining = text.slice(cursor);
      const match = findNextInlineMatch(remaining);

      if (!match) {
        appendBoundaryMap(map, mapLiteralToRawBoundaries(remaining, rawStart + cursor));
        break;
      }

      if (match.index > 0) {
        const literal = remaining.slice(0, match.index);
        appendBoundaryMap(map, mapLiteralToRawBoundaries(literal, rawStart + cursor));
      }

      const tokenStart = cursor + match.index;
      const tokenRawStart = rawStart + tokenStart;
      const tokenText = remaining.slice(match.index, match.index + match.length);
      const contentIndex = tokenText.indexOf(match.content);

      if (contentIndex < 0) {
        appendBoundaryMap(map, mapLiteralToRawBoundaries(tokenText, tokenRawStart));
        cursor = tokenStart + match.length;
        continue;
      }

      const contentRawStart = tokenRawStart + contentIndex;
      const tokenMap = match.tagName === 'code'
        ? mapLiteralToRawBoundaries(match.content, contentRawStart)
        : mapInlineToRawBoundaries(match.content, contentRawStart, depth + 1);
      appendBoundaryMap(map, tokenMap);

      cursor = tokenStart + match.length;
    }

    return map;
  };

  const mapRenderedToRawBoundaries = (lineText: string, lineType: string | undefined): number[] => {
    if (!lineText) return [0];
    if (lineType === 'divider') return [lineText.length];

    let bodyStart = 0;
    if (lineType?.startsWith('heading-')) {
      const headingPrefix = lineText.match(/^(\s*)(#{1,6})\s+/);
      if (headingPrefix) bodyStart = headingPrefix[0].length;
    } else if (lineType === 'quote') {
      const quotePrefix = lineText.match(/^(\s*)>\s+/);
      if (quotePrefix) bodyStart = quotePrefix[0].length;
    }

    const body = lineText.slice(bodyStart);
    const map = [bodyStart];
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = linkRegex.exec(body)) !== null) {
      const offset = match.index;
      if (offset > lastIndex) {
        const before = body.slice(lastIndex, offset);
        appendBoundaryMap(map, mapInlineToRawBoundaries(before, bodyStart + lastIndex));
      }

      const wholeMatch = match[0] ?? '';
      const linkText = match[1] ?? '';
      const linkUrl = match[2] ?? '';
      if (sanitizeUrl(linkUrl)) {
        appendBoundaryMap(map, mapInlineToRawBoundaries(linkText, bodyStart + offset + 1));
      } else {
        appendBoundaryMap(map, mapLiteralToRawBoundaries(wholeMatch, bodyStart + offset));
      }

      lastIndex = offset + wholeMatch.length;
    }

    if (lastIndex < body.length) {
      const tail = body.slice(lastIndex);
      appendBoundaryMap(map, mapInlineToRawBoundaries(tail, bodyStart + lastIndex));
    }

    return map;
  };

  const getPreviewTextOffsetFromPoint = (preview: HTMLElement, event: MouseEvent): number | null => {
    const doc = preview.ownerDocument as CaretPointDocument;
    const x = event.clientX;
    const y = event.clientY;

    let container: Node | null = null;
    let offset = 0;

    if (typeof doc.caretPositionFromPoint === 'function') {
      const pos = doc.caretPositionFromPoint(x, y);
      if (pos) {
        container = pos.offsetNode;
        offset = pos.offset;
      }
    }

    if (!container && typeof doc.caretRangeFromPoint === 'function') {
      const range = doc.caretRangeFromPoint(x, y);
      if (range) {
        container = range.startContainer;
        offset = range.startOffset;
      }
    }

    if (!container) return null;
    if (container !== preview && !preview.contains(container)) return null;

    const range = doc.createRange();
    range.selectNodeContents(preview);
    try {
      range.setEnd(container, offset);
    } catch {
      return null;
    }

    return range.toString().length;
  };

  const getClickedCaretForPreview = (row: HTMLElement, event: MouseEvent): number | null => {
    const textarea = row.querySelector<HTMLTextAreaElement>('.text-line-input');
    const preview = row.querySelector<HTMLElement>('.text-block-line-preview');
    if (!textarea || !preview) return null;

    const renderedOffset = getPreviewTextOffsetFromPoint(preview, event);
    if (renderedOffset === null) return null;

    const boundaries = mapRenderedToRawBoundaries(textarea.value, row.dataset.lineType);
    if (!boundaries.length) return null;

    const boundaryIndex = clamp(renderedOffset, 0, boundaries.length - 1);
    return boundaries[boundaryIndex] ?? textarea.value.length;
  };

  const getPreviewTextOffsetFromBoundary = (
    preview: HTMLElement,
    container: Node,
    offset: number
  ): number | null => {
    if (container !== preview && !preview.contains(container)) return null;

    const range = preview.ownerDocument.createRange();
    range.selectNodeContents(preview);
    try {
      range.setEnd(container, offset);
    } catch {
      return null;
    }
    return range.toString().length;
  };

  const getSelectedRawRangeForPreview = (row: HTMLElement): { start: number; end: number } | null => {
    const textarea = row.querySelector<HTMLTextAreaElement>('.text-line-input');
    const preview = row.querySelector<HTMLElement>('.text-block-line-preview');
    if (!textarea || !preview) return null;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

    let startRendered: number | null = null;
    let endRendered: number | null = null;
    for (let i = 0; i < selection.rangeCount; i += 1) {
      const range = selection.getRangeAt(i);
      try {
        if (!range.intersectsNode(preview)) continue;
      } catch {
        continue;
      }

      const start = getPreviewTextOffsetFromBoundary(preview, range.startContainer, range.startOffset);
      const end = getPreviewTextOffsetFromBoundary(preview, range.endContainer, range.endOffset);
      if (start === null || end === null) continue;

      startRendered = Math.min(start, end);
      endRendered = Math.max(start, end);
      break;
    }

    if (startRendered === null || endRendered === null || startRendered === endRendered) return null;

    const boundaries = mapRenderedToRawBoundaries(textarea.value, row.dataset.lineType);
    if (!boundaries.length) return null;

    const rawStart = boundaries[clamp(startRendered, 0, boundaries.length - 1)] ?? textarea.value.length;
    const rawEnd = boundaries[clamp(endRendered, 0, boundaries.length - 1)] ?? textarea.value.length;
    if (rawStart === rawEnd) return null;

    return {
      start: Math.min(rawStart, rawEnd),
      end: Math.max(rawStart, rawEnd),
    };
  };

  const hasExpandedSelectionInNode = (node: Node): boolean => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;

    for (let i = 0; i < selection.rangeCount; i += 1) {
      const range = selection.getRangeAt(i);
      try {
        if (range.intersectsNode(node)) return true;
      } catch {
        // Ignore transient ranges while the browser is updating selection state.
      }
    }

    return false;
  };

  const updateBlockContent = (): void => {
    const nextContent = lines.join('\n');
    updateBlockInContext(
      context,
      (existing) => (existing.type === 'text' ? { ...existing, content: nextContent } : existing),
      { render: false },
    );
  };

  const syncLineFromTextarea = (row: HTMLElement, textarea: HTMLTextAreaElement): void => {
    const currentLineIndex = Number.parseInt(row.dataset.lineIndex ?? '', 10);
    if (Number.isNaN(currentLineIndex) || currentLineIndex < 0 || currentLineIndex >= lines.length) return;
    lines[currentLineIndex] = textarea.value;
    updateBlockContent();
    syncLineHeight(row);
    markDirty();
  };

  const renderLines = (focusLineIndex: number | null = null, focusCaret: number | { start: number; end?: number } | null = null): void => {
    if (inlineToolbarContext?.textarea && lineContainer.contains(inlineToolbarContext.textarea)) {
      setInlineToolbarContext(null);
    }
    lineContainer.innerHTML = '';
    const headingSlugState = new Set<string>();
    lines.forEach((lineText, lineIndex) => {
      const row = buildLineRow(lineText, lineIndex, headingSlugState);
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

  const buildLineRow = (lineText: string, lineIndex: number, headingSlugState: Set<string>): HTMLElement => {
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
      const rendered = renderLinePreview(lineText, headingSlugState);
      row.dataset.lineType = rendered.type;
      preview.appendChild(rendered.node);
    }

    const textarea = document.createElement('textarea');
    textarea.className = 'text-line-input';
    textarea.value = lineText;
    textarea.rows = 1;
    textarea.placeholder = 'Type something... (type / for commands)';

    preview.addEventListener('mouseup', (e) => {
      if (row.classList.contains('is-editing')) return;
      const selectionRange = getSelectedRawRangeForPreview(row);
      if (!selectionRange) return;
      suppressNextLineActivationClick = true;
      e.stopPropagation();
      activateLine(row, selectionRange);
    });

    preview.addEventListener('click', (e) => {
      if (suppressNextLineActivationClick) {
        suppressNextLineActivationClick = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (hasExpandedSelectionInNode(preview)) {
        e.stopPropagation();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      activateLine(row, getClickedCaretForPreview(row, e));
    });

    row.addEventListener('click', (e) => {
      if (suppressNextLineActivationClick) {
        suppressNextLineActivationClick = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (hasExpandedSelectionInNode(row)) return;
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

      const currentLineIndex = Number.parseInt(row.dataset.lineIndex ?? '', 10);
      const targetLineIndex = Number.isNaN(currentLineIndex) ? lineIndex : currentLineIndex;
      lines[targetLineIndex] = newValue;
      updateBlockContent();
      syncLineHeight(row);
      scheduleInlineToolbarUpdate();
    });

    textarea.addEventListener('keydown', (e) => {
      if (slashEnabled && EditSlash.isActive()) {
        if (EditSlash.handleKeydown(e)) return;
      }

      // Handle Cmd+K separately due to async dialog
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        void insertLink(textarea, container, () => {
          const currentLineIndex = Number.parseInt(row.dataset.lineIndex ?? '', 10);
          const targetLineIndex = Number.isNaN(currentLineIndex) ? lineIndex : currentLineIndex;

          lines[targetLineIndex] = textarea.value;
          updateBlockContent();
          markDirty();
          scheduleInlineToolbarUpdate();
        });
        return;
      }

      if (handleFormattingShortcuts(e, textarea, markDirty, container)) {
        const currentLineIndex = Number.parseInt(row.dataset.lineIndex ?? '', 10);
        const targetLineIndex = Number.isNaN(currentLineIndex) ? lineIndex : currentLineIndex;
        lines[targetLineIndex] = textarea.value;
        updateBlockContent();
        syncLineHeight(row);
        scheduleInlineToolbarUpdate();
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

      if (
        e.key === 'ArrowLeft'
        && !e.shiftKey
        && !e.metaKey
        && !e.ctrlKey
        && !e.altKey
        && textarea.selectionStart === 0
        && textarea.selectionEnd === 0
      ) {
        if (lineIndex > 0) {
          e.preventDefault();
          renderLines(lineIndex - 1, lines[lineIndex - 1]?.length ?? 0);
        }
        return;
      }

      if (
        e.key === 'ArrowRight'
        && !e.shiftKey
        && !e.metaKey
        && !e.ctrlKey
        && !e.altKey
        && textarea.selectionStart === textarea.value.length
        && textarea.selectionEnd === textarea.value.length
      ) {
        if (lineIndex < lines.length - 1) {
          e.preventDefault();
          renderLines(lineIndex + 1, 0);
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

    textarea.addEventListener('select', scheduleInlineToolbarUpdate);
    textarea.addEventListener('keyup', scheduleInlineToolbarUpdate);
    textarea.addEventListener('mouseup', scheduleInlineToolbarUpdate);

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

    textarea.focus({ preventScroll: true });
    if (selection && typeof selection === 'object') {
      textarea.selectionStart = selection.start;
      textarea.selectionEnd = selection.end ?? selection.start;
    } else if (typeof selection === 'number') {
      textarea.selectionStart = selection;
      textarea.selectionEnd = selection;
    } else {
      textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
    }

    setInlineToolbarContext({
      textarea,
      row,
      onEdit: () => {
        syncLineFromTextarea(row, textarea);
      },
    });
    scheduleInlineToolbarUpdate();
    syncLineHeight(row);
  };

  const deactivateLine = (row: HTMLElement): void => {
    const textarea = row.querySelector<HTMLTextAreaElement>('.text-line-input');
    const preview = row.querySelector<HTMLElement>('.text-block-line-preview');
    const lineIndex = Number.parseInt(row.dataset.lineIndex ?? '', 10);

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
      const headingSlugState = new Set<string>();
      if (!Number.isNaN(lineIndex)) {
        for (let i = 0; i < lineIndex; i += 1) {
          const priorText = lines[i] ?? '';
          const priorHeadingMatch = priorText.match(/^(\s*)(#{1,6})\s+(.*)$/);
          if (!priorHeadingMatch) continue;
          const priorTmp = document.createElement('span');
          priorTmp.appendChild(renderInlineMarkdown(priorHeadingMatch[3] ?? ''));
          const priorBaseSlug = slugify(priorTmp.textContent?.trim() ?? '');
          if (!priorBaseSlug) continue;
          uniqueSlug(priorBaseSlug, headingSlugState);
        }
      }

      const rendered = renderLinePreview(currentText, headingSlugState);
      const headingId = Number.isNaN(lineIndex) ? null : headingIdForLine(currentText, lineIndex);
      if (headingId && rendered.node instanceof HTMLElement && /^H[1-6]$/.test(rendered.node.tagName)) {
        rendered.node.id = headingId;
      }
      row.dataset.lineType = rendered.type;
      preview.appendChild(rendered.node);
    }

    if (inlineToolbarContext?.textarea === textarea) {
      setInlineToolbarContext(null);
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

  // Handle clicks in gaps between lines - find and activate the closest line
  lineContainer.addEventListener('click', (e) => {
    // Only handle clicks directly on the container, not bubbled from rows
    if (e.target !== lineContainer) return;

    const rows = Array.from(lineContainer.querySelectorAll<HTMLElement>('.text-block-line'));
    if (!rows.length) return;

    const clickY = e.clientY;
    let closestRow: HTMLElement | null = null;
    let closestDistance = Infinity;

    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      const rowMiddle = rect.top + rect.height / 2;
      const distance = Math.abs(clickY - rowMiddle);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestRow = row;
      }
    }

    if (closestRow && !closestRow.classList.contains('is-editing')) {
      e.preventDefault();
      activateLine(closestRow);
    }
  });

  renderLines();
  return lineContainer;
}

/**
 * Render a single line of markdown into preview HTML
 */
function renderLinePreview(lineText: string, headingSlugState: Set<string>): LinePreviewResult {
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
    // Generate heading ID from rendered text (matches markdown/toc behavior better than raw markdown).
    const baseSlug = slugify(heading.textContent?.trim() ?? '');
    if (baseSlug) {
      heading.id = uniqueSlug(baseSlug, headingSlugState);
    }
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

function applyVideoPoster(video: HTMLVideoElement, poster: string | null | undefined): void {
  const cleanPoster = (poster ?? '').trim();
  if (!cleanPoster) {
    video.poster = '';
    video.removeAttribute('poster');
    return;
  }

  video.poster = cleanPoster;
  video.setAttribute('poster', cleanPoster);
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

    const posterControls = document.createElement('div');
    posterControls.className = 'video-poster-controls';

    const optionsRow = document.createElement('label');
    optionsRow.className = 'video-option-row';

    const autoplayToggle = document.createElement('input');
    autoplayToggle.type = 'checkbox';
    autoplayToggle.className = 'video-option-checkbox';
    autoplayToggle.checked = !!block.autoplay;
    optionsRow.appendChild(autoplayToggle);

    const autoplayLabel = document.createElement('span');
    autoplayLabel.className = 'video-option-label';
    autoplayLabel.textContent = 'Autoplay (muted loop)';
    optionsRow.appendChild(autoplayLabel);

    const posterInput = document.createElement('input');
    posterInput.type = 'url';
    posterInput.className = 'video-poster-input';
    posterInput.placeholder = 'Poster image URL (optional)...';
    posterInput.value = block.poster || '';

    const actionsRow = document.createElement('div');
    actionsRow.className = 'video-poster-actions';

    const uploadPosterBtn = document.createElement('button');
    uploadPosterBtn.type = 'button';
    uploadPosterBtn.className = 'edit-btn-small video-poster-action';
    uploadPosterBtn.textContent = 'Upload poster';
    actionsRow.appendChild(uploadPosterBtn);

    const captureFrameBtn = document.createElement('button');
    captureFrameBtn.type = 'button';
    captureFrameBtn.className = 'edit-btn-small video-poster-action';
    captureFrameBtn.textContent = 'Use current frame';
    actionsRow.appendChild(captureFrameBtn);

    const clearPosterBtn = document.createElement('button');
    clearPosterBtn.type = 'button';
    clearPosterBtn.className = 'edit-btn-small video-poster-action';
    clearPosterBtn.textContent = 'Clear';
    actionsRow.appendChild(clearPosterBtn);

    const posterUploadInput = document.createElement('input');
    posterUploadInput.type = 'file';
    posterUploadInput.accept = 'image/*';
    posterUploadInput.className = 'video-poster-upload-input';
    posterUploadInput.hidden = true;

    let isPosterActionInFlight = false;
    let currentPoster = (block.poster || '').trim();

    const syncPosterControlState = (): void => {
      const hidePosterFields = autoplayToggle.checked;
      posterControls.classList.toggle('poster-fields-hidden', hidePosterFields);
      posterInput.disabled = hidePosterFields || isPosterActionInFlight;
      uploadPosterBtn.disabled = hidePosterFields || isPosterActionInFlight;
      captureFrameBtn.disabled = hidePosterFields || isPosterActionInFlight;
      clearPosterBtn.disabled = hidePosterFields || isPosterActionInFlight;
    };

    autoplayToggle.addEventListener('change', () => {
      const autoplay = autoplayToggle.checked;
      applyVideoPlaybackSettings(video, autoplay);
      updateBlockFieldsInContext(context, { autoplay }, { render: false });
      syncPosterControlState();
    });

    const syncPosterToBlock = (poster: string): void => {
      const cleanPoster = poster.trim();
      if (currentPoster && currentPoster !== cleanPoster && isTrackableAssetUrl(currentPoster)) {
        addCleanupCandidateUrl(cleanupCandidateUrls, currentPoster);
      }
      currentPoster = cleanPoster;
      applyVideoPoster(video, cleanPoster);
      updateBlockFieldsInContext(context, { poster: cleanPoster }, { render: false });
      clearPosterBtn.hidden = cleanPoster.length === 0;
      if (posterInput.value !== cleanPoster) {
        posterInput.value = cleanPoster;
      }
    };

    const setPosterActionState = (inFlight: boolean): void => {
      isPosterActionInFlight = inFlight;
      syncPosterControlState();
    };

    posterInput.addEventListener('input', () => {
      syncPosterToBlock(posterInput.value);
    });

    uploadPosterBtn.addEventListener('click', () => {
      if (isPosterActionInFlight) return;
      posterUploadInput.click();
    });

    posterUploadInput.addEventListener('change', async () => {
      const file = posterUploadInput.files?.[0];
      posterUploadInput.value = '';
      if (!file || isPosterActionInFlight) return;

      setPosterActionState(true);
      try {
        const posterUrl = await EditMedia.uploadPosterForVideo(file);
        syncPosterToBlock(posterUrl);
        showNotification('Poster uploaded!', 'success');
      } catch (error) {
        showNotification(error instanceof Error ? error.message : 'Poster upload failed', 'error');
      } finally {
        setPosterActionState(false);
      }
    });

    captureFrameBtn.addEventListener('click', async () => {
      if (isPosterActionInFlight) return;

      setPosterActionState(true);
      try {
        const posterUrl = await EditMedia.capturePosterFromVideo(video);
        syncPosterToBlock(posterUrl);
        showNotification('Poster captured from frame!', 'success');
      } catch (error) {
        showNotification(error instanceof Error ? error.message : 'Frame capture failed', 'error');
      } finally {
        setPosterActionState(false);
      }
    });

    clearPosterBtn.addEventListener('click', () => {
      if (isPosterActionInFlight) return;
      syncPosterToBlock('');
    });

    const initialPoster = (block.poster || '').trim();
    applyVideoPoster(video, initialPoster);
    currentPoster = initialPoster;
    clearPosterBtn.hidden = initialPoster.length === 0;
    if (posterInput.value !== initialPoster) {
      posterInput.value = initialPoster;
    }
    syncPosterControlState();
    posterControls.appendChild(optionsRow);
    posterControls.appendChild(posterInput);
    posterControls.appendChild(actionsRow);
    posterControls.appendChild(posterUploadInput);
    wrapper.appendChild(posterControls);
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
    applySandboxInlineStyle(previewIframe, block.style, block.align);
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
      textarea.focus({ preventScroll: true });
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
      if (textarea) textarea.focus({ preventScroll: true });
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
  const removedBlock = blocks[index];
  if (removedBlock) {
    trackPosterCleanupCandidatesFromBlock(cleanupCandidateUrls, removedBlock);
  }

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
      trackPosterCleanupCandidatesFromBlock(cleanupCandidateUrls, blocks[focusIndex]);
      updateTopLevelBlock(focusIndex, () => createBlock(execData.commandId) as Block);
      if (execData.commandId === 'text' || execData.commandId === 'callout') {
        setTimeout(() => {
          const textarea = container?.querySelector<HTMLTextAreaElement>(
            `[data-block-index="${focusIndex}"] .text-line-input, ` +
            `[data-block-index="${focusIndex}"] .block-textarea, ` +
            `[data-block-index="${focusIndex}"] .callout-textarea`
          );
          if (textarea) textarea.focus({ preventScroll: true });
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
      handleRedoAction();
    } else {
      handleUndoAction();
    }
    return;
  }

  if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    handleRedoAction();
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

function handleUndoAction(): void {
  if (tryNativeInputHistory('undo')) {
    updateToolbarStatus();
    return;
  }
  EditUndo.undo();
  updateToolbarStatus();
  scheduleInlineToolbarUpdate();
}

function handleRedoAction(): void {
  if (tryNativeInputHistory('redo')) {
    updateToolbarStatus();
    return;
  }
  EditUndo.redo();
  updateToolbarStatus();
  scheduleInlineToolbarUpdate();
}

function tryNativeInputHistory(action: 'undo' | 'redo'): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement)) return false;
  if (active.disabled || active.readOnly) return false;

  if (active instanceof HTMLInputElement) {
    const type = (active.type || 'text').toLowerCase();
    const supportedInputTypes = new Set(['text', 'search', 'url', 'tel', 'email', 'password']);
    if (!supportedInputTypes.has(type)) {
      return false;
    }
  }

  const command = action === 'undo' ? 'undo' : 'redo';
  const handled = document.execCommand(command);
  if (!handled) {
    return false;
  }

  scheduleInlineToolbarUpdate();
  return true;
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
 * Get the edit container element (for anchor discovery in link dialogs)
 */
export function getEditContainer(): HTMLElement | null {
  return container;
}

async function flushCleanupCandidates(): Promise<void> {
  if (editMode !== 'project' || cleanupCandidateUrls.size === 0) return;

  const urls = Array.from(cleanupCandidateUrls);
  try {
    const response = await fetch('/api/cleanup-assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
      keepalive: true,
    });
    if (response.ok) {
      cleanupCandidateUrls.clear();
      cleanupFlushErrorLogged = false;
    } else if (!cleanupFlushErrorLogged) {
      cleanupFlushErrorLogged = true;
      console.warn('Asset cleanup request failed:', response.status);
    }
  } catch (error) {
    if (!cleanupFlushErrorLogged) {
      cleanupFlushErrorLogged = true;
      console.warn('Asset cleanup request failed:', error);
    }
  }
}

/**
 * Handle manual save
 */
async function handleSave(): Promise<void> {
  if (!isDirty && saveState !== SaveState.ERROR) {
    persistScrollForNavigation(window.location.pathname);
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
    applyProjectSaveResult(result);

    isDirty = false;
    dispatchSaveAction({ type: 'save_ok' });

    persistScrollForNavigation(window.location.pathname);
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
async function handleCancel(): Promise<void> {
  if (isDirty) {
    if (!confirm('You have unsaved changes. Discard them?')) {
      return;
    }
  }
  await flushCleanupCandidates();
  persistScrollForNavigation(window.location.pathname);
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

// ========== INLINE PROJECT SETTINGS ==========

function getEditableProjectData(): ProjectData | null {
  if (!projectData || !('slug' in projectData)) return null;
  return projectData as ProjectData;
}

function setupEditableProjectHeader(projectItem: HTMLElement, project: ProjectData): void {
  const header = projectItem.querySelector<HTMLElement>('.project-header');
  const nameEl = projectItem.querySelector<HTMLElement>('.project-name');
  const dateEl = projectItem.querySelector<HTMLElement>('.project-date');
  if (!header || !nameEl || !dateEl) return;

  header.classList.add('edit-project-header-active');

  dateEl.innerHTML = `
    <input
      type="date"
      class="edit-project-header-date-input"
      value="${escapeHtmlAttr(project.date || '')}"
      aria-label="Project date"
    >
  `;
  nameEl.innerHTML = `
    <input
      type="text"
      class="edit-project-header-name-input"
      value="${escapeHtmlAttr(project.name || '')}"
      aria-label="Project name"
      required
    >
  `;

  const dateInput = dateEl.querySelector<HTMLInputElement>('.edit-project-header-date-input');
  const nameInput = nameEl.querySelector<HTMLInputElement>('.edit-project-header-name-input');
  if (!dateInput || !nameInput) return;

  const blockHeaderInteractions = (event: Event): void => {
    event.stopPropagation();
  };

  [dateInput, nameInput].forEach((input) => {
    input.addEventListener('click', blockHeaderInteractions);
    input.addEventListener('mousedown', blockHeaderInteractions);
    input.addEventListener('pointerdown', blockHeaderInteractions);
    input.addEventListener('keydown', blockHeaderInteractions);
  });

  dateInput.addEventListener('input', () => {
    project.date = dateInput.value;
    markDirty();
  });

  nameInput.addEventListener('input', () => {
    project.name = nameInput.value;
    const toolbarTitle = toolbar?.querySelector<HTMLElement>('.edit-project-name');
    if (toolbarTitle) {
      const label = project.name.trim() || 'Project';
      toolbarTitle.textContent = `Editing: ${label}`;
    }
    markDirty();
  });
}

function createInlineProjectMetadataControls(project: ProjectData): HTMLElement {
  const controls = document.createElement('section');
  controls.className = 'edit-inline-project-settings';
  controls.innerHTML = `
    <div class="edit-inline-project-settings-grid">
      <div class="edit-form-group">
        <label for="inline-settings-slug">URL Slug</label>
        <input
          type="text"
          id="inline-settings-slug"
          value="${escapeHtmlAttr(project.slug || '')}"
          pattern="[a-z0-9_\\-]+"
          required
        >
      </div>
      <div class="edit-form-group">
        <label for="inline-settings-youtube">YouTube Link</label>
        <input
          type="url"
          id="inline-settings-youtube"
          value="${escapeHtmlAttr(project.youtube || '')}"
          placeholder="https://youtube.com/watch?v=..."
        >
      </div>
    </div>
    <div class="edit-form-row edit-inline-project-settings-flags">
      <label class="edit-form-checkbox">
        <input type="checkbox" id="inline-settings-draft" ${project.draft ? 'checked' : ''}>
        <span>Draft</span>
      </label>
      <label class="edit-form-checkbox">
        <input type="checkbox" id="inline-settings-pinned" ${project.pinned ? 'checked' : ''}>
        <span>Pinned</span>
      </label>
    </div>
  `;

  const slugInput = controls.querySelector<HTMLInputElement>('#inline-settings-slug');
  const youtubeInput = controls.querySelector<HTMLInputElement>('#inline-settings-youtube');
  const draftInput = controls.querySelector<HTMLInputElement>('#inline-settings-draft');
  const pinnedInput = controls.querySelector<HTMLInputElement>('#inline-settings-pinned');

  slugInput?.addEventListener('input', () => {
    project.slug = slugInput.value;
    markDirty();
  });

  youtubeInput?.addEventListener('input', () => {
    project.youtube = youtubeInput.value.trim();
    markDirty();
  });

  draftInput?.addEventListener('change', () => {
    project.draft = draftInput.checked;
    markDirty();
  });

  pinnedInput?.addEventListener('change', () => {
    project.pinned = pinnedInput.checked;
    markDirty();
  });

  return controls;
}

function openHeroVideoEditor(file: File | null = null): void {
  if (editMode !== 'project' || !projectSlug) return;
  const project = getEditableProjectData();
  if (!project) return;

  void ProjectSettings.showVideoEditor(projectSlug, {
    file,
    projectData: project,
    onVideoSaved: (videoData) => {
      const previousVideo = project.video || {};
      for (const key of ['hls', 'thumbnail', 'spriteSheet'] as const) {
        const previous = previousVideo[key];
        const next = videoData[key];
        if (previous && previous !== next) {
          addCleanupCandidateUrl(cleanupCandidateUrls, previous);
        }
      }
      project.video = { ...videoData };
      (heroThumbnailControls as HeroMediaControlsElement | null)?.refreshState?.();
      markDirty();
    },
  });
}

// ========== HERO MEDIA CONTROLS ==========

function createHeroThumbnailControls(data: ProjectData): HTMLElement {
  const controls = document.createElement('div') as HeroMediaControlsElement;
  controls.className = 'edit-hero-thumbnail-controls';

  const currentThumbnail = data.video?.thumbnail || '';
  controls.innerHTML = `
    <div class="edit-hero-media-grid">
      <div class="edit-hero-video-panel">
        <div class="edit-hero-video-header">
          <span class="edit-hero-panel-label">Hero Video</span>
          <span class="edit-hero-video-status"></span>
        </div>
        <div class="edit-hero-video-buttons">
          <button type="button" class="edit-btn-small" data-action="update-sprite">Update Sprite</button>
          <button type="button" class="edit-btn-small" data-action="replace-video">Replace</button>
        </div>
        <input type="file" class="edit-hero-video-file" accept="video/*" style="display: none;">
      </div>
      <div class="edit-hero-thumbnail-panel">
        <div class="edit-hero-thumbnail-header">
          <span class="edit-hero-panel-label">Thumbnail</span>
        </div>
        <div class="edit-hero-thumbnail-content">
          <img class="edit-hero-thumbnail-preview" src="${escapeHtmlAttr(currentThumbnail)}"
              alt="Thumbnail" style="${currentThumbnail ? '' : 'display:none'}">
          <div class="edit-hero-thumbnail-actions">
            <input type="url" class="edit-hero-thumbnail-input"
                placeholder="Thumbnail image URL..."
                value="${escapeHtmlAttr(currentThumbnail)}">
            <div class="edit-hero-thumbnail-buttons">
              <button type="button" class="edit-btn-small" data-action="upload">Upload</button>
              <button type="button" class="edit-btn-small" data-action="capture">Use current frame</button>
              <button type="button" class="edit-btn-small" data-action="clear" style="${currentThumbnail ? '' : 'display:none'}">Clear</button>
            </div>
            <input type="file" class="edit-hero-thumbnail-file" accept="image/*" style="display: none;">
          </div>
        </div>
      </div>
    </div>
  `;

  const statusEl = controls.querySelector('.edit-hero-video-status') as HTMLElement;
  const updateSpriteBtn = controls.querySelector('[data-action="update-sprite"]') as HTMLButtonElement;
  const replaceBtn = controls.querySelector('[data-action="replace-video"]') as HTMLButtonElement;
  const videoFileInput = controls.querySelector('.edit-hero-video-file') as HTMLInputElement;
  const input = controls.querySelector('.edit-hero-thumbnail-input') as HTMLInputElement;
  const preview = controls.querySelector('.edit-hero-thumbnail-preview') as HTMLImageElement;
  const uploadBtn = controls.querySelector('[data-action="upload"]') as HTMLButtonElement;
  const captureBtn = controls.querySelector('[data-action="capture"]') as HTMLButtonElement;
  const clearBtn = controls.querySelector('[data-action="clear"]') as HTMLButtonElement;
  const fileInput = controls.querySelector('.edit-hero-thumbnail-file') as HTMLInputElement;

  const renderThumbnailFromProject = (): void => {
    const project = getEditableProjectData();
    const thumbnail = project?.video?.thumbnail?.trim() || '';
    input.value = thumbnail;
    if (thumbnail) {
      preview.src = thumbnail;
      preview.style.display = '';
      clearBtn.style.display = '';
    } else {
      preview.style.display = 'none';
      clearBtn.style.display = 'none';
    }
  };

  const refreshState = (): void => {
    const project = getEditableProjectData();
    const hls = project?.video?.hls?.trim() || '';
    const hasHls = hls.length > 0;
    statusEl.textContent = hasHls ? `Current: ${hls.split('/').pop()}` : 'No hero video yet';
    updateSpriteBtn.disabled = !hasHls;
    replaceBtn.textContent = hasHls ? 'Replace' : 'Upload Hero Video';
    captureBtn.disabled = !hasHls;
    renderThumbnailFromProject();
  };
  controls.refreshState = refreshState;
  refreshState();

  const syncThumbnail = (url: string | null): void => {
    const project = getEditableProjectData();
    if (!project) return;

    if (!project.video) {
      project.video = {};
    }

    const nextUrl = url || undefined;
    const oldThumbnail = project.video.thumbnail;
    if (oldThumbnail && oldThumbnail !== nextUrl) {
      addCleanupCandidateUrl(cleanupCandidateUrls, oldThumbnail);
    }
    project.video.thumbnail = nextUrl;
    markDirty();
    renderThumbnailFromProject();
  };

  updateSpriteBtn.addEventListener('click', () => {
    const project = getEditableProjectData();
    if (!project?.video?.hls) {
      showNotification('No existing hero video found for this project.', 'error');
      return;
    }
    openHeroVideoEditor();
  });

  replaceBtn.addEventListener('click', () => videoFileInput.click());
  videoFileInput.addEventListener('change', () => {
    const file = videoFileInput.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      showNotification('Please select a video file', 'error');
      videoFileInput.value = '';
      return;
    }
    openHeroVideoEditor(file);
    videoFileInput.value = '';
  });

  input.addEventListener('change', () => {
    syncThumbnail(input.value.trim() || null);
  });
  input.addEventListener('blur', () => {
    syncThumbnail(input.value.trim() || null);
  });

  uploadBtn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showNotification('Please select an image file', 'error');
      return;
    }

    try {
      uploadBtn.disabled = true;
      uploadBtn.textContent = 'Uploading...';
      showNotification('Uploading thumbnail...', 'info');
      const url = await uploadPosterForVideo(file);
      syncThumbnail(url);
      showNotification('Thumbnail uploaded!', 'success');
    } catch (error) {
      showNotification(`Upload failed: ${(error as Error).message}`, 'error');
    } finally {
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'Upload';
      fileInput.value = '';
    }
  });

  captureBtn.addEventListener('click', async () => {
    const projectItem = controls.closest('.project-item');
    const video = projectItem?.querySelector('.video-container video') as HTMLVideoElement | null;

    if (!video) {
      showNotification('No video element found', 'error');
      return;
    }

    if (video.readyState < 2) {
      showNotification('Video not ready yet. Please wait for it to load.', 'info');
      return;
    }

    try {
      captureBtn.disabled = true;
      captureBtn.textContent = 'Capturing...';
      const url = await capturePosterFromVideo(video);
      syncThumbnail(url);
      showNotification('Thumbnail captured!', 'success');
    } catch (error) {
      showNotification(`Capture failed: ${(error as Error).message}`, 'error');
    } finally {
      captureBtn.disabled = false;
      captureBtn.textContent = 'Use current frame';
      refreshState();
    }
  });

  clearBtn.addEventListener('click', () => {
    syncThumbnail(null);
    showNotification('Thumbnail cleared', 'info');
  });

  return controls;
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

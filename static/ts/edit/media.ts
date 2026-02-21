/**
 * Edit Media
 * Handles image and video uploads, processing, and S3 integration
 */

import type { Block, ImageBlock, VideoBlock, HtmlBlock, BlockType } from '../types/blocks';
import { showNotification } from '../core/utils';

// ========== TYPES ==========

type HandlePosition = 'n' | 'e' | 's' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

interface ResizeConfig {
  MIN_WIDTH_PERCENT: number;
  MAX_WIDTH_PERCENT: number;
  MIN_HEIGHT_PX: number;
  CORNER_HANDLE_POSITIONS: HandlePosition[];
  IFRAME_HANDLE_POSITIONS: HandlePosition[];
  FULL_WIDTH_THRESHOLD: number;
}

interface SelectedMedia {
  element: HTMLElement;
  block: ImageBlock | VideoBlock | HtmlBlock;
}

interface ResizeState {
  position: HandlePosition;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
  lastWidth: number;
  lastHeight: number;
  aspectRatio: number;
}

interface StyleMap {
  [key: string]: string | undefined;
}

interface UpdateBlockOptions {
  render?: boolean;
  markDirty?: boolean;
}

// Callbacks for integration with edit mode
interface EditModeCallbacks {
  updateBlock: (index: number, updates: Partial<Block>, options?: UpdateBlockOptions) => void;
  insertBlock: (index: number, type: BlockType, props?: Partial<Block>) => void;
  insertBlockAfter: (blockId: string, type: BlockType, props?: Partial<Block>) => void;
  getBlocks: () => Block[];
  renderBlocks: () => void;
  markDirty: () => void;
  isActive: () => boolean;
}

// ========== STATE ==========

let callbacks: EditModeCallbacks | null = null;

const MAX_IMAGE_WIDTH = 2000;
const IMAGE_QUALITY = 0.8;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
const RESIZE_CONFIG: ResizeConfig = {
  MIN_WIDTH_PERCENT: 20,
  MAX_WIDTH_PERCENT: 100,
  MIN_HEIGHT_PX: 60,
  CORNER_HANDLE_POSITIONS: ['nw', 'ne', 'sw', 'se'],
  IFRAME_HANDLE_POSITIONS: ['nw', 'ne', 'sw', 'se', 'n', 'e', 's', 'w'],
  FULL_WIDTH_THRESHOLD: 2
};

// Resize/selection state
let selectedMedia: SelectedMedia | null = null;
let resizeHandles: HTMLDivElement[] = [];
let isResizing = false;
let resizeState: ResizeState | null = null;
let resizeListenersBound = false;
let boundHandleResize: ((e: MouseEvent) => void) | null = null;
let boundStopResize: (() => void) | null = null;
let boundUpdateHandlePositions: (() => void) | null = null;
let boundDocumentClick: ((e: MouseEvent) => void) | null = null;

// ========== INITIALIZATION ==========

/**
 * Initialize media handling for the editor
 */
export function init(cb: EditModeCallbacks): void {
  callbacks = cb;
  setupPasteHandler();
  setupResizeHandlers();
}

/**
 * Setup paste handler for clipboard images
 */
function setupPasteHandler(): void {
  document.addEventListener('paste', async (e: ClipboardEvent) => {
    if (!callbacks?.isActive()) return;

    const items = Array.from(e.clipboardData?.items ?? []);
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;

        const activeBlock = document.activeElement?.closest('.block-wrapper');
        const blockIndex = activeBlock ? parseInt(activeBlock.getAttribute('data-block-index') ?? '', 10) : null;
        if (blockIndex !== null && !isNaN(blockIndex)) {
          await handleImageUploadForBlock(file, blockIndex);
        }
        break;
      }
    }
  });
}

/**
 * Setup resize handlers for media selection
 */
function setupResizeHandlers(): void {
  if (resizeListenersBound) return;

  boundHandleResize = (e: MouseEvent) => handleResize(e);
  boundStopResize = () => stopResize();
  boundUpdateHandlePositions = () => updateHandlePositions();
  boundDocumentClick = (e: MouseEvent) => {
    if (!callbacks?.isActive()) return;
    if (!selectedMedia) return;
    if (isResizing) return;

    const target = e.target as HTMLElement;
    const inMediaBlock = target.closest('.image-block-wrapper, .video-block-wrapper, .html-block-wrapper');
    const onHandle = target.closest('.resize-handle');
    if (inMediaBlock || onHandle) return;

    deselect();
  };

  document.addEventListener('click', boundDocumentClick);
  window.addEventListener('resize', boundUpdateHandlePositions);
  window.addEventListener('scroll', boundUpdateHandlePositions, true);

  resizeListenersBound = true;
}

// ========== SELECTION ==========

/**
 * Select a media element for resize
 */
export function select(element: HTMLElement, block: ImageBlock | VideoBlock | HtmlBlock): void {
  if (!element || !block) return;
  if (!resizeListenersBound) setupResizeHandlers();

  if (selectedMedia && selectedMedia.element === element) {
    return;
  }

  deselect();

  selectedMedia = { element, block };
  element.classList.add('media-selected');
  createResizeHandles(element);
  updateHandlePositions();
}

/**
 * Deselect current media element
 */
export function deselect(): void {
  if (isResizing) {
    stopResize();
  }

  if (!selectedMedia) return;
  selectedMedia.element.classList.remove('media-selected');
  removeResizeHandles();
  selectedMedia = null;
}

// ========== RESIZE HANDLES ==========

/**
 * Create resize handles around element
 */
function createResizeHandles(element: HTMLElement): void {
  removeResizeHandles();
  const rect = element.getBoundingClientRect();
  const handles = getHandlePositionsForSelection();

  handles.forEach((position) => {
    const handle = document.createElement('div');
    handle.className = `resize-handle ${position}`;
    handle.dataset.position = position;
    positionHandle(handle, position, rect);
    handle.addEventListener('mousedown', (e) => startResize(e, position));
    document.body.appendChild(handle);
    resizeHandles.push(handle);
  });
}

function getHandlePositionsForSelection(): HandlePosition[] {
  if (selectedMedia?.block.type === 'html') {
    return RESIZE_CONFIG.IFRAME_HANDLE_POSITIONS;
  }
  return RESIZE_CONFIG.CORNER_HANDLE_POSITIONS;
}

/**
 * Position a single resize handle
 */
function positionHandle(handle: HTMLElement, position: HandlePosition, rect: DOMRect): void {
  const offset = 6;
  const midX = rect.left + (rect.width / 2);
  const midY = rect.top + (rect.height / 2);
  handle.style.position = 'fixed';
  switch (position) {
    case 'nw':
      handle.style.top = `${rect.top - offset}px`;
      handle.style.left = `${rect.left - offset}px`;
      break;
    case 'ne':
      handle.style.top = `${rect.top - offset}px`;
      handle.style.left = `${rect.right - offset}px`;
      break;
    case 'sw':
      handle.style.top = `${rect.bottom - offset}px`;
      handle.style.left = `${rect.left - offset}px`;
      break;
    case 'se':
      handle.style.top = `${rect.bottom - offset}px`;
      handle.style.left = `${rect.right - offset}px`;
      break;
    case 'n':
      handle.style.top = `${rect.top - offset}px`;
      handle.style.left = `${midX - offset}px`;
      break;
    case 'e':
      handle.style.top = `${midY - offset}px`;
      handle.style.left = `${rect.right - offset}px`;
      break;
    case 's':
      handle.style.top = `${rect.bottom - offset}px`;
      handle.style.left = `${midX - offset}px`;
      break;
    case 'w':
      handle.style.top = `${midY - offset}px`;
      handle.style.left = `${rect.left - offset}px`;
      break;
  }
}

/**
 * Update all handle positions
 */
function updateHandlePositions(): void {
  if (!selectedMedia || resizeHandles.length === 0) return;
  const rect = selectedMedia.element.getBoundingClientRect();
  resizeHandles.forEach((handle) => {
    const position = handle.dataset.position as HandlePosition;
    positionHandle(handle, position, rect);
  });
}

/**
 * Remove all resize handles
 */
function removeResizeHandles(): void {
  resizeHandles.forEach(handle => handle.remove());
  resizeHandles = [];
}

// ========== RESIZE OPERATIONS ==========

/**
 * Start resize operation
 */
function startResize(e: MouseEvent, position: HandlePosition): void {
  if (!selectedMedia) return;

  e.preventDefault();
  e.stopPropagation();

  const element = selectedMedia.element;
  const rect = element.getBoundingClientRect();
  if (!rect.width) return;

  const container = element.closest('.row-column')
    || element.closest('.block-content')
    || element.closest('.image-block-wrapper')
    || element.closest('.video-block-wrapper')
    || element.closest('.html-block-preview-container')
    || element.parentElement;
  const containerRect = container ? container.getBoundingClientRect() : rect;

  const minWidth = Math.max(80, (containerRect.width * RESIZE_CONFIG.MIN_WIDTH_PERCENT) / 100);
  const maxWidth = (containerRect.width * RESIZE_CONFIG.MAX_WIDTH_PERCENT) / 100;
  const minHeight = RESIZE_CONFIG.MIN_HEIGHT_PX;
  const maxHeight = Math.max(minHeight, rect.height * 3, window.innerHeight * 0.9);

  isResizing = true;
  element.classList.add('media-resizing');
  resizeState = {
    position,
    startX: e.clientX,
    startY: e.clientY,
    startWidth: rect.width,
    startHeight: rect.height,
    minWidth,
    maxWidth,
    minHeight,
    maxHeight,
    lastWidth: rect.width,
    lastHeight: rect.height,
    aspectRatio: rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 9,
  };

  if (boundHandleResize && boundStopResize) {
    document.addEventListener('mousemove', boundHandleResize);
    document.addEventListener('mouseup', boundStopResize);
  }
  document.body.style.userSelect = 'none';
}

/**
 * Handle resize drag
 */
function handleResize(e: MouseEvent): void {
  if (!isResizing || !selectedMedia || !resizeState) return;

  const {
    position,
    startX,
    startY,
    startWidth,
    startHeight,
    minWidth,
    maxWidth,
    minHeight,
    maxHeight,
    aspectRatio,
  } = resizeState;

  const element = selectedMedia.element;
  const block = selectedMedia.block;
  const isIframe = element instanceof HTMLIFrameElement;
  const isCorner = position === 'nw' || position === 'ne' || position === 'sw' || position === 'se';

  let newWidth = startWidth;
  let newHeight = startHeight;

  if (!isIframe) {
    let deltaX = e.clientX - startX;
    if (position === 'nw' || position === 'sw') {
      deltaX = -deltaX;
    }
    newWidth = clamp(startWidth + deltaX, minWidth, maxWidth);
    newHeight = startHeight;
  } else if (isCorner) {
    let deltaX = e.clientX - startX;
    if (position === 'nw' || position === 'sw') {
      deltaX = -deltaX;
    }
    newWidth = clamp(startWidth + deltaX, minWidth, maxWidth);
    newHeight = newWidth / aspectRatio;
    if (newHeight < minHeight || newHeight > maxHeight) {
      newHeight = clamp(newHeight, minHeight, maxHeight);
      newWidth = clamp(newHeight * aspectRatio, minWidth, maxWidth);
      newHeight = newWidth / aspectRatio;
    }
  } else if (position === 'e' || position === 'w') {
    let deltaX = e.clientX - startX;
    if (position === 'w') {
      deltaX = -deltaX;
    }
    newWidth = clamp(startWidth + deltaX, minWidth, maxWidth);
    newHeight = startHeight;
  } else {
    let deltaY = e.clientY - startY;
    if (position === 'n') {
      deltaY = -deltaY;
    }
    newHeight = clamp(startHeight + deltaY, minHeight, maxHeight);
    newWidth = startWidth;
  }

  resizeState.lastWidth = newWidth;
  resizeState.lastHeight = newHeight;

  element.style.width = `${Math.round(newWidth)}px`;
  if (!isIframe) {
    element.style.height = 'auto';
  } else {
    element.style.height = `${Math.round(newHeight)}px`;
    element.dataset.autoHeight = 'false';
  }

  const style = getResizedStyle(block.style, newWidth, maxWidth, {
    height: isIframe ? newHeight : undefined,
    keepHeight: isIframe,
  });
  const blockIndex = callbacks?.getBlocks().findIndex((item) => item.id === block.id) ?? -1;
  if (blockIndex >= 0) {
    callbacks?.updateBlock(blockIndex, { style }, { render: false, markDirty: false });
  }
  selectedMedia.block = { ...block, style };
  updateHandlePositions();
}

/**
 * Stop resize operation
 */
function stopResize(): void {
  if (!isResizing) return;

  isResizing = false;

  if (selectedMedia) {
    selectedMedia.element.classList.remove('media-resizing');

    const lastWidth = resizeState?.lastWidth;
    const lastHeight = resizeState?.lastHeight;
    const maxWidth = resizeState?.maxWidth;
    if (lastWidth && maxWidth) {
      const isIframe = selectedMedia.element instanceof HTMLIFrameElement;
      const style = getResizedStyle(selectedMedia.block.style, lastWidth, maxWidth, {
        height: isIframe ? lastHeight : undefined,
        keepHeight: isIframe,
      });
      const blockIndex = callbacks?.getBlocks().findIndex((item) => item.id === selectedMedia?.block.id) ?? -1;
      if (blockIndex >= 0) {
        callbacks?.updateBlock(blockIndex, { style }, { render: false, markDirty: false });
      }
      if (!styleHasWidth(style) && !styleHasHeight(style)) {
        selectedMedia.element.style.width = '';
        selectedMedia.element.style.height = '';
      } else if (!styleHasWidth(style)) {
        selectedMedia.element.style.width = '';
      } else if (!styleHasHeight(style)) {
        selectedMedia.element.style.height = '';
      }
      if (isIframe) {
        selectedMedia.element.dataset.autoHeight = styleHasHeight(style) ? 'false' : 'true';
      }
      callbacks?.markDirty();
    }
  }

  if (boundHandleResize && boundStopResize) {
    document.removeEventListener('mousemove', boundHandleResize);
    document.removeEventListener('mouseup', boundStopResize);
  }
  document.body.style.userSelect = '';
  resizeState = null;
}

// ========== STYLE UTILITIES ==========

/**
 * Parse a style string into a property map
 */
function parseStyle(style: string | null | undefined): StyleMap {
  const styles: StyleMap = {};
  if (!style) return styles;

  style.split(';').forEach((part) => {
    const [prop, ...rest] = part.split(':');
    if (!prop) return;
    const value = rest.join(':').trim();
    if (!value) return;
    styles[prop.trim().toLowerCase()] = value;
  });
  return styles;
}

/**
 * Serialize a style map into a string
 */
function serializeStyle(styles: StyleMap): string {
  return Object.entries(styles)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([prop, value]) => `${prop}: ${value}`)
    .join('; ');
}

/**
 * Build a resized style string while preserving unrelated properties.
 */
function getResizedStyle(
  style: string | null | undefined,
  width: number,
  maxWidth: number,
  options: { height?: number; keepHeight?: boolean } = {}
): string | null {
  const { height, keepHeight = false } = options;
  const styles = parseStyle(style);

  delete styles['margin-left'];
  delete styles['margin-right'];
  delete styles['display'];
  delete styles['max-width'];
  delete styles['min-width'];
  if (!keepHeight) {
    delete styles['height'];
    delete styles['max-height'];
    delete styles['min-height'];
  } else {
    delete styles['max-height'];
    delete styles['min-height'];
    if (typeof height === 'number' && Number.isFinite(height)) {
      styles['height'] = `${Math.round(height)}px`;
    }
  }

  if (Math.abs(width - maxWidth) <= RESIZE_CONFIG.FULL_WIDTH_THRESHOLD) {
    delete styles['width'];
  } else {
    styles['width'] = `${Math.round(width)}px`;
  }

  const styleString = serializeStyle(styles);
  return styleString || null;
}

/**
 * Check if style string contains width
 */
function styleHasWidth(style: string | null | undefined): boolean {
  if (!style) return false;
  return /(^|;)\s*width\s*:/.test(style);
}

function styleHasHeight(style: string | null | undefined): boolean {
  if (!style) return false;
  return /(^|;)\s*height\s*:/.test(style);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ========== IMAGE PROCESSING ==========

/**
 * Process image: resize and convert to WebP
 */
async function processImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Could not get canvas context'));
      return;
    }

    img.onload = () => {
      // Calculate new dimensions
      let width = img.width;
      let height = img.height;

      if (width > MAX_IMAGE_WIDTH) {
        height = Math.round((height * MAX_IMAGE_WIDTH) / width);
        width = MAX_IMAGE_WIDTH;
      }

      canvas.width = width;
      canvas.height = height;

      // Draw image
      ctx.drawImage(img, 0, 0, width, height);

      // Convert to WebP
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to create blob'));
          }
        },
        'image/webp',
        IMAGE_QUALITY
      );

      // Clean up object URL
      URL.revokeObjectURL(img.src);
    };

    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error('Failed to load image'));
    };

    img.src = URL.createObjectURL(file);
  });
}

// ========== FILE UPLOAD ==========

interface UploadResponse {
  url: string;
}

/**
 * Upload file to server
 */
async function uploadFile(file: File | Blob, type: 'image' | 'video'): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);

  // Use appropriate endpoint based on type
  const endpoint = type === 'video' ? '/api/process-content-video' : '/api/upload-media';

  if (type === 'image') {
    formData.append('type', 'image');
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({})) as { detail?: string };
    throw new Error(error.detail || `Upload failed: ${response.status}`);
  }

  const data = await response.json() as UploadResponse;
  return data.url;
}

// ========== BLOCK UPLOAD HANDLERS ==========

/**
 * Handle image upload for a specific block index
 */
export async function handleImageUploadForBlock(file: File, blockIndex: number): Promise<void> {
  showNotification('Processing image...', 'info');

  try {
    // Process image (resize, convert to WebP)
    const processedBlob = await processImage(file);

    // Upload to server
    const url = await uploadFile(processedBlob, 'image');

    // Update block with new image
    callbacks?.updateBlock(blockIndex, {
      src: url,
      alt: file.name.replace(/\.[^/.]+$/, ''), // Remove extension
    });

    showNotification('Image uploaded!', 'success');
  } catch (error) {
    console.error('Image upload failed:', error);
    showNotification(error instanceof Error ? error.message : 'Image upload failed', 'error');
  }
}

/**
 * Handle video upload for a specific block index
 */
export async function handleVideoUploadForBlock(file: File, blockIndex: number): Promise<void> {
  showNotification('Processing video...', 'info');

  try {
    // Server compresses and uploads the video
    const url = await uploadFile(file, 'video');

    // Update block with new video
    callbacks?.updateBlock(blockIndex, {
      src: url,
    });

    showNotification('Video processed!', 'success');
  } catch (error) {
    console.error('Video upload failed:', error);
    showNotification(error instanceof Error ? error.message : 'Video processing failed', 'error');
  }
}

/**
 * Handle image upload and insert as new block after specified block
 */
export async function handleImageUpload(file: File, afterBlockId: string | null = null): Promise<void> {
  showNotification('Processing image...', 'info');

  try {
    const processedBlob = await processImage(file);
    const url = await uploadFile(processedBlob, 'image');
    insertImageBlock(url, file.name, afterBlockId);
    showNotification('Image uploaded!', 'success');
  } catch (error) {
    console.error('Image upload failed:', error);
    showNotification('Image upload failed', 'error');
  }
}

/**
 * Handle video upload and insert as new block
 */
export async function handleVideoUpload(file: File, afterBlockId: string | null = null): Promise<void> {
  showNotification('Processing video...', 'info');

  try {
    const url = await uploadFile(file, 'video');
    insertVideoBlock(url, afterBlockId);
    showNotification('Video processed!', 'success');
  } catch (error) {
    console.error('Video upload failed:', error);
    showNotification(error instanceof Error ? error.message : 'Video processing failed', 'error');
  }
}

// ========== BLOCK INSERTION ==========

/**
 * Insert image block into editor
 */
function insertImageBlock(url: string, alt: string = '', afterBlockId: string | null = null): void {
  const cleanAlt = alt.replace(/\.[^/.]+$/, '');

  if (afterBlockId) {
    callbacks?.insertBlockAfter(afterBlockId, 'image', {
      src: url,
      alt: cleanAlt,
    });
  } else {
    const index = callbacks?.getBlocks().length ?? 0;
    callbacks?.insertBlock(index, 'image', {
      src: url,
      alt: cleanAlt,
    });
  }
}

/**
 * Insert video block into editor
 */
function insertVideoBlock(url: string, afterBlockId: string | null = null): void {
  if (afterBlockId) {
    callbacks?.insertBlockAfter(afterBlockId, 'video', { src: url });
  } else {
    const index = callbacks?.getBlocks().length ?? 0;
    callbacks?.insertBlock(index, 'video', { src: url });
  }
}

// ========== REPLACE HANDLERS ==========

/**
 * Replace image in existing image block by index
 */
export async function replaceImageByIndex(blockIndex: number): Promise<void> {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (file) {
      await handleImageUploadForBlock(file, blockIndex);
    }
  });

  input.click();
}

/**
 * Replace video in existing video block by index
 */
export async function replaceVideoByIndex(blockIndex: number): Promise<void> {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'video/*';

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (file) {
      await handleVideoUploadForBlock(file, blockIndex);
    }
  });

  input.click();
}

// ========== PUBLIC API ==========

const EditMedia = {
  // Constants
  MAX_IMAGE_WIDTH,
  IMAGE_QUALITY,
  ALLOWED_IMAGE_TYPES,
  ALLOWED_VIDEO_TYPES,
  RESIZE_CONFIG,

  // State getters
  get selectedMedia() { return selectedMedia; },
  get isResizing() { return isResizing; },

  // Initialization
  init,

  // Selection
  select,
  deselect,

  // Upload handlers
  handleImageUploadForBlock,
  handleVideoUploadForBlock,
  handleImageUpload,
  handleVideoUpload,

  // Replace handlers
  replaceImageByIndex,
  replaceVideoByIndex,

  // Style utilities
  parseStyle,
  serializeStyle,
  styleHasWidth,
};

export default EditMedia;

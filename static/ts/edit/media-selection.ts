import type { BlockContext, HtmlBlock, ImageBlock, VideoBlock } from '../types/blocks';
import { styleDeclares, syncSandboxAutoHeight } from '../core/html-sandbox';
import { parseStyle, serializeStyle } from './block-style';
import { uploadContentVideo, uploadImage, type VideoUploadProgressUpdate } from './media-upload';
import { showNotification } from './notify';
import type { BlockStore } from './store';
import { clamp } from './clamp';

type SelectableBlock = ImageBlock | VideoBlock | HtmlBlock;
type HandlePosition = 'n' | 'e' | 's' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

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

export interface MediaController {
  select(element: HTMLElement, block: SelectableBlock): void;
  deselect(): void;
  uploadImageInto(file: File, blockId: string): Promise<void>;
  uploadVideoInto(file: File, blockId: string, onProgress?: (update: VideoUploadProgressUpdate) => void): Promise<void>;
}

const MIN_WIDTH_PERCENT = 20;
const MIN_WIDTH_PX = 80;
const MIN_HEIGHT_PX = 60;
const FULL_WIDTH_TOLERANCE_PX = 2;
const HANDLE_OFFSET_PX = 6;
const CORNER_HANDLES: HandlePosition[] = ['nw', 'ne', 'sw', 'se'];
const ALL_HANDLES: HandlePosition[] = ['nw', 'ne', 'sw', 'se', 'n', 'e', 's', 'w'];

/** A style with the new size and everything unrelated kept. A full-width drag drops the width. */
function resizedStyle(style: string | null | undefined, width: number, maxWidth: number, height?: number): string | null {
  const styles = parseStyle(style);
  for (const property of ['margin-left', 'margin-right', 'display', 'max-width', 'min-width', 'max-height', 'min-height']) {
    delete styles[property];
  }
  if (height === undefined) {
    delete styles['height'];
  } else {
    styles['height'] = `${Math.round(height)}px`;
  }
  if (Math.abs(width - maxWidth) <= FULL_WIDTH_TOLERANCE_PX) {
    delete styles['width'];
  } else {
    styles['width'] = `${Math.round(width)}px`;
  }
  return serializeStyle(styles) || null;
}

function positionHandle(handle: HTMLElement, position: HandlePosition, rect: DOMRect): void {
  const midX = rect.left + rect.width / 2;
  const midY = rect.top + rect.height / 2;
  const top = position.includes('n') ? rect.top : position.includes('s') ? rect.bottom : midY;
  const left = position.includes('w') ? rect.left : position.includes('e') ? rect.right : midX;
  handle.style.position = 'fixed';
  handle.style.top = `${top - HANDLE_OFFSET_PX}px`;
  handle.style.left = `${left - HANDLE_OFFSET_PX}px`;
}

export function createMediaController(store: BlockStore, signal: AbortSignal): MediaController {
  let selected: { element: HTMLElement; block: SelectableBlock; context: BlockContext | null } | null = null;
  let handles: HTMLDivElement[] = [];
  let resize: ResizeState | null = null;

  const updateHandlePositions = (): void => {
    if (!selected) return;
    const rect = selected.element.getBoundingClientRect();
    handles.forEach((handle) => positionHandle(handle, handle.dataset.position as HandlePosition, rect));
  };

  const removeHandles = (): void => {
    handles.forEach((handle) => handle.remove());
    handles = [];
  };

  const writeStyle = (style: string | null, markDirty: boolean): void => {
    if (!selected) return;
    selected.context ??= store.contextOf(selected.block.id);
    if (selected.context) {
      store.updateFields(selected.context, { style }, { render: false, markDirty });
    }
  };

  const handleMouseMove = (event: MouseEvent): void => {
    if (!resize || !selected) return;
    const { position, startX, startY, startWidth, startHeight, minWidth, maxWidth, minHeight, maxHeight, aspectRatio } = resize;
    const { element, block } = selected;
    const isIframe = element instanceof HTMLIFrameElement;
    const growsLeft = position.includes('w');
    const deltaX = (event.clientX - startX) * (growsLeft ? -1 : 1);
    const widthFromDrag = clamp(startWidth + deltaX, minWidth, maxWidth);

    let width = widthFromDrag;
    let height = startHeight;
    if (isIframe && CORNER_HANDLES.includes(position)) {
      height = width / aspectRatio;
      if (height < minHeight || height > maxHeight) {
        height = clamp(height, minHeight, maxHeight);
        width = clamp(height * aspectRatio, minWidth, maxWidth);
        height = width / aspectRatio;
      }
    } else if (isIframe && (position === 'n' || position === 's')) {
      const deltaY = (event.clientY - startY) * (position === 'n' ? -1 : 1);
      height = clamp(startHeight + deltaY, minHeight, maxHeight);
      width = startWidth;
    }

    resize.lastWidth = width;
    resize.lastHeight = height;

    element.style.width = `${Math.round(width)}px`;
    if (isIframe) {
      element.style.height = `${Math.round(height)}px`;
      element.dataset.autoHeight = 'false';
    } else {
      element.style.height = 'auto';
    }

    const style = resizedStyle(block.style, width, maxWidth, isIframe ? height : undefined);
    writeStyle(style, false);
    selected.block = { ...block, style };
    updateHandlePositions();
  };

  const stopResize = (): void => {
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', stopResize);
    document.body.style.userSelect = '';

    const finished = resize;
    resize = null;
    if (!finished || !selected) return;

    const { element, block } = selected;
    const isIframe = element instanceof HTMLIFrameElement;
    element.classList.remove('media-resizing');

    const style = resizedStyle(block.style, finished.lastWidth, finished.maxWidth, isIframe ? finished.lastHeight : undefined);
    writeStyle(style, true);
    if (!styleDeclares(style, 'width')) element.style.width = '';
    if (!styleDeclares(style, 'height')) element.style.height = '';
    if (isIframe) syncSandboxAutoHeight(element, style);
  };

  const startResize = (event: MouseEvent, position: HandlePosition): void => {
    if (!selected) return;
    event.preventDefault();
    event.stopPropagation();

    const { element } = selected;
    const rect = element.getBoundingClientRect();
    if (!rect.width) return;

    const container = element.closest('.row-column, .block-content') ?? element.parentElement;
    const containerWidth = container?.getBoundingClientRect().width ?? rect.width;

    element.classList.add('media-resizing');
    resize = {
      position,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
      minWidth: Math.max(MIN_WIDTH_PX, (containerWidth * MIN_WIDTH_PERCENT) / 100),
      maxWidth: containerWidth,
      minHeight: MIN_HEIGHT_PX,
      maxHeight: Math.max(MIN_HEIGHT_PX, rect.height * 3, window.innerHeight * 0.9),
      lastWidth: rect.width,
      lastHeight: rect.height,
      aspectRatio: rect.height > 0 ? rect.width / rect.height : 16 / 9,
    };

    document.addEventListener('mousemove', handleMouseMove, { signal });
    document.addEventListener('mouseup', stopResize, { signal });
    document.body.style.userSelect = 'none';
  };

  const createHandles = (element: HTMLElement, positions: HandlePosition[]): void => {
    removeHandles();
    const rect = element.getBoundingClientRect();
    handles = positions.map((position) => {
      const handle = document.createElement('div');
      handle.className = `resize-handle ${position}`;
      handle.dataset.position = position;
      positionHandle(handle, position, rect);
      handle.addEventListener('mousedown', (event) => startResize(event, position));
      document.body.appendChild(handle);
      return handle;
    });
  };

  const deselect = (): void => {
    if (resize) stopResize();
    if (!selected) return;
    selected.element.classList.remove('media-selected');
    removeHandles();
    selected = null;
  };

  const uploadImageInto = async (file: File, blockId: string): Promise<void> => {
    showNotification('Processing image...', 'info');
    try {
      const url = await uploadImage(file);
      const context = store.contextOf(blockId);
      if (!context) throw new Error('Target block not found');
      store.updateFields(context, { src: url, alt: file.name.replace(/\.[^/.]+$/, '') });
      showNotification('Image uploaded!', 'success');
    } catch (error) {
      console.error('Image upload failed:', error);
      showNotification(error instanceof Error ? error.message : 'Image upload failed', 'error');
    }
  };

  document.addEventListener('paste', (event) => {
    const item = Array.from(event.clipboardData?.items ?? []).find((candidate) => candidate.type.startsWith('image/'));
    const file = item?.getAsFile();
    if (!item) return;
    event.preventDefault();
    if (!file) return;

    const focused = document.activeElement;
    const index = Number.parseInt(focused?.closest<HTMLElement>('.block-wrapper')?.dataset.blockIndex ?? '', 10);
    if (Number.isNaN(index)) return;
    const rowSide = focused?.closest('.row-column-left') ? 'left' : focused?.closest('.row-column-right') ? 'right' : undefined;
    let target = store.blockAt({ index, rowSide });
    // Only an image block can hold it, so anywhere else it gets its own block next to the focus.
    if (target?.type !== 'image') {
      const inserted = store.insert(index + 1, 'image');
      target = store.blockAt({ index: inserted });
    }
    if (target) void uploadImageInto(file, target.id);
  }, { signal });

  document.addEventListener('click', (event) => {
    if (!selected || resize) return;
    const target = event.target as HTMLElement;
    if (target.closest('.image-block-wrapper, .video-block-wrapper, .html-block-wrapper, .resize-handle')) return;
    deselect();
  }, { signal });
  window.addEventListener('resize', updateHandlePositions, { signal });
  window.addEventListener('scroll', updateHandlePositions, { capture: true, signal });

  return {
    select(element, block) {
      if (selected?.element === element) return;
      deselect();

      selected = { element, block, context: store.contextOf(block.id) };
      element.classList.add('media-selected');
      createHandles(element, block.type === 'html' ? ALL_HANDLES : CORNER_HANDLES);
      updateHandlePositions();
    },

    deselect,
    uploadImageInto,

    async uploadVideoInto(file, blockId, onProgress) {
      showNotification('Processing video...', 'info');
      try {
        const url = await uploadContentVideo(file, onProgress);
        const context = store.contextOf(blockId);
        if (!context) throw new Error('Target block not found');
        store.updateFields(context, { src: url });
        showNotification('Video processed!', 'success');
      } catch (error) {
        console.error('Video upload failed:', error);
        showNotification(error instanceof Error ? error.message : 'Video processing failed', 'error');
      }
    },
  };
}

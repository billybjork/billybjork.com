import type { BlockContext, TextBlock } from '../types/blocks';
import type { EditorContext } from './context';
import {
  headingSlugsBefore,
  renderLinePreview,
  renderedToRawBoundaries,
} from './inline-markdown';
import {
  handleFormattingShortcuts,
  handleListShortcuts,
  parseListLine,
} from './markdown-textarea';
import { clamp } from './clamp';

type LineSelection = number | { start: number; end?: number } | null;

const PLACEHOLDER = 'Type something... (type / for commands)';
const MIN_LINE_HEIGHT_PX = 27;

interface CaretPositionLike {
  offsetNode: Node;
  offset: number;
}

type CaretPointDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => CaretPositionLike | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

const lineActivators = new WeakMap<HTMLElement, (row: HTMLElement, selection: LineSelection) => void>();

export function activateLine(row: HTMLElement, selection: LineSelection = null): void {
  const editor = row.closest<HTMLElement>('.text-block-lines');
  if (editor) lineActivators.get(editor)?.(row, selection);
}

function textOffsetWithin(preview: HTMLElement, container: Node, offset: number): number | null {
  if (container !== preview && !preview.contains(container)) return null;
  const range = preview.ownerDocument.createRange();
  range.selectNodeContents(preview);
  try {
    range.setEnd(container, offset);
  } catch (error) {
    // The browser's hit-test can name an offset the node no longer has.
    console.warn('Could not measure a preview offset:', error);
    return null;
  }
  return range.toString().length;
}

function previewOffsetAtPoint(preview: HTMLElement, event: MouseEvent): number | null {
  const doc = preview.ownerDocument as CaretPointDocument;
  const position = doc.caretPositionFromPoint?.(event.clientX, event.clientY);
  if (position) return textOffsetWithin(preview, position.offsetNode, position.offset);

  const range = doc.caretRangeFromPoint?.(event.clientX, event.clientY);
  return range ? textOffsetWithin(preview, range.startContainer, range.startOffset) : null;
}

function rawOffset(boundaries: number[], rendered: number, fallback: number): number {
  return boundaries[clamp(rendered, 0, boundaries.length - 1)] ?? fallback;
}

function clickedCaret(row: HTMLElement, event: MouseEvent): number | null {
  const textarea = row.querySelector<HTMLTextAreaElement>('.text-line-input');
  const preview = row.querySelector<HTMLElement>('.text-block-line-preview');
  if (!textarea || !preview) return null;

  const rendered = previewOffsetAtPoint(preview, event);
  if (rendered === null) return null;

  return rawOffset(renderedToRawBoundaries(textarea.value, row.dataset.lineType), rendered, textarea.value.length);
}

/** Ranges can be transient mid-update, where intersectsNode throws. */
function rangesIn(node: Node): Range[] {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return [];

  const ranges: Range[] = [];
  for (let i = 0; i < selection.rangeCount; i += 1) {
    const range = selection.getRangeAt(i);
    try {
      if (range.intersectsNode(node)) ranges.push(range);
    } catch (error) {
      console.warn('Skipping a selection range:', error);
    }
  }
  return ranges;
}

function selectedRawRange(row: HTMLElement): { start: number; end: number } | null {
  const textarea = row.querySelector<HTMLTextAreaElement>('.text-line-input');
  const preview = row.querySelector<HTMLElement>('.text-block-line-preview');
  if (!textarea || !preview) return null;

  for (const range of rangesIn(preview)) {
    const start = textOffsetWithin(preview, range.startContainer, range.startOffset);
    const end = textOffsetWithin(preview, range.endContainer, range.endOffset);
    if (start === null || end === null || start === end) continue;

    const boundaries = renderedToRawBoundaries(textarea.value, row.dataset.lineType);
    const rawStart = rawOffset(boundaries, Math.min(start, end), textarea.value.length);
    const rawEnd = rawOffset(boundaries, Math.max(start, end), textarea.value.length);
    return rawStart === rawEnd ? null : { start: rawStart, end: rawEnd };
  }
  return null;
}

function syncLineHeight(row: HTMLElement): void {
  const preview = row.querySelector<HTMLElement>('.text-block-line-preview');
  const textarea = row.querySelector<HTMLTextAreaElement>('.text-line-input');

  requestAnimationFrame(() => {
    const minHeight = Math.max(MIN_LINE_HEIGHT_PX, preview?.offsetHeight ?? 0);
    row.style.minHeight = `${minHeight}px`;
    row.style.height = row.classList.contains('is-editing')
      ? `${Math.max(minHeight, textarea?.scrollHeight ?? 0)}px`
      : '';
  });
}

/**
 * Edits a text block one line at a time: each line is a rendered preview until
 * clicked, then a textarea.
 */
export function createLineEditor(ctx: EditorContext, block: TextBlock, context: BlockContext): HTMLElement {
  const lineContainer = document.createElement('div');
  lineContainer.className = 'text-block-lines';
  if (block.align) lineContainer.style.textAlign = block.align;

  const lines = (block.content || '').split('\n');
  let activeLineIndex: number | null = null;
  let suppressNextActivationClick = false;
  const slashEnabled = !context.rowSide;

  const isSinglePlaceholderLine = (): boolean => lines.length === 1 && !lines[0]?.trim();

  const rowAt = (lineIndex: number): HTMLElement | null => (
    lineContainer.querySelector<HTMLElement>(`.text-block-line[data-line-index="${lineIndex}"]`)
  );

  const updateBlockContent = (): void => {
    const content = lines.join('\n');
    ctx.store.update(
      context,
      (existing) => (existing.type === 'text' ? { ...existing, content } : existing),
      { render: false },
    );
  };

  const renderLines = (focusLineIndex: number | null = null, focusCaret: LineSelection = null): void => {
    ctx.inlineToolbar.releaseTargetWithin(lineContainer);
    lineContainer.innerHTML = '';
    const takenSlugs = new Set<string>();
    lines.forEach((lineText, lineIndex) => {
      lineContainer.appendChild(buildRow(lineText, lineIndex, takenSlugs));
    });

    requestAnimationFrame(() => {
      lineContainer.querySelectorAll<HTMLElement>('.text-block-line').forEach(syncLineHeight);
    });

    if (focusLineIndex !== null) {
      const row = rowAt(focusLineIndex);
      if (row) activate(row, focusCaret);
    }
  };

  const commitLine = (lineIndex: number, textarea: HTMLTextAreaElement, row: HTMLElement): void => {
    // A browser's native `input` may have already committed this edit and rebuilt the rows.
    if (!textarea.isConnected) return;

    const value = textarea.value;
    if (value.includes('\n')) {
      const split = value.split('\n');
      lines.splice(lineIndex, 1, ...split);
      updateBlockContent();
      renderLines(lineIndex + split.length - 1, split[split.length - 1]?.length ?? 0);
      return;
    }

    lines[lineIndex] = value;
    updateBlockContent();
    syncLineHeight(row);
    ctx.inlineToolbar.scheduleUpdate();
  };

  const splitLine = (textarea: HTMLTextAreaElement, lineIndex: number): void => {
    const before = textarea.value.slice(0, textarea.selectionStart);
    const after = textarea.value.slice(textarea.selectionStart);
    const list = parseListLine(before);
    const continuation = list ? `${list.indent}${list.nextMarker}` : null;

    lines[lineIndex] = before;
    lines.splice(lineIndex + 1, 0, continuation ? continuation + after.replace(/^\s+/, '') : after);
    updateBlockContent();
    renderLines(lineIndex + 1, continuation?.length ?? 0);
  };

  const mergeLines = (firstIndex: number): void => {
    const first = lines[firstIndex] ?? '';
    lines.splice(firstIndex, 2, first + (lines[firstIndex + 1] ?? ''));
    updateBlockContent();
    renderLines(firstIndex, first.length);
  };

  const handleKeydown = (event: KeyboardEvent, textarea: HTMLTextAreaElement, lineIndex: number, commit: () => void): void => {
    if (slashEnabled && ctx.slash.handleKeydown(event)) return;
    if (handleFormattingShortcuts(event, textarea, commit, ctx.blocksRoot)) return;
    if (handleListShortcuts(event, textarea, commit)) return;

    const { key, shiftKey, metaKey, ctrlKey, altKey } = event;
    const collapsed = textarea.selectionStart === textarea.selectionEnd;
    const atStart = collapsed && textarea.selectionStart === 0;
    const atEnd = collapsed && textarea.selectionStart === textarea.value.length;
    const unmodified = !shiftKey && !metaKey && !ctrlKey && !altKey;
    const hasPrevious = lineIndex > 0;
    const hasNext = lineIndex < lines.length - 1;

    if (key === 'Enter' && !shiftKey && !metaKey && !ctrlKey) {
      event.preventDefault();
      splitLine(textarea, lineIndex);
    } else if (key === 'Backspace' && atStart && hasPrevious) {
      event.preventDefault();
      mergeLines(lineIndex - 1);
    } else if (key === 'Delete' && atEnd && hasNext) {
      event.preventDefault();
      mergeLines(lineIndex);
    } else if (((key === 'ArrowLeft' && unmodified) || key === 'ArrowUp') && atStart && hasPrevious) {
      event.preventDefault();
      renderLines(lineIndex - 1, lines[lineIndex - 1]?.length ?? 0);
    } else if (((key === 'ArrowRight' && unmodified) || key === 'ArrowDown') && atEnd && hasNext) {
      event.preventDefault();
      renderLines(lineIndex + 1, 0);
    }
  };

  const buildRow = (lineText: string, lineIndex: number, takenSlugs: Set<string>): HTMLElement => {
    const row = document.createElement('div');
    row.className = 'text-block-line';
    row.dataset.lineIndex = String(lineIndex);

    const preview = document.createElement('div');
    preview.className = 'text-block-line-preview';
    fillPreview(row, preview, lineText, takenSlugs);

    const textarea = document.createElement('textarea');
    textarea.className = 'text-line-input';
    textarea.value = lineText;
    textarea.rows = 1;
    textarea.placeholder = PLACEHOLDER;

    const commit = (): void => commitLine(lineIndex, textarea, row);

    // A drag across the preview selects text: carry that selection into the textarea.
    preview.addEventListener('mouseup', (event) => {
      if (row.classList.contains('is-editing')) return;
      const range = selectedRawRange(row);
      if (!range) return;
      suppressNextActivationClick = true;
      event.stopPropagation();
      activate(row, range);
    });

    preview.addEventListener('click', (event) => {
      if (suppressNextActivationClick) {
        suppressNextActivationClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (rangesIn(preview).length) {
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      activate(row, clickedCaret(row, event));
    });

    row.addEventListener('click', (event) => {
      if (suppressNextActivationClick) {
        suppressNextActivationClick = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (rangesIn(row).length) return;
      if (!row.classList.contains('is-editing')) {
        event.preventDefault();
        event.stopPropagation();
        activate(row);
      }
    });

    textarea.addEventListener('input', () => {
      if (slashEnabled) ctx.slash.handleTextareaInput(textarea, context.index, commit);
      commit();
    });
    textarea.addEventListener('keydown', (event) => handleKeydown(event, textarea, lineIndex, commit));
    textarea.addEventListener('blur', () => {
      if (activeLineIndex === lineIndex) deactivate(row, textarea, preview, lineIndex);
    });
    for (const type of ['select', 'keyup', 'mouseup']) {
      textarea.addEventListener(type, ctx.inlineToolbar.scheduleUpdate);
    }

    row.append(preview, textarea);
    return row;
  };

  const fillPreview = (row: HTMLElement, preview: HTMLElement, text: string, takenSlugs: Set<string>): void => {
    preview.classList.remove('text-block-line-placeholder');
    preview.innerHTML = '';
    if (isSinglePlaceholderLine() && !text.trim()) {
      row.dataset.lineType = 'empty';
      preview.classList.add('text-block-line-placeholder');
      preview.textContent = PLACEHOLDER;
      return;
    }
    const rendered = renderLinePreview(text, takenSlugs);
    row.dataset.lineType = rendered.type;
    preview.appendChild(rendered.node);
  };

  const activate = (row: HTMLElement, selection: LineSelection = null): void => {
    const lineIndex = Number(row.dataset.lineIndex);

    if (activeLineIndex !== null && activeLineIndex !== lineIndex) {
      const previous = rowAt(activeLineIndex);
      const previousInput = previous?.querySelector<HTMLTextAreaElement>('.text-line-input');
      const previousPreview = previous?.querySelector<HTMLElement>('.text-block-line-preview');
      if (previous && previousInput && previousPreview) {
        deactivate(previous, previousInput, previousPreview, activeLineIndex);
      }
    }

    activeLineIndex = lineIndex;
    row.classList.add('is-editing');

    const textarea = row.querySelector<HTMLTextAreaElement>('.text-line-input');
    if (!textarea) return;

    textarea.focus({ preventScroll: true });
    if (selection !== null && typeof selection === 'object') {
      textarea.setSelectionRange(selection.start, selection.end ?? selection.start);
    } else {
      const caret = selection ?? textarea.value.length;
      textarea.setSelectionRange(caret, caret);
    }

    ctx.inlineToolbar.setTarget({
      textarea,
      row,
      onEdit: () => commitLine(lineIndex, textarea, row),
    });
    syncLineHeight(row);
  };

  const deactivate = (row: HTMLElement, textarea: HTMLTextAreaElement, preview: HTMLElement, lineIndex: number): void => {
    row.classList.remove('is-editing');
    fillPreview(row, preview, textarea.value, headingSlugsBefore(lines, lineIndex));
    ctx.inlineToolbar.releaseTarget(textarea);
    activeLineIndex = null;
    syncLineHeight(row);
  };

  lineContainer.addEventListener('click', (event) => {
    if (event.target !== lineContainer) return;

    let closest: HTMLElement | null = null;
    let closestDistance = Infinity;
    lineContainer.querySelectorAll<HTMLElement>('.text-block-line').forEach((row) => {
      const rect = row.getBoundingClientRect();
      const distance = Math.abs(event.clientY - (rect.top + rect.height / 2));
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = row;
      }
    });

    const row = closest as HTMLElement | null;
    if (row && !row.classList.contains('is-editing')) {
      event.preventDefault();
      activate(row);
    }
  });

  lineActivators.set(lineContainer, activate);
  renderLines();
  return lineContainer;
}

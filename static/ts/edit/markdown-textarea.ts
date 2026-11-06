import { LINK_PATTERN, parseHeadingLine } from './inline-markdown';
import { showLinkDialog } from './link-dialog';
import { clamp } from './clamp';

interface FormatInfo {
  formatStart: number;
  formatEnd: number;
  innerStart: number;
  innerEnd: number;
}

interface LinkInfo {
  start: number;
  end: number;
  text: string;
  url: string;
}

const LIST_INDENT = '   ';
const LINK_LOOKBEHIND_LIMIT = 500;

/** @returns a function that sizes the textarea to its content. */
export function setupAutoResizeTextarea(
  textarea: HTMLTextAreaElement,
  onUpdate?: (value: string) => void
): () => void {
  const autoResize = (): void => {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  };

  const sync = (): void => {
    autoResize();
    onUpdate?.(textarea.value);
  };
  textarea.addEventListener('input', sync);

  // Sizes now to avoid a layout shift, then again once the textarea has a layout.
  autoResize();
  requestAnimationFrame(autoResize);

  return sync;
}

/** Goes through execCommand so the browser's own undo stack records the edit. */
export function insertTextWithUndo(textarea: HTMLTextAreaElement, text: string): void {
  textarea.focus({ preventScroll: true });
  if (!document.execCommand('insertText', false, text)) {
    textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, 'end');
  }
}

function replaceRange(textarea: HTMLTextAreaElement, start: number, end: number, text: string): void {
  textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(start, end);
  insertTextWithUndo(textarea, text);
}

/** The maximal run of `*` covering `index`. `*x*` is emphasis, `**x**` strong, `***x***` both. */
function asteriskRun(value: string, index: number): { start: number; end: number } {
  let start = index;
  let end = index;
  while (start > 0 && value[start - 1] === '*') start -= 1;
  while (end < value.length && value[end] === '*') end += 1;
  return { start, end };
}

function runCarriesMarker(length: number, marker: string): boolean {
  return marker === '*' ? length % 2 === 1 : length >= 2;
}

/** The markers around or containing a selection, on its line. Formatting does not span lines. */
export function findFormatAroundSelection(
  value: string,
  selStart: number,
  selEnd: number,
  before: string,
  after: string
): FormatInfo | null {
  const lineStart = value.lastIndexOf('\n', selStart - 1) + 1;
  const lineEndIndex = value.indexOf('\n', selEnd);
  const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
  const isAsterisk = before.startsWith('*');

  let openPos = -1;
  for (let i = selStart; i >= lineStart; i -= 1) {
    if (value.slice(i, i + before.length) !== before) continue;
    if (!isAsterisk) {
      openPos = i;
      break;
    }
    const run = asteriskRun(value, i);
    if (runCarriesMarker(run.end - run.start, before)) {
      openPos = run.start;
      break;
    }
    i = run.start;
  }
  if (openPos === -1) return null;

  const innerStart = openPos + before.length;
  let closePos = -1;
  for (let i = Math.max(innerStart, selEnd); i <= lineEnd - after.length; i += 1) {
    if (value.slice(i, i + after.length) !== after) continue;
    if (!isAsterisk) {
      closePos = i;
      break;
    }
    const run = asteriskRun(value, i);
    if (runCarriesMarker(run.end - run.start, after)) {
      closePos = run.end - after.length;
      break;
    }
    i = run.end - 1;
  }
  if (closePos === -1 || selStart < innerStart || selEnd > closePos) return null;

  return {
    formatStart: openPos,
    formatEnd: closePos + after.length,
    innerStart,
    innerEnd: closePos,
  };
}

export function toggleFormat(
  textarea: HTMLTextAreaElement,
  before: string,
  after: string,
  onUpdate?: () => void
): void {
  const { value, selectionStart: start, selectionEnd: end } = textarea;
  const format = findFormatAroundSelection(value, start, end, before, after);

  if (format) {
    const inner = value.slice(format.innerStart, format.innerEnd);
    replaceRange(textarea, format.formatStart, format.formatEnd, inner);
    textarea.setSelectionRange(format.formatStart, format.formatStart + inner.length);
  } else {
    const selected = value.slice(start, end) || 'text';
    replaceRange(textarea, start, end, before + selected + after);
    textarea.setSelectionRange(start + before.length, start + before.length + selected.length);
  }

  onUpdate?.();
}

/** Handles Cmd/Ctrl + B, I, U, and K; true when the key was one of them. */
export function handleFormattingShortcuts(
  event: KeyboardEvent,
  textarea: HTMLTextAreaElement,
  onUpdate: () => void,
  anchorRoot: HTMLElement
): boolean {
  if (!(event.metaKey || event.ctrlKey)) return false;

  switch (event.key) {
    case 'b':
      event.preventDefault();
      toggleFormat(textarea, '**', '**', onUpdate);
      return true;
    case 'i':
      event.preventDefault();
      toggleFormat(textarea, '*', '*', onUpdate);
      return true;
    case 'u':
      event.preventDefault();
      toggleFormat(textarea, '<u>', '</u>', onUpdate);
      return true;
    case 'k':
      event.preventDefault();
      void insertLink(textarea, anchorRoot, onUpdate);
      return true;
  }
  return false;
}

export function getLineHeadingLevel(text: string): number | null {
  return parseHeadingLine(text)?.level ?? null;
}

/** Sets a single-line textarea to a heading of `level`, or back to plain text if already that level. */
export function toggleLineHeading(textarea: HTMLTextAreaElement, level: number): void {
  const { value, selectionStart, selectionEnd } = textarea;
  const heading = parseHeadingLine(value);
  const indent = heading?.indent ?? value.match(/^\s*/)?.[0] ?? '';
  const hashes = '#'.repeat(level);

  let nextValue: string;
  let oldPrefixLength = indent.length;
  if (heading) {
    oldPrefixLength = indent.length + heading.level + 1;
    nextValue = heading.level === level ? `${indent}${heading.body}` : `${indent}${hashes} ${heading.body}`;
  } else {
    nextValue = `${indent}${hashes} ${value.slice(indent.length)}`;
  }
  const nextPrefixLength = heading?.level === level ? indent.length : indent.length + hashes.length + 1;

  replaceRange(textarea, 0, value.length, nextValue);

  const delta = nextPrefixLength - oldPrefixLength;
  textarea.setSelectionRange(
    clamp(selectionStart + delta, 0, nextValue.length),
    clamp(selectionEnd + delta, 0, nextValue.length)
  );
}

export function findLinkAtCursor(textarea: HTMLTextAreaElement): LinkInfo | null {
  const { value, selectionStart } = textarea;

  let bracketStart = -1;
  for (let i = selectionStart; i >= Math.max(0, selectionStart - LINK_LOOKBEHIND_LIMIT); i -= 1) {
    if (value[i] === '[') {
      bracketStart = i;
      break;
    }
    if (value[i] === '\n' || value[i] === ')') break;
  }
  if (bracketStart === -1) return null;

  const match = value.slice(bracketStart).match(new RegExp(`^${LINK_PATTERN}`));
  if (!match) return null;

  const end = bracketStart + match[0].length;
  if (selectionStart > end) return null;

  return { start: bracketStart, end, text: match[1] ?? '', url: match[2] ?? '' };
}

/** Anchors, paths, and URLs with a scheme pass through; bare domains and addresses get one. */
function normalizeLinkUrl(input: string): string {
  const trimmed = input.trim();
  if (/^(#|\/|\.\/|\.\.\/)/.test(trimmed) || /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed)) return trimmed;
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) return `mailto:${trimmed}`;
  if (/^(?:www\.)?[\w-]+(?:\.[\w-]+)+(?::\d+)?(?:[/?#]|$)/.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

/** Inserts a link around the selection, or edits the one under the cursor. */
export async function insertLink(
  textarea: HTMLTextAreaElement,
  anchorRoot: HTMLElement,
  onUpdate: () => void
): Promise<void> {
  const existing = findLinkAtCursor(textarea);
  const { selectionStart, selectionEnd } = textarea;
  const selectedText = textarea.value.slice(selectionStart, selectionEnd) || 'link text';

  const result = await showLinkDialog({ existingUrl: existing?.url, container: anchorRoot });
  if (result.action === 'cancel') return;

  if (result.action === 'remove' && existing) {
    replaceRange(textarea, existing.start, existing.end, existing.text);
  } else if (result.action === 'insert' && result.url) {
    const url = normalizeLinkUrl(result.url);
    if (!url) return;
    if (existing) {
      replaceRange(textarea, existing.start, existing.end, `[${existing.text}](${url})`);
    } else {
      replaceRange(textarea, selectionStart, selectionEnd, `[${selectedText}](${url})`);
    }
  }

  onUpdate();
}

function selectedLineRange(textarea: HTMLTextAreaElement): { start: number; end: number } {
  const { value, selectionStart, selectionEnd } = textarea;
  const end = value.indexOf('\n', selectionEnd);
  return {
    start: value.lastIndexOf('\n', selectionStart - 1) + 1,
    end: end === -1 ? value.length : end,
  };
}

function indentLines(textarea: HTMLTextAreaElement, onUpdate: () => void): void {
  const { value, selectionStart, selectionEnd } = textarea;
  const { start, end } = selectedLineRange(textarea);
  const lines = value.slice(start, end);

  const indented = lines.split('\n').map((line) => {
    const numbered = line.match(/^(\s*)\d+\.\s(.*)$/);
    return numbered
      ? `${LIST_INDENT}${numbered[1] ?? ''}- ${numbered[2] ?? ''}`
      : LIST_INDENT + line;
  }).join('\n');

  textarea.value = value.slice(0, start) + indented + value.slice(end);
  textarea.selectionStart = selectionStart + LIST_INDENT.length;
  textarea.selectionEnd = selectionEnd + (indented.length - lines.length);
  onUpdate();
}

function outdentLines(textarea: HTMLTextAreaElement, onUpdate: () => void): void {
  const { value, selectionStart, selectionEnd } = textarea;
  const { start, end } = selectedLineRange(textarea);

  let firstLineRemoved = 0;
  let totalRemoved = 0;
  const outdented = value.slice(start, end).split('\n').map((line, index) => {
    const removed = line.match(/^( {1,4}|\t)/)?.[0].length ?? 0;
    if (index === 0) firstLineRemoved = removed;
    totalRemoved += removed;
    return line.slice(removed);
  }).join('\n');

  textarea.value = value.slice(0, start) + outdented + value.slice(end);
  textarea.selectionStart = Math.max(start, selectionStart - firstLineRemoved);
  textarea.selectionEnd = selectionEnd - totalRemoved;
  onUpdate();
}

/** The marker that continues a list line (`- ` or the next number), and the item's text. */
export function parseListLine(line: string): { indent: string; nextMarker: string; content: string } | null {
  const unordered = line.match(/^(\s*)([-*+])\s(.*)$/);
  if (unordered) {
    return { indent: unordered[1] ?? '', nextMarker: `${unordered[2]} `, content: unordered[3] ?? '' };
  }
  const ordered = line.match(/^(\s*)(\d+)\.\s(.*)$/);
  if (ordered) {
    return { indent: ordered[1] ?? '', nextMarker: `${Number.parseInt(ordered[2] ?? '1', 10) + 1}. `, content: ordered[3] ?? '' };
  }
  return null;
}

/** Continues a list on Enter, or ends it if the item is empty. */
function handleListEnter(event: KeyboardEvent, textarea: HTMLTextAreaElement, onUpdate: () => void): boolean {
  const { value, selectionStart, selectionEnd } = textarea;
  if (selectionStart !== selectionEnd) return false;

  const { start, end } = selectedLineRange(textarea);
  const list = parseListLine(value.slice(start, end));
  if (!list) return false;

  event.preventDefault();
  if (list.content.trim() === '') {
    textarea.value = value.slice(0, start) + value.slice(end);
    textarea.selectionStart = textarea.selectionEnd = start;
  } else {
    insertTextWithUndo(textarea, `\n${list.indent}${list.nextMarker}`);
  }
  onUpdate();
  return true;
}

/** Handles Tab, Shift+Tab, and Enter in a list; true when the key was consumed. */
export function handleListShortcuts(event: KeyboardEvent, textarea: HTMLTextAreaElement, onUpdate: () => void): boolean {
  if (event.key === 'Tab') {
    event.preventDefault();
    (event.shiftKey ? outdentLines : indentLines)(textarea, onUpdate);
    return true;
  }
  if (event.key === 'Enter' && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
    return handleListEnter(event, textarea, onUpdate);
  }
  return false;
}

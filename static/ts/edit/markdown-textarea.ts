import { showLinkDialog } from './link-dialog';

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
  textStart: number;
  textEnd: number;
  urlStart: number;
  urlEnd: number;
}

export function setupAutoResizeTextarea(
  textarea: HTMLTextAreaElement,
  onUpdate?: (value: string) => void
): () => void {
  const autoResize = (): void => {
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  };

  textarea.addEventListener('input', () => {
    autoResize();
    if (onUpdate) onUpdate(textarea.value);
  });

  // Size immediately to avoid post-render layout shifts, then refine next frame.
  autoResize();
  requestAnimationFrame(autoResize);

  return autoResize;
}

export function insertTextWithUndo(textarea: HTMLTextAreaElement, text: string): void {
  textarea.focus({ preventScroll: true });
  // execCommand preserves native undo stack
  if (!document.execCommand('insertText', false, text)) {
    // Fallback if execCommand fails
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    textarea.setRangeText(text, start, end, 'end');
  }
}

export function wrapSelection(
  textarea: HTMLTextAreaElement,
  before: string,
  after: string,
  onUpdate?: () => void
): void {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selectedText = textarea.value.substring(start, end) || 'text';
  const replacement = before + selectedText + after;

  textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(start, end);
  insertTextWithUndo(textarea, replacement);

  // Select the inner text
  textarea.selectionStart = start + before.length;
  textarea.selectionEnd = start + before.length + selectedText.length;

  if (onUpdate) onUpdate();
}

function findFormatAroundSelection(
  value: string,
  selStart: number,
  selEnd: number,
  before: string,
  after: string
): FormatInfo | null {
  // Constrain search to current line only (inline formatting doesn't span lines)
  const lineStart = value.lastIndexOf('\n', selStart - 1) + 1;
  const lineEnd = value.indexOf('\n', selEnd);
  const effectiveLineEnd = lineEnd === -1 ? value.length : lineEnd;

  // Search backwards from selection start for the opening marker
  let openPos = -1;

  for (let i = selStart; i >= lineStart; i--) {
    if (value.substring(i, i + before.length) === before) {
      const charBefore = i > 0 ? value[i - 1] : '';
      const isValidOpen = before !== '**' || charBefore !== '*';
      if (isValidOpen) {
        openPos = i;
        break;
      }
    }
  }

  if (openPos === -1) return null;

  // Search forwards from selection end for the closing marker
  let closePos = -1;
  const searchStart = Math.max(openPos + before.length, selEnd);

  for (let i = searchStart; i <= effectiveLineEnd - after.length; i++) {
    if (value.substring(i, i + after.length) === after) {
      const charAfter = i + after.length < value.length ? value[i + after.length] : '';
      const isValidClose = after !== '**' || charAfter !== '*';
      if (isValidClose) {
        closePos = i;
        break;
      }
    }
  }

  if (closePos === -1) return null;

  // Verify the selection is actually inside this formatted region
  const innerStart = openPos + before.length;
  const innerEnd = closePos;

  if (selStart >= innerStart && selEnd <= innerEnd) {
    return {
      formatStart: openPos,
      formatEnd: closePos + after.length,
      innerStart,
      innerEnd
    };
  }

  return null;
}

export function toggleFormat(
  textarea: HTMLTextAreaElement,
  before: string,
  after: string,
  onUpdate?: () => void
): void {
  const { value, selectionStart, selectionEnd } = textarea;

  // Check if we can find this format around/containing the selection
  const formatInfo = findFormatAroundSelection(value, selectionStart, selectionEnd, before, after);

  if (formatInfo) {
    // Already formatted - unwrap
    const { formatStart, formatEnd, innerStart, innerEnd } = formatInfo;
    const innerText = value.substring(innerStart, innerEnd);

    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(formatStart, formatEnd);
    insertTextWithUndo(textarea, innerText);

    // Position cursor/selection on the unwrapped text
    textarea.selectionStart = formatStart;
    textarea.selectionEnd = formatStart + innerText.length;
  } else {
    // Not formatted - wrap
    wrapSelection(textarea, before, after, () => {});
  }

  if (onUpdate) onUpdate();
}

export function handleFormattingShortcuts(
  e: KeyboardEvent,
  textarea: HTMLTextAreaElement,
  onUpdate?: () => void,
  container?: HTMLElement | null
): boolean {
  if (!(e.metaKey || e.ctrlKey)) return false;

  switch (e.key) {
    case 'b':
      e.preventDefault();
      toggleFormat(textarea, '**', '**', onUpdate);
      return true;
    case 'i':
      e.preventDefault();
      toggleFormat(textarea, '*', '*', onUpdate);
      return true;
    case 'u':
      e.preventDefault();
      toggleFormat(textarea, '<u>', '</u>', onUpdate);
      return true;
    case 'k':
      e.preventDefault();
      // Fire-and-forget async; onUpdate callback handles state sync
      insertLink(textarea, container ?? null, onUpdate);
      return true;
  }
  return false;
}

export function findLinkAtCursor(textarea: HTMLTextAreaElement): LinkInfo | null {
  const { value, selectionStart } = textarea;

  // Search backwards for '[' that starts a link
  let bracketStart = -1;
  for (let i = selectionStart; i >= Math.max(0, selectionStart - 500); i--) {
    if (value[i] === '[') {
      bracketStart = i;
      break;
    }
    if (value[i] === '\n' || value[i] === ')') break;
  }

  if (bracketStart === -1) return null;

  // Find the full link pattern: [text](url)
  const afterBracket = value.substring(bracketStart);
  const linkMatch = afterBracket.match(/^\[([^\]]*)\]\(([^)]*)\)/);

  if (!linkMatch) return null;

  const fullMatch = linkMatch[0];
  const linkEnd = bracketStart + fullMatch.length;

  if (selectionStart > linkEnd) return null;

  return {
    start: bracketStart,
    end: linkEnd,
    text: linkMatch[1] ?? '',
    url: linkMatch[2] ?? '',
    textStart: bracketStart + 1,
    textEnd: bracketStart + 1 + (linkMatch[1]?.length ?? 0),
    urlStart: bracketStart + (linkMatch[1]?.length ?? 0) + 3,
    urlEnd: linkEnd - 1
  };
}

function normalizeLinkUrl(input: string): string {
  const trimmed = (input || '').trim();
  if (!trimmed) return '';

  if (
    trimmed.startsWith('#') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../')
  ) {
    return trimmed;
  }

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed)) {
    return trimmed;
  }

  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
    return `mailto:${trimmed}`;
  }

  if (/^(?:www\.)?[\w-]+(?:\.[\w-]+)+(?::\d+)?(?:[/?#]|$)/.test(trimmed)) {
    return `https://${trimmed}`;
  }

  return trimmed;
}

export async function insertLink(
  textarea: HTMLTextAreaElement,
  container: HTMLElement | null,
  onUpdate?: () => void
): Promise<void> {
  const existingLink = findLinkAtCursor(textarea);

  // Store selection info before dialog opens (in case focus changes)
  const selectionStart = textarea.selectionStart;
  const selectionEnd = textarea.selectionEnd;
  const selectedText = textarea.value.substring(selectionStart, selectionEnd) || 'link text';

  // Show dialog with anchor discovery from container
  const result = await showLinkDialog({
    existingUrl: existingLink?.url,
    container: container ?? document.body
  });

  if (result.action === 'cancel') return;

  if (result.action === 'remove' && existingLink) {
    // Remove link, keep text
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(existingLink.start, existingLink.end);
    insertTextWithUndo(textarea, existingLink.text);
  } else if (result.action === 'insert' && result.url) {
    const normalizedUrl = normalizeLinkUrl(result.url);
    if (!normalizedUrl) return;

    if (existingLink) {
      // Update existing link URL
      const newLink = `[${existingLink.text}](${normalizedUrl})`;
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(existingLink.start, existingLink.end);
      insertTextWithUndo(textarea, newLink);
    } else {
      // Create new link
      const linkText = `[${selectedText}](${normalizedUrl})`;
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(selectionStart, selectionEnd);
      insertTextWithUndo(textarea, linkText);
    }
  }

  if (onUpdate) onUpdate();
}

function indentLines(textarea: HTMLTextAreaElement, onUpdate?: () => void): void {
  const { value, selectionStart, selectionEnd } = textarea;
  const indent = '   '; // 3 spaces for list sub-items

  const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
  let lineEnd = value.indexOf('\n', selectionEnd);
  if (lineEnd === -1) lineEnd = value.length;

  const beforeLines = value.substring(0, lineStart);
  const selectedLines = value.substring(lineStart, lineEnd);
  const afterLines = value.substring(lineEnd);

  const indentedLines = selectedLines.split('\n').map(line => {
    const numberedMatch = line.match(/^(\s*)\d+\.\s(.*)$/);
    if (numberedMatch) {
      return indent + (numberedMatch[1] ?? '') + '- ' + (numberedMatch[2] ?? '');
    }
    return indent + line;
  }).join('\n');

  textarea.value = beforeLines + indentedLines + afterLines;

  const addedChars = indentedLines.length - selectedLines.length;
  textarea.selectionStart = selectionStart + indent.length;
  textarea.selectionEnd = selectionEnd + addedChars;

  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  if (onUpdate) onUpdate();
}

function outdentLines(textarea: HTMLTextAreaElement, onUpdate?: () => void): void {
  const { value, selectionStart, selectionEnd } = textarea;

  const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
  let lineEnd = value.indexOf('\n', selectionEnd);
  if (lineEnd === -1) lineEnd = value.length;

  const beforeLines = value.substring(0, lineStart);
  const selectedLines = value.substring(lineStart, lineEnd);
  const afterLines = value.substring(lineEnd);

  let firstLineRemoved = 0;
  let totalRemoved = 0;

  const outdentedLines = selectedLines.split('\n').map((line, idx) => {
    const match = line.match(/^( {1,4}|\t)/);
    if (match) {
      const removed = match[0].length;
      if (idx === 0) firstLineRemoved = removed;
      totalRemoved += removed;
      return line.substring(removed);
    }
    return line;
  }).join('\n');

  textarea.value = beforeLines + outdentedLines + afterLines;

  textarea.selectionStart = Math.max(lineStart, selectionStart - firstLineRemoved);
  textarea.selectionEnd = selectionEnd - totalRemoved;

  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  if (onUpdate) onUpdate();
}

function handleListEnter(
  e: KeyboardEvent,
  textarea: HTMLTextAreaElement,
  onUpdate?: () => void
): boolean {
  const { value, selectionStart, selectionEnd } = textarea;

  if (selectionStart !== selectionEnd) return false;

  const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
  const lineEnd = value.indexOf('\n', selectionStart);
  const currentLine = value.substring(lineStart, lineEnd === -1 ? value.length : lineEnd);

  // Check for unordered list: -, *, +
  const unorderedMatch = currentLine.match(/^(\s*)([-*+])\s(.*)$/);
  if (unorderedMatch) {
    const [, indent = '', marker = '-', content = ''] = unorderedMatch;

    if (content.trim() === '') {
      e.preventDefault();
      const before = value.substring(0, lineStart);
      const after = value.substring(lineEnd === -1 ? value.length : lineEnd);
      textarea.value = before + after;
      textarea.selectionStart = textarea.selectionEnd = lineStart;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      if (onUpdate) onUpdate();
      return true;
    }

    e.preventDefault();
    const newLine = `\n${indent}${marker} `;
    insertTextWithUndo(textarea, newLine);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    if (onUpdate) onUpdate();
    return true;
  }

  // Check for ordered list: 1., 2., etc.
  const orderedMatch = currentLine.match(/^(\s*)(\d+)\.\s(.*)$/);
  if (orderedMatch) {
    const [, indent = '', num = '1', content = ''] = orderedMatch;

    if (content.trim() === '') {
      e.preventDefault();
      const before = value.substring(0, lineStart);
      const after = value.substring(lineEnd === -1 ? value.length : lineEnd);
      textarea.value = before + after;
      textarea.selectionStart = textarea.selectionEnd = lineStart;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      if (onUpdate) onUpdate();
      return true;
    }

    e.preventDefault();
    const nextNum = parseInt(num, 10) + 1;
    const newLine = `\n${indent}${nextNum}. `;
    insertTextWithUndo(textarea, newLine);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    if (onUpdate) onUpdate();
    return true;
  }

  return false;
}

export function handleListShortcuts(
  e: KeyboardEvent,
  textarea: HTMLTextAreaElement,
  onUpdate?: () => void
): boolean {
  // Tab - indent
  if (e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault();
    indentLines(textarea, onUpdate);
    return true;
  }

  // Shift+Tab - outdent
  if (e.key === 'Tab' && e.shiftKey) {
    e.preventDefault();
    outdentLines(textarea, onUpdate);
    return true;
  }

  // Enter - list continuation
  if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
    if (handleListEnter(e, textarea, onUpdate)) {
      return true;
    }
  }

  return false;
}

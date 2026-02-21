/**
 * Edit Mode Utilities
 * Shared helper functions for the block editor
 */

import type { Alignment, ImageBlock, VideoBlock } from '../types/blocks';
import type { FetchJSONOptions } from '../types/api';

type NotificationType = 'info' | 'success' | 'error' | 'warning';
const EDIT_NOTIFICATION_STACK_ID = 'edit-notification-stack';

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

interface MediaStyleBlock {
  style?: string | null;
  align?: Alignment;
}

/**
 * Generate a unique ID for blocks
 */
export function generateId(): string {
  return 'block-' + Date.now() + '-' + Math.random().toString(36).substring(2, 11);
}

/**
 * Check if we're in edit mode (server-side authenticated).
 * The server sets data-edit-mode="true" on <body> when the user is
 * authenticated (either localhost or valid remote session cookie).
 */
export function isDevMode(): boolean {
  return document.body?.dataset.editMode === 'true';
}

/**
 * Check if the inline editor is currently active.
 */
export function isEditingActive(): boolean {
  return document.body?.classList.contains('editing') === true;
}

/**
 * Check if show drafts is active in the current URL
 */
export function isShowDraftsActive(): boolean {
  const storageKey = 'bb_show_drafts';
  const params = new URLSearchParams(window.location.search);
  if (params.has('show_drafts')) {
    const isActive = params.get('show_drafts') === 'true';
    if (isActive) {
      sessionStorage.setItem(storageKey, 'true');
    } else {
      sessionStorage.removeItem(storageKey);
    }
    return isActive;
  }
  return sessionStorage.getItem(storageKey) === 'true';
}

/**
 * Add show_drafts=true to a URL if currently active
 */
export function withShowDrafts(url: string): string {
  try {
    const next = new URL(url, window.location.origin);
    if (isShowDraftsActive()) {
      next.searchParams.set('show_drafts', 'true');
    }
    return next.toString();
  } catch {
    return url;
  }
}

const SCROLL_LOCK_COUNT_ATTR = 'data-scroll-lock-count';
const SCROLL_LOCK_Y_ATTR = 'data-scroll-lock-y';

/**
 * Lock page scrolling while preserving current scroll position.
 * Uses a lock count so multiple overlays can safely share the lock.
 */
export function lockBodyScroll(): void {
  const body = document.body;
  const lockCount = Number(body.getAttribute(SCROLL_LOCK_COUNT_ATTR) || '0');

  if (lockCount === 0) {
    const scrollY = window.scrollY || window.pageYOffset || 0;
    body.setAttribute(SCROLL_LOCK_Y_ATTR, String(scrollY));
    body.classList.add('modal-open');
    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    body.style.overflow = 'hidden';
  }

  body.setAttribute(SCROLL_LOCK_COUNT_ATTR, String(lockCount + 1));
}

/**
 * Release one page scroll lock. Restores scroll position when fully unlocked.
 */
export function unlockBodyScroll(): void {
  const body = document.body;
  const lockCount = Number(body.getAttribute(SCROLL_LOCK_COUNT_ATTR) || '0');

  if (lockCount <= 0) {
    body.classList.remove('modal-open');
    return;
  }

  if (lockCount > 1) {
    body.setAttribute(SCROLL_LOCK_COUNT_ATTR, String(lockCount - 1));
    return;
  }

  const scrollY = Number(body.getAttribute(SCROLL_LOCK_Y_ATTR) || '0');

  body.removeAttribute(SCROLL_LOCK_COUNT_ATTR);
  body.removeAttribute(SCROLL_LOCK_Y_ATTR);
  body.classList.remove('modal-open');
  body.style.position = '';
  body.style.top = '';
  body.style.left = '';
  body.style.right = '';
  body.style.width = '';
  body.style.overflow = '';

  // Force instant restoration even when global smooth scrolling is enabled.
  const html = document.documentElement;
  const previousInlineScrollBehavior = html.style.scrollBehavior;
  html.style.scrollBehavior = 'auto';
  window.scrollTo({ top: scrollY, left: 0, behavior: 'auto' });
  requestAnimationFrame(() => {
    if (previousInlineScrollBehavior) {
      html.style.scrollBehavior = previousInlineScrollBehavior;
    } else {
      html.style.removeProperty('scroll-behavior');
    }
  });
}

/**
 * Setup auto-resizing textarea
 * @returns The autoResize function for manual triggering
 */
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

  // Initial resize after DOM settles
  setTimeout(autoResize, 0);

  return autoResize;
}

/**
 * Create image element with standard attributes
 */
export function createImageElement(
  block: ImageBlock,
  onClick?: (element: HTMLImageElement, block: ImageBlock) => void
): HTMLImageElement {
  const img = document.createElement('img');
  img.src = block.src;
  img.alt = block.alt || '';
  if (block.style) img.setAttribute('style', block.style);
  if (block.align) applyAlignment(img, block.align);
  if (onClick) {
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick(img, block);
    });
  }
  return img;
}

/**
 * Create video element (for content videos - MP4)
 */
export function createVideoElement(
  block: VideoBlock,
  onClick?: (element: HTMLVideoElement, block: VideoBlock) => void
): HTMLVideoElement {
  const video = document.createElement('video');
  video.src = block.src;
  video.className = 'content-video';
  applyVideoPlaybackSettings(video, !!block.autoplay);
  if (block.style) video.setAttribute('style', block.style);
  if (block.align) applyAlignment(video, block.align);

  if (onClick) {
    video.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick(video, block);
    });
  }
  return video;
}

/**
 * Apply standard playback behavior for content videos.
 */
export function applyVideoPlaybackSettings(video: HTMLVideoElement, autoplay: boolean): void {
  const editing = isEditingActive();

  video.loop = autoplay;
  video.muted = autoplay;
  video.defaultMuted = autoplay;
  video.playsInline = editing || autoplay;
  video.controls = editing || !autoplay;
  video.autoplay = !editing && autoplay;

  if (video.autoplay) {
    video.setAttribute('autoplay', '');
  } else {
    video.removeAttribute('autoplay');
  }

  if (autoplay) {
    video.setAttribute('muted', '');
  } else {
    video.removeAttribute('muted');
  }

  if (video.playsInline) {
    video.setAttribute('playsinline', '');
  } else {
    video.removeAttribute('playsinline');
  }

  if (editing) {
    video.pause();
  }
}

/**
 * Apply alignment CSS to element
 */
export function applyAlignment(element: HTMLElement, align: Alignment): void {
  element.style.display = 'block';
  element.style.marginLeft = '';
  element.style.marginRight = '';

  if (align === 'center') {
    element.style.marginLeft = 'auto';
    element.style.marginRight = 'auto';
  } else if (align === 'right') {
    element.style.marginLeft = 'auto';
  }
}

/**
 * Get CSS style string for alignment
 */
export function getAlignmentStyle(align: Alignment): string {
  switch (align) {
    case 'center': return 'margin-left: auto; margin-right: auto';
    case 'right': return 'margin-left: auto';
    default: return '';
  }
}

/**
 * Parse alignment from inline style string
 */
export function parseAlignmentFromStyle(style: string | null | undefined): Alignment {
  if (!style) return 'left';
  const hasMarginLeft = style.includes('margin-left: auto') || style.includes('margin-left:auto');
  const hasMarginRight = style.includes('margin-right: auto') || style.includes('margin-right:auto');

  if (hasMarginLeft && hasMarginRight) return 'center';
  if (hasMarginLeft) return 'right';
  return 'left';
}

/**
 * Build media style string (for images/videos with size and alignment)
 * Strips existing alignment margins and rebuilds with new alignment
 */
export function buildMediaStyleString(block: MediaStyleBlock): string {
  const styleParts: string[] = ['display: block'];

  if (block.style) {
    const sizeStyle = block.style
      .replace(/margin-left:\s*auto;?\s*/g, '')
      .replace(/margin-right:\s*auto;?\s*/g, '')
      .replace(/display:\s*block;?\s*/g, '')
      .trim();
    if (sizeStyle) styleParts.push(sizeStyle);
  }

  const alignStyle = getAlignmentStyle(block.align ?? 'left');
  if (alignStyle) styleParts.push(alignStyle);

  return styleParts.join('; ');
}

/**
 * Insert text at cursor position with native undo support
 * Uses execCommand for undo stack, falls back to setRangeText
 */
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

/**
 * Wrap selected text in textarea with before/after strings
 */
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

/**
 * Find format markers around or containing the selection
 */
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

/**
 * Toggle formatting on selection - wraps if not formatted, unwraps if formatted
 */
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

/**
 * Handle formatting keyboard shortcuts (Cmd/Ctrl + B/I/U/K)
 * @returns True if shortcut was handled
 */
export function handleFormattingShortcuts(
  e: KeyboardEvent,
  textarea: HTMLTextAreaElement,
  onUpdate?: () => void
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
      insertLink(textarea, onUpdate);
      return true;
  }
  return false;
}

/**
 * Find markdown link at cursor position
 */
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

/**
 * Insert or edit markdown link at cursor
 * If cursor is inside existing link, edits the URL
 */
export async function insertLink(
  textarea: HTMLTextAreaElement,
  onUpdate?: () => void
): Promise<void> {
  const existingLink = findLinkAtCursor(textarea);

  if (existingLink) {
    const newUrl = prompt('Edit link URL (leave empty to remove link):', existingLink.url);
    if (newUrl === null) return; // Cancelled

    if (newUrl === '') {
      // Empty URL = remove link, keep text
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(existingLink.start, existingLink.end);
      insertTextWithUndo(textarea, existingLink.text);
    } else {
      // Update URL
      const newLink = `[${existingLink.text}](${newUrl})`;
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(existingLink.start, existingLink.end);
      insertTextWithUndo(textarea, newLink);
    }
  } else {
    // Create new link
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = textarea.value.substring(start, end) || 'link text';

    const url = prompt('Enter link URL:');
    if (!url) return;

    const linkText = `[${selectedText}](${url})`;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(start, end);
    insertTextWithUndo(textarea, linkText);
  }

  if (onUpdate) onUpdate();
}

/**
 * Get CSS style string for text alignment
 */
export function getTextAlignmentStyle(align: Alignment | undefined): string {
  if (!align || align === 'left') return '';
  return `text-align: ${align}`;
}

/**
 * Parse text alignment from inline style string
 */
export function parseTextAlignmentFromStyle(style: string | null | undefined): Alignment {
  if (!style) return 'left';
  const match = style.match(/text-align:\s*(left|center|right)/);
  return (match?.[1] as Alignment) ?? 'left';
}

/**
 * Indent selected lines or current line by 3 spaces
 */
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

/**
 * Outdent selected lines or current line by up to 4 spaces
 */
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

/**
 * Handle Enter key in list context - continue or end list
 * @returns True if handled as list operation
 */
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

/**
 * Handle list-related keyboard shortcuts (Enter, Tab, Shift+Tab)
 * @returns True if shortcut was handled
 */
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

/**
 * Show notification toast
 */
export function showNotification(
  message: string,
  type: NotificationType = 'info',
  duration: number = 3000
): void {
  let notificationStack = document.getElementById(EDIT_NOTIFICATION_STACK_ID);
  if (!notificationStack) {
    notificationStack = document.createElement('div');
    notificationStack.id = EDIT_NOTIFICATION_STACK_ID;
    notificationStack.className = 'edit-notification-stack';
    document.body.appendChild(notificationStack);
  }

  const notification = document.createElement('div');
  notification.className = `edit-notification edit-notification-${type}`;
  notification.textContent = message;
  notificationStack.appendChild(notification);

  requestAnimationFrame(() => {
    notification.classList.add('show');
  });

  setTimeout(() => {
    notification.classList.remove('show');
    setTimeout(() => {
      notification.remove();
      if (notificationStack && notificationStack.childElementCount === 0) {
        notificationStack.remove();
      }
    }, 300);
  }, duration);
}

/**
 * Deep clone an object
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Check if element is empty or contains only whitespace/br
 */
export function isElementEmpty(element: HTMLElement): boolean {
  const text = element.textContent?.trim() ?? '';
  const html = element.innerHTML.trim();
  return text === '' || html === '' || html === '<br>';
}

/**
 * Move caret to end of element
 */
export function moveCaretToEnd(element: HTMLElement): void {
  const range = document.createRange();
  const selection = window.getSelection();
  if (!selection) return;

  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Fetch with error handling
 */
export async function fetchJSON<T>(url: string, options: FetchJSONOptions = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    // Try to extract error detail from response
    let detail = '';
    try {
      const errorData = await response.json();
      detail = errorData.detail || '';
    } catch {
      // Ignore JSON parse errors
    }
    throw new Error(detail || `HTTP error! status: ${response.status}`);
  }

  return await response.json() as T;
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: Parameters<T>) => ReturnType<T>>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Create the EditUtils object for backwards compatibility with window.EditUtils
export const EditUtils = {
  generateId,
  isDevMode,
  isShowDraftsActive,
  withShowDrafts,
  setupAutoResizeTextarea,
  createImageElement,
  createVideoElement,
  applyVideoPlaybackSettings,
  applyAlignment,
  getAlignmentStyle,
  parseAlignmentFromStyle,
  buildMediaStyleString,
  insertTextWithUndo,
  wrapSelection,
  toggleFormat,
  handleFormattingShortcuts,
  findLinkAtCursor,
  insertLink,
  getTextAlignmentStyle,
  parseTextAlignmentFromStyle,
  handleListShortcuts,
  showNotification,
  deepClone,
  isElementEmpty,
  moveCaretToEnd,
  fetchJSON,
  debounce,
};

// Export for window global
export default EditUtils;

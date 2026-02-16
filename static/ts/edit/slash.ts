/**
 * Edit Slash Command Module
 * Handles slash command menu for inserting blocks
 */

import type { BlockType } from '../types/blocks';

// ========== TYPES ==========

interface SlashCommand {
  id: BlockType;
  label: string;
  icon: string;
  description: string;
}

interface ExecuteData {
  commandId: BlockType;
  insertIndex: number;
  replaceBlockIndex: number | null;
}

interface UpdateContentData {
  index: number;
  content: string;
}

type SlashCommandCallback = (
  action: 'execute' | 'updateContent',
  data: ExecuteData | UpdateContentData
) => void;

// ========== CONFIGURATION ==========

const CONFIG = {
  MENU_WIDTH: 240
};

const COMMANDS: SlashCommand[] = [
  { id: 'text', label: 'Text', icon: 'T', description: 'Plain text paragraph' },
  { id: 'image', label: 'Image', icon: '\uD83D\uDDBC', description: 'Upload or select an image' },
  { id: 'video', label: 'Video', icon: '\uD83C\uDFAC', description: 'Upload a video file' },
  { id: 'code', label: 'Code', icon: '\uD83D\uDCBB', description: 'Code block with syntax highlighting' },
  { id: 'html', label: 'HTML', icon: '<>', description: 'Raw HTML (scripts, embeds, custom)' },
  { id: 'callout', label: 'Callout', icon: '\uD83D\uDCCC', description: 'Highlighted message box' },
  { id: 'divider', label: 'Divider', icon: '\u2042', description: 'Section break' }
];

// ========== STATE ==========

let menuElement: HTMLDivElement | null = null;
let isActiveState = false;
let triggeredFromTextarea = false;
let query = '';
let selectedIndex = 0;
let onExecuteCallback: SlashCommandCallback | null = null;
let activeTextareaIndex: number | null = null;
let anchorElement: HTMLElement | null = null;
let scrollHandler: (() => void) | null = null;
let clickOutsideHandler: ((e: MouseEvent) => void) | null = null;

// ========== MENU CREATION ==========

/**
 * Create the slash command menu element if it doesn't exist
 */
function createMenu(): HTMLDivElement {
  if (menuElement) return menuElement;

  const menu = document.createElement('div');
  menu.className = 'slash-command-menu';
  menu.style.display = 'none';
  document.body.appendChild(menu);
  menuElement = menu;
  return menu;
}

/**
 * Position menu relative to an anchor element
 * Handles viewport overflow by positioning above if needed
 */
function positionMenu(anchorRect: DOMRect): void {
  if (!menuElement) return;

  menuElement.style.display = 'block';
  menuElement.style.width = `${CONFIG.MENU_WIDTH}px`;
  menuElement.style.left = `${Math.min(anchorRect.left, window.innerWidth - CONFIG.MENU_WIDTH - 20)}px`;

  const menuHeight = menuElement.offsetHeight || 200;
  const spaceBelow = window.innerHeight - anchorRect.bottom - 10;
  const spaceAbove = anchorRect.top - 10;

  if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
    menuElement.style.top = 'auto';
    menuElement.style.bottom = `${window.innerHeight - anchorRect.top + 5}px`;
    menuElement.style.maxHeight = `${Math.min(300, spaceAbove)}px`;
  } else {
    menuElement.style.top = `${anchorRect.bottom + 5}px`;
    menuElement.style.bottom = 'auto';
    menuElement.style.maxHeight = `${Math.min(300, spaceBelow)}px`;
  }
}

// ========== FILTERING ==========

/**
 * Filter commands based on query string
 */
function getFilteredCommands(queryStr: string): SlashCommand[] {
  if (!queryStr) return COMMANDS;
  const lowerQuery = queryStr.toLowerCase();
  return COMMANDS.filter(cmd =>
    cmd.label.toLowerCase().includes(lowerQuery) ||
    cmd.id.toLowerCase().includes(lowerQuery) ||
    cmd.description.toLowerCase().includes(lowerQuery)
  );
}

// ========== RENDERING ==========

/**
 * Render the menu with filtered commands
 */
function renderMenu(commands: SlashCommand[], selected: number = 0): void {
  if (!menuElement) createMenu();
  if (!menuElement) return;

  selectedIndex = Math.max(0, Math.min(selected, commands.length - 1));

  menuElement.innerHTML = commands.map((cmd, index) => {
    const isSelected = index === selectedIndex;
    return `
      <button
        class="slash-menu-item ${isSelected ? 'selected' : ''}"
        data-command="${cmd.id}"
      >
        <span class="slash-menu-icon">${cmd.icon}</span>
        <div class="slash-menu-content">
          <span class="slash-menu-label">${cmd.label}</span>
          <span class="slash-menu-description">${cmd.description}</span>
        </div>
      </button>
    `;
  }).join('');

  // Add click handlers
  menuElement.querySelectorAll('.slash-menu-item').forEach((item, index) => {
    item.addEventListener('click', () => {
      const cmd = commands[index];
      if (cmd) {
        executeCommand(cmd.id);
      }
    });
  });
}

/**
 * Scroll selected item into view
 */
function scrollSelectedIntoView(): void {
  if (!menuElement) return;
  const selected = menuElement.querySelector('.slash-menu-item.selected');
  if (selected) {
    selected.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

// ========== SHOW/HIDE ==========

/**
 * Attach scroll and click-outside listeners while menu is open
 */
function attachListeners(): void {
  detachListeners();

  // Reposition on scroll (use capture to catch scroll on any element)
  scrollHandler = () => {
    if (!isActiveState || !anchorElement) return;
    positionMenu(anchorElement.getBoundingClientRect());
  };
  window.addEventListener('scroll', scrollHandler, true);

  // Close on click outside
  clickOutsideHandler = (e: MouseEvent) => {
    if (!isActiveState || !menuElement) return;
    if (menuElement.contains(e.target as Node)) return;
    // Don't close if clicking the anchor itself (it toggles)
    if (anchorElement?.contains(e.target as Node)) return;
    hide();
  };
  // Delay attachment so the opening click doesn't immediately close it
  requestAnimationFrame(() => {
    if (clickOutsideHandler) {
      document.addEventListener('mousedown', clickOutsideHandler, true);
    }
  });
}

/**
 * Detach scroll and click-outside listeners
 */
function detachListeners(): void {
  if (scrollHandler) {
    window.removeEventListener('scroll', scrollHandler, true);
    scrollHandler = null;
  }
  if (clickOutsideHandler) {
    document.removeEventListener('mousedown', clickOutsideHandler, true);
    clickOutsideHandler = null;
  }
}

/**
 * Show the slash command menu triggered by typing "/" in textarea
 */
export function showFromTextarea(textarea: HTMLTextAreaElement, textareaIndex: number): void {
  if (!menuElement) createMenu();

  isActiveState = true;
  triggeredFromTextarea = true;
  query = '';
  selectedIndex = 0;
  activeTextareaIndex = textareaIndex;
  anchorElement = textarea;

  renderMenu(COMMANDS, 0);
  positionMenu(textarea.getBoundingClientRect());
  attachListeners();
}

/**
 * Show the slash command menu from "+" button
 */
export function showFromButton(anchorRect: DOMRect, insertIndex: number, buttonEl?: HTMLElement): void {
  if (!menuElement) createMenu();

  isActiveState = true;
  triggeredFromTextarea = false;
  query = '';
  selectedIndex = 0;
  activeTextareaIndex = insertIndex;
  anchorElement = buttonEl ?? null;

  renderMenu(COMMANDS, 0);
  positionMenu(anchorRect);
  attachListeners();
}

/**
 * Hide the slash command menu
 */
export function hide(): void {
  detachListeners();
  if (menuElement) {
    menuElement.style.display = 'none';
  }
  isActiveState = false;
  triggeredFromTextarea = false;
  query = '';
  selectedIndex = 0;
  anchorElement = null;
}

// ========== COMMAND EXECUTION ==========

/**
 * Execute a slash command
 */
function executeCommand(commandId: BlockType): void {
  const sourceIndex = activeTextareaIndex ?? 0;
  const wasFromTextarea = triggeredFromTextarea;
  let blockBecameEmpty = false;

  // Clean up "/" from textarea if triggered from typing
  if (triggeredFromTextarea && activeTextareaIndex !== null) {
    const textarea = (anchorElement && anchorElement.tagName === 'TEXTAREA')
      ? anchorElement as HTMLTextAreaElement
      : document.querySelector<HTMLTextAreaElement>(
          `.block-wrapper[data-block-index="${activeTextareaIndex}"] .block-textarea`
        );

    if (textarea) {
      const cursorPos = textarea.selectionStart;
      const text = textarea.value;

      // Find the "/" that triggered the slash command (must be at start of line)
      const textBeforeCursor = text.substring(0, cursorPos);
      const lastNewline = textBeforeCursor.lastIndexOf('\n');
      const lineStart = lastNewline + 1;

      // Only remove if "/" is at the start of the current line
      // This prevents accidentally removing "/" from URLs
      if (text[lineStart] === '/') {
        const slashIndex = lineStart;
        const newText = (text.substring(0, slashIndex) + text.substring(cursorPos)).replace(/\n+$/, '');
        textarea.value = newText;

        const isLineInput = textarea.classList.contains('text-line-input');
        if (isLineInput) {
          const blockWrapper = textarea.closest('.block-wrapper');
          if (blockWrapper) {
            const lineInputs = blockWrapper.querySelectorAll<HTMLInputElement>('.text-line-input');
            blockBecameEmpty = Array.from(lineInputs).every(input => !input.value.trim());
          } else {
            blockBecameEmpty = !newText.trim();
          }

          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          blockBecameEmpty = !newText.trim();
          // Notify callback to update block content
          if (onExecuteCallback) {
            onExecuteCallback('updateContent', {
              index: activeTextareaIndex,
              content: newText
            });
          }
        }
      }
    }
  }

  hide();

  // Execute the command via callback
  if (onExecuteCallback) {
    if (wasFromTextarea) {
      // If the source block is now empty, replace it with the new block.
      // Otherwise insert the new block after it.
      onExecuteCallback('execute', {
        commandId,
        insertIndex: blockBecameEmpty ? sourceIndex : sourceIndex + 1,
        replaceBlockIndex: blockBecameEmpty ? sourceIndex : null
      });
    } else {
      onExecuteCallback('execute', {
        commandId,
        insertIndex: sourceIndex,
        replaceBlockIndex: null
      });
    }
  }
}

// ========== KEYBOARD HANDLING ==========

/**
 * Handle keydown events when menu is active
 * @returns True if event was handled
 */
export function handleKeydown(e: KeyboardEvent): boolean {
  if (!isActiveState) return false;

  const filteredCommands = getFilteredCommands(query);

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      e.stopPropagation();
      selectedIndex = (selectedIndex + 1) % filteredCommands.length;
      renderMenu(filteredCommands, selectedIndex);
      scrollSelectedIntoView();
      return true;

    case 'ArrowUp':
      e.preventDefault();
      e.stopPropagation();
      selectedIndex = (selectedIndex - 1 + filteredCommands.length) % filteredCommands.length;
      renderMenu(filteredCommands, selectedIndex);
      scrollSelectedIntoView();
      return true;

    case 'Enter':
    case 'Tab':
      e.preventDefault();
      e.stopPropagation();
      if (filteredCommands.length > 0) {
        const cmd = filteredCommands[selectedIndex];
        if (cmd) {
          executeCommand(cmd.id);
        }
      }
      return true;

    case 'Escape':
      e.preventDefault();
      e.stopPropagation();
      hide();
      return true;
  }
  return false;
}

/**
 * Handle textarea input to detect "/" and filter commands
 */
export function handleTextareaInput(textarea: HTMLTextAreaElement, textareaIndex: number): void {
  const cursorPos = textarea.selectionStart;
  const text = textarea.value;
  const textBeforeCursor = text.substring(0, cursorPos);

  // Check if "/" was typed at start of line
  const lastNewline = textBeforeCursor.lastIndexOf('\n');
  const lineStart = lastNewline + 1;
  const lineBeforeCursor = textBeforeCursor.substring(lineStart);

  if (lineBeforeCursor === '/') {
    showFromTextarea(textarea, textareaIndex);
    return;
  }

  // If slash command is active, update query
  if (isActiveState) {
    const slashIndex = textBeforeCursor.lastIndexOf('/');
    if (slashIndex !== -1) {
      const beforeSlash = textBeforeCursor.substring(0, slashIndex);
      const isAtLineStart = beforeSlash === '' || beforeSlash.endsWith('\n');
      if (isAtLineStart) {
        query = textBeforeCursor.substring(slashIndex + 1);
        const filteredCommands = getFilteredCommands(query);
        if (filteredCommands.length === 0) {
          hide();
        } else {
          renderMenu(filteredCommands, 0);
        }
      } else {
        hide();
      }
    } else {
      hide();
    }
  }
}

// ========== INITIALIZATION ==========

/**
 * Initialize the slash command system
 */
export function init(callback: SlashCommandCallback): void {
  onExecuteCallback = callback;
  createMenu();
}

/**
 * Cleanup and destroy the menu
 */
export function cleanup(): void {
  detachListeners();
  if (menuElement) {
    menuElement.remove();
    menuElement = null;
  }
  isActiveState = false;
  anchorElement = null;
  onExecuteCallback = null;
}

// ========== PUBLIC API ==========

/**
 * Check if menu is active
 */
export function isActive(): boolean {
  return isActiveState;
}

/**
 * Check if menu is visible (alias for isActive)
 */
export function isVisible(): boolean {
  return isActiveState;
}

/**
 * Get the active textarea index
 */
export function getActiveIndex(): number | null {
  return activeTextareaIndex;
}

// Export object for window.EditSlash compatibility
const EditSlash = {
  // Initialization
  init,
  cleanup,

  // Show/Hide
  showFromTextarea,
  showFromButton,
  hide,

  // Event handlers
  handleKeydown,
  handleTextareaInput,

  // State accessors
  isActive,
  isVisible,
  getActiveIndex,

  // Config
  COMMANDS
};

export default EditSlash;

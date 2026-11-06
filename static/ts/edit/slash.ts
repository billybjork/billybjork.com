import type { BlockType } from '../types/blocks';
import { ICONS } from './icons';
import { clamp } from './clamp';

interface SlashCommand {
  id: BlockType;
  label: string;
  icon: string;
  description: string;
}

export interface SlashSelection {
  commandId: BlockType;
  insertIndex: number;
  /** Set when the source block was emptied by removing the typed command: the new block takes its place. */
  replaceBlockIndex: number | null;
}

type MenuTrigger =
  | { kind: 'textarea'; textarea: HTMLTextAreaElement; blockIndex: number; commit: () => void }
  | { kind: 'button'; anchor: HTMLElement; insertIndex: number };

export interface SlashMenu {
  showFromButton(button: HTMLElement, insertIndex: number): void;
  handleTextareaInput(textarea: HTMLTextAreaElement, blockIndex: number, commit: () => void): void;
  handleKeydown(event: KeyboardEvent): boolean;
}

const MENU_WIDTH_PX = 240;
const MOBILE_BREAKPOINT_PX = 768;

const COMMANDS: SlashCommand[] = [
  { id: 'text', label: 'Text', icon: ICONS.text, description: 'Plain text paragraph' },
  { id: 'image', label: 'Image', icon: ICONS.image, description: 'Upload or select an image' },
  { id: 'video', label: 'Video', icon: ICONS.video, description: 'Upload a video file' },
  { id: 'code', label: 'Code', icon: ICONS.code, description: 'Code block with syntax highlighting' },
  { id: 'html', label: 'HTML', icon: ICONS.html, description: 'Raw HTML (scripts, embeds, custom)' },
  { id: 'callout', label: 'Callout', icon: ICONS.callout, description: 'Highlighted message box' },
  { id: 'divider', label: 'Divider', icon: ICONS.dividerCommand, description: 'Section break' },
];

function matchingCommands(query: string): SlashCommand[] {
  if (!query) return COMMANDS;
  const lower = query.toLowerCase();
  return COMMANDS.filter((command) => (
    command.label.toLowerCase().includes(lower)
    || command.id.includes(lower)
    || command.description.toLowerCase().includes(lower)
  ));
}

function positionMenu(menu: HTMLElement, anchorRect: DOMRect): void {
  menu.style.display = 'block';

  if (window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`).matches) {
    Object.assign(menu.style, { width: 'auto', left: '10px', right: '10px', top: 'auto', bottom: '10px', maxHeight: '50vh' });
    return;
  }

  menu.style.width = `${MENU_WIDTH_PX}px`;
  menu.style.left = `${Math.min(anchorRect.left, window.innerWidth - MENU_WIDTH_PX - 20)}px`;
  menu.style.right = 'auto';

  const menuHeight = menu.offsetHeight || 200;
  const spaceBelow = window.innerHeight - anchorRect.bottom - 10;
  const spaceAbove = anchorRect.top - 10;

  if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
    menu.style.top = 'auto';
    menu.style.bottom = `${window.innerHeight - anchorRect.top + 5}px`;
    menu.style.maxHeight = `${Math.min(300, spaceAbove)}px`;
  } else {
    menu.style.top = `${anchorRect.bottom + 5}px`;
    menu.style.bottom = 'auto';
    menu.style.maxHeight = `${Math.min(300, spaceBelow)}px`;
  }
}

export function createSlashMenu(onSelect: (selection: SlashSelection) => void, signal: AbortSignal): SlashMenu {
  const menu = document.createElement('div');
  menu.className = 'slash-command-menu';
  menu.style.display = 'none';
  document.body.appendChild(menu);

  let trigger: MenuTrigger | null = null;
  let query = '';
  let selectedIndex = 0;
  let openListeners: AbortController | null = null;

  const anchorOf = (current: MenuTrigger): HTMLElement => (
    current.kind === 'textarea' ? current.textarea : current.anchor
  );

  const render = (commands: SlashCommand[], selected = 0): void => {
    selectedIndex = clamp(selected, 0, commands.length - 1);
    menu.innerHTML = commands.map((command, index) => `
      <button class="slash-menu-item ${index === selectedIndex ? 'selected' : ''}" data-command="${command.id}">
        <span class="slash-menu-icon">${command.icon}</span>
        <div class="slash-menu-content">
          <span class="slash-menu-label">${command.label}</span>
          <span class="slash-menu-description">${command.description}</span>
        </div>
      </button>
    `).join('');

    menu.querySelectorAll('.slash-menu-item').forEach((item, index) => {
      item.addEventListener('click', () => {
        const command = commands[index];
        if (command) execute(command.id);
      });
    });
  };

  const hide = (): void => {
    openListeners?.abort();
    openListeners = null;
    menu.style.display = 'none';
    trigger = null;
    query = '';
    selectedIndex = 0;
  };

  const open = (next: MenuTrigger): void => {
    trigger = next;
    query = '';
    render(COMMANDS);
    const anchor = anchorOf(next);
    positionMenu(menu, anchor.getBoundingClientRect());

    openListeners?.abort();
    openListeners = new AbortController();
    const listeners = openListeners.signal;
    window.addEventListener('scroll', () => positionMenu(menu, anchor.getBoundingClientRect()), { capture: true, signal: listeners });
    // Attached a frame later so the click that opened the menu cannot close it.
    requestAnimationFrame(() => {
      if (listeners.aborted) return;
      document.addEventListener('mousedown', (event) => {
        const target = event.target as Node;
        if (!menu.contains(target) && !anchor.contains(target)) hide();
      }, { capture: true, signal: listeners });
    });
  };

  const removeTypedCommand = ({ textarea, commit }: Extract<MenuTrigger, { kind: 'textarea' }>): boolean => {
    const cursor = textarea.selectionStart;
    const text = textarea.value;
    const lineStart = text.lastIndexOf('\n', cursor - 1) + 1;
    if (text[lineStart] !== '/') return false;

    textarea.value = (text.slice(0, lineStart) + text.slice(cursor)).replace(/\n+$/, '');
    const blockIsEmpty = Array.from(textarea.closest('.block-wrapper')?.querySelectorAll<HTMLTextAreaElement>('.text-line-input') ?? [])
      .every((input) => !input.value.trim());
    commit();
    return blockIsEmpty;
  };

  const execute = (commandId: BlockType): void => {
    const current = trigger;
    if (!current) return;

    let selection: SlashSelection;
    if (current.kind === 'textarea') {
      const blockIsEmpty = removeTypedCommand(current);
      selection = {
        commandId,
        insertIndex: blockIsEmpty ? current.blockIndex : current.blockIndex + 1,
        replaceBlockIndex: blockIsEmpty ? current.blockIndex : null,
      };
    } else {
      selection = { commandId, insertIndex: current.insertIndex, replaceBlockIndex: null };
    }

    hide();
    onSelect(selection);
  };

  signal.addEventListener('abort', hide);

  return {
    showFromButton(button, insertIndex) {
      open({ kind: 'button', anchor: button, insertIndex });
    },

    handleTextareaInput(textarea, blockIndex, commit) {
      const beforeCursor = textarea.value.slice(0, textarea.selectionStart);
      const lineStart = beforeCursor.lastIndexOf('\n') + 1;

      if (beforeCursor.slice(lineStart) === '/') {
        open({ kind: 'textarea', textarea, blockIndex, commit });
        return;
      }
      if (!trigger) return;

      const slashIndex = beforeCursor.lastIndexOf('/');
      const atLineStart = slashIndex !== -1 && (slashIndex === 0 || beforeCursor[slashIndex - 1] === '\n');
      query = atLineStart ? beforeCursor.slice(slashIndex + 1) : '';
      const commands = atLineStart ? matchingCommands(query) : [];
      if (commands.length === 0) {
        hide();
      } else {
        render(commands);
      }
    },

    handleKeydown(event) {
      if (!trigger) return false;

      const commands = matchingCommands(query);
      const consume = (): void => {
        event.preventDefault();
        event.stopPropagation();
      };
      const moveSelection = (delta: number): void => {
        consume();
        render(commands, (selectedIndex + delta + commands.length) % commands.length);
        menu.querySelector('.slash-menu-item.selected')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      };

      switch (event.key) {
        case 'ArrowDown':
          moveSelection(1);
          return true;
        case 'ArrowUp':
          moveSelection(-1);
          return true;
        case 'Enter':
        case 'Tab': {
          consume();
          const command = commands[selectedIndex];
          if (command) execute(command.id);
          return true;
        }
        case 'Escape':
          consume();
          hide();
          return true;
      }
      return false;
    },
  };
}

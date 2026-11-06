import type { Block } from '../types/blocks';
import { rerenderBlockInPlace, renderBlocks } from './block-shell';
import type { EditorContext } from './context';
import { showNotification } from './notify';
import { clamp } from './text';
import { activateLine } from './line-editor';

const MAX_HISTORY = 50;
const RECORD_DEBOUNCE_MS = 500;
const NATIVE_HISTORY_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password']);

interface FocusSnapshot {
  blockIndex: number;
  lineIndex: number | null;
  inputClass: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface History {
  /** Notes that the document changed; rapid changes collapse into one step. */
  record(): void;
  undo(): void;
  redo(): void;
}

function structureSignature(blocks: Block[]): string {
  return blocks.map((block) => (
    block.type === 'row'
      ? `row:${block.id}:${block.left.type}:${block.left.id}:${block.right.type}:${block.right.id}`
      : `${block.type}:${block.id}`
  )).join('|');
}

function captureFocus(): FocusSnapshot | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement)) return null;

  const blockIndex = Number.parseInt(active.closest<HTMLElement>('.block-wrapper')?.dataset.blockIndex ?? '', 10);
  if (Number.isNaN(blockIndex)) return null;

  const lineIndex = Number.parseInt(active.closest<HTMLElement>('.text-block-line')?.dataset.lineIndex ?? '', 10);
  return {
    blockIndex,
    lineIndex: Number.isNaN(lineIndex) ? null : lineIndex,
    inputClass: active.className,
    selectionStart: active.selectionStart ?? 0,
    selectionEnd: active.selectionEnd ?? 0,
  };
}

function findFocusInput(wrapper: HTMLElement, snapshot: FocusSnapshot): HTMLTextAreaElement | HTMLInputElement | null {
  if (snapshot.lineIndex !== null) {
    const row = wrapper.querySelector<HTMLElement>(`.text-block-line[data-line-index="${snapshot.lineIndex}"]`);
    if (row && !row.classList.contains('is-editing')) activateLine(row);
    const input = row?.querySelector<HTMLTextAreaElement>('.text-line-input');
    if (input) return input;
  }

  const classes = snapshot.inputClass.split(/\s+/).filter(Boolean);
  const sameClass = classes.length
    ? wrapper.querySelector<HTMLTextAreaElement | HTMLInputElement>(`.${classes.join('.')}`)
    : null;
  return sameClass ?? wrapper.querySelector('textarea, input[type="text"], input[type="url"]');
}

function restoreFocus(blocksRoot: HTMLElement, snapshot: FocusSnapshot | null): void {
  if (!snapshot) return;
  const wrapper = blocksRoot.querySelector<HTMLElement>(`.block-wrapper[data-block-index="${snapshot.blockIndex}"]`);
  const input = wrapper && findFocusInput(wrapper, snapshot);
  if (!input) return;

  input.focus({ preventScroll: true });
  input.selectionStart = clamp(snapshot.selectionStart, 0, input.value.length);
  input.selectionEnd = clamp(snapshot.selectionEnd, 0, input.value.length);
}

/** While a text field is focused, its own undo stack comes first. */
function tryNativeHistory(command: 'undo' | 'redo'): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement)) return false;
  if (active.disabled || active.readOnly) return false;
  if (active instanceof HTMLInputElement && !NATIVE_HISTORY_INPUT_TYPES.has(active.type)) return false;
  return document.execCommand(command);
}

/** Puts a past document on screen, rebuilding only what changed so scroll and focus survive. */
function showDocument(ctx: EditorContext, next: Block[]): void {
  const previous = ctx.store.blocks;
  const focus = captureFocus();
  ctx.media.deselect();
  ctx.store.restore(next);

  const inPlace = structureSignature(previous) === structureSignature(next)
    && next.every((block, index) => (
      JSON.stringify(previous[index]) === JSON.stringify(block) || rerenderBlockInPlace(ctx, block, index)
    ));

  if (inPlace) {
    ctx.inlineToolbar.setTarget(null);
  } else {
    renderBlocks(ctx);
  }
  restoreFocus(ctx.blocksRoot, focus);
}

export function createHistory(ctx: EditorContext, onRestored: () => void): History {
  let states: Block[][] = [structuredClone(ctx.store.blocks)];
  let currentIndex = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const commit = (): void => {
    const state = structuredClone(ctx.store.blocks);
    states = states.slice(0, currentIndex + 1);

    if (JSON.stringify(states[states.length - 1]) !== JSON.stringify(state)) {
      states.push(state);
      if (states.length > MAX_HISTORY) states.shift();
    }
    currentIndex = states.length - 1;
  };

  const flush = (): void => {
    if (debounceTimer === null) return;
    clearTimeout(debounceTimer);
    debounceTimer = null;
    commit();
  };

  const step = (command: 'undo' | 'redo'): void => {
    ctx.inlineToolbar.scheduleUpdate();
    if (tryNativeHistory(command)) return;

    flush();
    const nextIndex = currentIndex + (command === 'undo' ? -1 : 1);
    const state = states[nextIndex];
    if (!state) {
      showNotification(`Nothing to ${command}`, 'info');
      return;
    }

    currentIndex = nextIndex;
    showDocument(ctx, structuredClone(state));
    onRestored();
    showNotification(command === 'undo' ? 'Undo' : 'Redo', 'info', 1000);
  };

  return {
    record() {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        commit();
      }, RECORD_DEBOUNCE_MS);
    },
    undo: () => step('undo'),
    redo: () => step('redo'),
  };
}

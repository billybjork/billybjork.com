/**
 * Edit Undo/Redo
 * Handles undo/redo history for the block editor
 */

import type { Block } from '../types/blocks';
import { deepClone, showNotification } from '../core/utils';

interface UndoState {
  blocks: Block[];
  timestamp: number;
}

interface UndoCallbacks {
  getBlocks: () => Block[];
  setBlocks: (blocks: Block[]) => void;
  renderBlocks: () => void;
  markDirty: () => void;
}

let callbacks: UndoCallbacks | null = null;

let history: UndoState[] = [];
let currentIndex = -1;
const maxHistory = 50;
let isUndoing = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 500;

/**
 * Initialize undo system with callbacks
 */
export function init(cb: UndoCallbacks): void {
  callbacks = cb;
  history = [];
  currentIndex = -1;
}

/**
 * Clear the undo system
 */
export function reset(): void {
  history = [];
  currentIndex = -1;
}

/**
 * Capture current editor state
 */
function captureState(): UndoState {
  if (!callbacks) {
    throw new Error('EditUndo not initialized');
  }
  return {
    blocks: deepClone(callbacks.getBlocks()),
    timestamp: Date.now(),
  };
}

/**
 * Actually save state (after debounce)
 */
function doSaveState(): void {
  const state = captureState();

  // If we're in the middle of history, remove future states
  if (currentIndex < history.length - 1) {
    history = history.slice(0, currentIndex + 1);
  }

  // Add new state
  history.push(state);
  currentIndex = history.length - 1;

  // Limit history size
  if (history.length > maxHistory) {
    history.shift();
    currentIndex--;
  }
}

/**
 * Save current state to history
 */
export function saveState(): void {
  if (isUndoing) return;

  // Debounce rapid changes
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    doSaveState();
  }, DEBOUNCE_MS);
}

/**
 * Restore a state
 */
function restoreState(state: UndoState | undefined): void {
  if (!state || !callbacks) return;

  isUndoing = true;
  callbacks.setBlocks(deepClone(state.blocks));
  callbacks.renderBlocks();
  callbacks.markDirty();
  isUndoing = false;
}

/**
 * Undo last action
 */
export function undo(): void {
  if (currentIndex <= 0) {
    showNotification('Nothing to undo', 'info');
    return;
  }

  // Save current state if not already saved
  if (currentIndex === history.length - 1) {
    doSaveState();
  }

  currentIndex--;
  restoreState(history[currentIndex]);
  showNotification('Undo', 'info', 1000);
}

/**
 * Redo last undone action
 */
export function redo(): void {
  if (currentIndex >= history.length - 1) {
    showNotification('Nothing to redo', 'info');
    return;
  }

  currentIndex++;
  restoreState(history[currentIndex]);
  showNotification('Redo', 'info', 1000);
}

/**
 * Clear history
 */
export function clear(): void {
  history = [];
  currentIndex = -1;
}

/**
 * Check if undo is available
 */
export function canUndo(): boolean {
  return currentIndex > 0;
}

/**
 * Check if redo is available
 */
export function canRedo(): boolean {
  return currentIndex < history.length - 1;
}

// Export object for window.EditUndo compatibility
const EditUndo = {
  // State (read-only getters)
  get history() { return history; },
  get currentIndex() { return currentIndex; },
  get maxHistory() { return maxHistory; },
  get isUndoing() { return isUndoing; },
  DEBOUNCE_MS,

  // Methods
  init,
  reset,
  saveState,
  undo,
  redo,
  clear,
  canUndo,
  canRedo,
};

export default EditUndo;

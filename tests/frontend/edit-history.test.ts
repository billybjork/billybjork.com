import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  blockWrappers,
  installHarness,
  lineInputs,
  notifications,
  openProjectEditor,
  pressKey,
  statusText,
  toolbarButton,
  typeInLine,
  type EditorHarness,
} from './edit-harness';

const HISTORY_DEBOUNCE_MS = 500;
const AUTO_SAVE_MS = 2000;

let harness: EditorHarness;

beforeEach(() => {
  vi.useFakeTimers();
  harness = installHarness();
});

afterEach(() => {
  harness.teardown();
});

async function settle(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

async function savedMarkdown(): Promise<unknown> {
  await settle(AUTO_SAVE_MS);
  return harness.lastSave().markdown;
}

describe('undo and redo', () => {
  it('restores the previous text and saves the restored document', async () => {
    await openProjectEditor(harness, 'Original');
    await settle(HISTORY_DEBOUNCE_MS);
    typeInLine('Changed');
    await settle(HISTORY_DEBOUNCE_MS);

    toolbarButton('undo').click();

    expect(lineInputs()[0]?.value).toBe('Original');
    expect(statusText()).toBe('(unsaved)');
    expect(await savedMarkdown()).toBe('Original');
  });

  it('redo reapplies what undo removed', async () => {
    await openProjectEditor(harness, 'Original');
    await settle(HISTORY_DEBOUNCE_MS);
    typeInLine('Changed');
    await settle(HISTORY_DEBOUNCE_MS);

    toolbarButton('undo').click();
    toolbarButton('redo').click();

    expect(lineInputs()[0]?.value).toBe('Changed');
    expect(await savedMarkdown()).toBe('Changed');
  });

  it('brings back a deleted block', async () => {
    await openProjectEditor(harness, 'One\n\n<!-- block -->\n\nTwo');
    await settle(HISTORY_DEBOUNCE_MS);
    blockWrappers()[0]!.querySelector<HTMLButtonElement>('.block-delete-btn')!.click();
    await settle(HISTORY_DEBOUNCE_MS);
    expect(blockWrappers()).toHaveLength(1);

    toolbarButton('undo').click();

    expect(blockWrappers()).toHaveLength(2);
    expect(lineInputs(0)[0]?.value).toBe('One');
    expect(await savedMarkdown()).toBe('One\n\n<!-- block -->\n\nTwo');
  });

  it('groups edits inside the debounce window into one step', async () => {
    await openProjectEditor(harness, 'Original');
    await settle(HISTORY_DEBOUNCE_MS);
    typeInLine('A');
    await settle(HISTORY_DEBOUNCE_MS / 2);
    typeInLine('AB');
    await settle(HISTORY_DEBOUNCE_MS);

    toolbarButton('undo').click();

    expect(lineInputs()[0]?.value).toBe('Original');
  });

  it('counts a pending edit when undoing before the debounce elapses', async () => {
    await openProjectEditor(harness, 'Original');
    await settle(HISTORY_DEBOUNCE_MS);
    typeInLine('Changed');

    toolbarButton('undo').click();

    expect(lineInputs()[0]?.value).toBe('Original');
  });

  it('a new edit after undo discards the redo branch', async () => {
    await openProjectEditor(harness, 'Original');
    await settle(HISTORY_DEBOUNCE_MS);
    typeInLine('First');
    await settle(HISTORY_DEBOUNCE_MS);
    toolbarButton('undo').click();
    typeInLine('Second');
    await settle(HISTORY_DEBOUNCE_MS);

    toolbarButton('redo').click();

    expect(lineInputs()[0]?.value).toBe('Second');
    expect(notifications()).toContain('Nothing to redo');

    toolbarButton('undo').click();
    expect(lineInputs()[0]?.value).toBe('Original');
  });

  it('says so when there is nothing to undo', async () => {
    await openProjectEditor(harness, 'Original');
    await settle(HISTORY_DEBOUNCE_MS);

    toolbarButton('undo').click();

    expect(notifications()).toContain('Nothing to undo');
    expect(harness.saves()).toHaveLength(0);
  });

  it('answers Cmd+Z, Cmd+Shift+Z, and Cmd+Y', async () => {
    await openProjectEditor(harness, 'Original');
    await settle(HISTORY_DEBOUNCE_MS);
    typeInLine('Changed');
    await settle(HISTORY_DEBOUNCE_MS);
    (document.activeElement as HTMLElement | null)?.blur();

    pressKey(document, 'z', { metaKey: true });
    expect(lineInputs()[0]?.value).toBe('Original');

    pressKey(document, 'z', { metaKey: true, shiftKey: true });
    expect(lineInputs()[0]?.value).toBe('Changed');

    pressKey(document, 'z', { ctrlKey: true });
    pressKey(document, 'y', { ctrlKey: true });
    expect(lineInputs()[0]?.value).toBe('Changed');
  });

  it('leaves the keystroke to the browser while its own undo stack has something to undo', async () => {
    await openProjectEditor(harness, 'Original');
    await settle(HISTORY_DEBOUNCE_MS);
    typeInLine('Changed');
    await settle(HISTORY_DEBOUNCE_MS);
    const execCommand = vi.fn(() => true);
    (document as unknown as { execCommand: unknown }).execCommand = execCommand;

    toolbarButton('undo').click();

    expect(execCommand).toHaveBeenCalledWith('undo');
    expect(lineInputs()[0]?.value).toBe('Changed');
  });

  it('keeps the caret in the same line after restoring', async () => {
    await openProjectEditor(harness, 'First\nSecond');
    await settle(HISTORY_DEBOUNCE_MS);
    typeInLine('Second changed', 0, 1);
    await settle(HISTORY_DEBOUNCE_MS);

    toolbarButton('undo').click();

    const lines = lineInputs();
    expect(lines[1]?.value).toBe('Second');
    expect(document.activeElement).toBe(lines[1]);
    expect(lines[1]?.closest('.text-block-line')?.classList.contains('is-editing')).toBe(true);
  });
});

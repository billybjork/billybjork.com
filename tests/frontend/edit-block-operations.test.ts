import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  blockWrappers,
  installHarness,
  lineInputs,
  openProjectEditor,
  pressKey,
  typeInLine,
  type EditorHarness,
} from './edit-harness';

const AUTO_SAVE_MS = 2000;
const THREE_BLOCKS = 'One\n\n<!-- block -->\n\nTwo\n\n<!-- block -->\n\nThree';

let harness: EditorHarness;

beforeEach(() => {
  vi.useFakeTimers();
  harness = installHarness();
});

afterEach(() => {
  harness.teardown();
});

async function savedMarkdown(): Promise<unknown> {
  await vi.advanceTimersByTimeAsync(AUTO_SAVE_MS);
  return harness.lastSave().markdown;
}

function menuItem(id: string): HTMLButtonElement {
  const item = document.querySelector<HTMLButtonElement>(`.slash-menu-item[data-command="${id}"]`);
  if (!item) throw new Error(`No menu item ${id}`);
  return item;
}

function menuIsOpen(): boolean {
  const menu = document.querySelector<HTMLElement>('.slash-command-menu');
  return !!menu && menu.style.display !== 'none';
}

function dragBlock(from: number, onto: number, placement: 'top' | 'bottom'): void {
  const handle = blockWrappers()[from]!.querySelector<HTMLElement>('.block-handle')!;
  const target = blockWrappers()[onto]!;
  target.getBoundingClientRect = () => ({ top: 100, height: 100, bottom: 200, left: 0, right: 0, width: 0, x: 0, y: 100, toJSON: () => ({}) });
  handle.dispatchEvent(new MouseEvent('dragstart', { bubbles: true }));
  target.dispatchEvent(new MouseEvent('dragover', { bubbles: true, cancelable: true, clientY: placement === 'top' ? 110 : 190 }));
  target.dispatchEvent(new MouseEvent('drop', { bubbles: true, cancelable: true }));
}

describe('adding blocks', () => {
  it('inserts where the + was, from the top, between blocks, and at the end', async () => {
    await openProjectEditor(harness, 'One\n\n<!-- block -->\n\nTwo');

    document.querySelector<HTMLButtonElement>('.add-block-wrapper-bottom .merge-add-btn')!.click();
    menuItem('divider').click();
    expect(blockWrappers().map((el) => el.dataset.blockType)).toEqual(['text', 'text', 'divider']);

    document.querySelector<HTMLButtonElement>('.add-block-wrapper-top .merge-add-btn')!.click();
    menuItem('code').click();
    expect(blockWrappers().map((el) => el.dataset.blockType)).toEqual(['code', 'text', 'text', 'divider']);

    document.querySelectorAll<HTMLButtonElement>('.merge-divider .merge-add-btn')[1]!.click();
    menuItem('callout').click();
    expect(blockWrappers().map((el) => el.dataset.blockType)).toEqual(['code', 'text', 'callout', 'text', 'divider']);

    expect(await savedMarkdown()).toBe([
      '```javascript\n\n```',
      'One',
      '<div class="callout"></div>',
      'Two',
      '---',
    ].join('\n\n<!-- block -->\n\n'));
  });

  it('puts the caret in a new text block, ready to type', async () => {
    await openProjectEditor(harness, 'One');
    document.querySelector<HTMLButtonElement>('.add-block-wrapper-bottom .merge-add-btn')!.click();
    menuItem('text').click();

    const line = blockWrappers()[1]!.querySelector('.text-block-line');
    expect(line?.classList.contains('is-editing')).toBe(true);
    expect(document.activeElement).toBe(line?.querySelector('.text-line-input'));
  });

  it('puts the caret in a new callout', async () => {
    await openProjectEditor(harness, 'One');
    document.querySelector<HTMLButtonElement>('.add-block-wrapper-bottom .merge-add-btn')!.click();
    menuItem('callout').click();

    expect(document.activeElement).toBe(blockWrappers()[1]!.querySelector('.callout-textarea'));
  });
});

describe('removing blocks', () => {
  it('deletes the block and renumbers the rest', async () => {
    await openProjectEditor(harness, THREE_BLOCKS);
    blockWrappers()[1]!.querySelector<HTMLButtonElement>('.block-delete-btn')!.click();

    expect(blockWrappers().map((el) => el.dataset.blockIndex)).toEqual(['0', '1']);
    expect(await savedMarkdown()).toBe('One\n\n<!-- block -->\n\nThree');
  });

  it('leaves one empty text block when the last block goes', async () => {
    await openProjectEditor(harness, 'Only');
    blockWrappers()[0]!.querySelector<HTMLButtonElement>('.block-delete-btn')!.click();

    expect(blockWrappers()).toHaveLength(1);
    expect(blockWrappers()[0]!.dataset.blockType).toBe('text');
    expect(await savedMarkdown()).toBe('');
  });
});

describe('reordering blocks', () => {
  it('drops above the hovered block when over its top half', async () => {
    await openProjectEditor(harness, THREE_BLOCKS);
    dragBlock(2, 0, 'top');
    expect(await savedMarkdown()).toBe('Three\n\n<!-- block -->\n\nOne\n\n<!-- block -->\n\nTwo');
  });

  it('drops below the hovered block when over its bottom half', async () => {
    await openProjectEditor(harness, THREE_BLOCKS);
    dragBlock(0, 1, 'bottom');
    expect(await savedMarkdown()).toBe('Two\n\n<!-- block -->\n\nOne\n\n<!-- block -->\n\nThree');
  });

  it('ignores a drop that lands where it started', async () => {
    await openProjectEditor(harness, THREE_BLOCKS);
    dragBlock(1, 1, 'top');
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_MS);
    expect(harness.saves()).toHaveLength(0);
  });
});

describe('rows', () => {
  it('merges two neighbours into columns, swaps them, and splits them back', async () => {
    await openProjectEditor(harness, 'Left\n\n<!-- block -->\n\nRight');

    document.querySelector<HTMLButtonElement>('.merge-columns-btn')!.click();
    expect(blockWrappers().map((el) => el.dataset.blockType)).toEqual(['row']);

    document.querySelectorAll<HTMLButtonElement>('.row-action-btn')[1]!.click();
    expect(await savedMarkdown()).toBe('<!-- row -->\nRight\n<!-- col -->\nLeft\n<!-- /row -->');

    document.querySelector<HTMLButtonElement>('.row-action-btn-split')!.click();
    expect(await savedMarkdown()).toBe('Right\n\n<!-- block -->\n\nLeft');
  });

  it('offers no merge next to an existing row', async () => {
    await openProjectEditor(harness, '<!-- row -->\nA\n<!-- col -->\nB\n<!-- /row -->\n\n<!-- block -->\n\nC');
    expect(document.querySelector('.merge-columns-btn')).toBeNull();
  });

  it('edits a column without touching the other', async () => {
    await openProjectEditor(harness, '<!-- row -->\nA\n<!-- col -->\nB\n<!-- /row -->');
    const rightLine = document.querySelector<HTMLElement>('.row-column-right .text-block-line')!;
    rightLine.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const input = rightLine.querySelector<HTMLTextAreaElement>('.text-line-input')!;
    input.value = 'B2';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(await savedMarkdown()).toBe('<!-- row -->\nA\n<!-- col -->\nB2\n<!-- /row -->');
  });
});

describe('alignment', () => {
  it('stores the choice in the markdown', async () => {
    await openProjectEditor(harness, 'Text');
    blockWrappers()[0]!.querySelectorAll<HTMLButtonElement>('.block-align-btn')[1]!.click();

    expect(await savedMarkdown()).toBe('<!-- align:center -->\nText\n<!-- /align -->');
    expect(blockWrappers()[0]!.querySelectorAll('.block-align-btn')[1]!.classList.contains('active')).toBe(true);
  });

  it('is not offered on dividers, code, or rows', async () => {
    await openProjectEditor(harness, '---\n\n<!-- block -->\n\n```js\nx\n```\n\n<!-- block -->\n\n<!-- row -->\nA\n<!-- col -->\nB\n<!-- /row -->');
    expect(blockWrappers().map((el) => el.querySelector(':scope > .block-align-toolbar'))).toEqual([null, null, null]);
  });
});

describe('the slash menu', () => {
  it('opens on "/" at the start of a line and closes on Escape without discarding', async () => {
    await openProjectEditor(harness, 'Hello');
    const input = typeInLine('/');
    expect(menuIsOpen()).toBe(true);

    pressKey(input, 'Escape');

    expect(menuIsOpen()).toBe(false);
    expect(harness.reload).not.toHaveBeenCalled();
  });

  it('stays closed for "/" later in a line', async () => {
    await openProjectEditor(harness, 'Hello');
    typeInLine('and/or');
    expect(menuIsOpen()).toBe(false);
  });

  it('filters as you type and closes when nothing matches', async () => {
    await openProjectEditor(harness, 'Hello');
    const input = typeInLine('/');

    input.value = '/video';
    input.setSelectionRange(6, 6);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(Array.from(document.querySelectorAll<HTMLElement>('.slash-menu-item')).map((el) => el.dataset.command)).toEqual(['video']);

    input.value = '/zzz';
    input.setSelectionRange(4, 4);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(menuIsOpen()).toBe(false);
  });

  it('replaces an emptied text block with the chosen type', async () => {
    await openProjectEditor(harness, 'Keep\n\n<!-- block -->\n\nX');
    typeInLine('/', 1);
    menuItem('divider').click();

    expect(blockWrappers().map((el) => el.dataset.blockType)).toEqual(['text', 'divider']);
    expect(await savedMarkdown()).toBe('Keep\n\n<!-- block -->\n\n---');
  });

  it('removes the typed command and inserts after a block that still has text', async () => {
    await openProjectEditor(harness, 'Keep\nX');
    typeInLine('/', 0, 1);
    menuItem('divider').click();

    expect(blockWrappers().map((el) => el.dataset.blockType)).toEqual(['text', 'divider']);
    expect(lineInputs(0).map((line) => line.value)).toEqual(['Keep', '']);
    expect(await savedMarkdown()).toBe('Keep\n\n<!-- block -->\n\n---');
  });

  it('runs the highlighted command with the arrow keys and Enter', async () => {
    await openProjectEditor(harness, 'X');
    const input = typeInLine('/');
    pressKey(input, 'ArrowDown');
    expect(document.querySelector('.slash-menu-item.selected')?.getAttribute('data-command')).toBe('image');
    pressKey(input, 'ArrowUp');
    pressKey(input, 'ArrowUp');
    expect(document.querySelector('.slash-menu-item.selected')?.getAttribute('data-command')).toBe('divider');

    pressKey(input, 'Enter');

    expect(blockWrappers().map((el) => el.dataset.blockType)).toEqual(['divider']);
  });

  it('closes on a click outside', async () => {
    await openProjectEditor(harness, 'X');
    typeInLine('/');
    await vi.advanceTimersByTimeAsync(20);

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(menuIsOpen()).toBe(false);
  });

  it('is not available inside a column', async () => {
    await openProjectEditor(harness, '<!-- row -->\nA\n<!-- col -->\nB\n<!-- /row -->');
    const line = document.querySelector<HTMLElement>('.row-column-left .text-block-line')!;
    line.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const input = line.querySelector<HTMLTextAreaElement>('.text-line-input')!;
    input.value = '/';
    input.setSelectionRange(1, 1);
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(menuIsOpen()).toBe(false);
  });
});

describe('the line editor', () => {
  it('splits and merges lines with Enter and Backspace', async () => {
    await openProjectEditor(harness, 'Hello world');
    const input = typeInLine('Hello world');
    input.setSelectionRange(5, 5);
    pressKey(input, 'Enter');
    expect(lineInputs().map((line) => line.value)).toEqual(['Hello', ' world']);
    expect(document.activeElement).toBe(lineInputs()[1]);

    const second = lineInputs()[1]!;
    second.setSelectionRange(0, 0);
    pressKey(second, 'Backspace');
    expect(lineInputs().map((line) => line.value)).toEqual(['Hello world']);
    expect(await savedMarkdown()).toBe('Hello world');
  });

  it('merges forward with Delete at the end of a line', async () => {
    await openProjectEditor(harness, 'One\nTwo');
    const first = typeInLine('One');
    pressKey(first, 'Delete');
    expect(lineInputs().map((line) => line.value)).toEqual(['OneTwo']);
  });

  it('moves between lines with the arrow keys at the edges', async () => {
    await openProjectEditor(harness, 'One\nTwo');
    const first = typeInLine('One');
    pressKey(first, 'ArrowDown');
    expect(document.activeElement).toBe(lineInputs()[1]);
    expect(lineInputs()[1]?.selectionStart).toBe(0);

    pressKey(lineInputs()[1]!, 'ArrowLeft');
    expect(document.activeElement).toBe(lineInputs()[0]);
    expect(lineInputs()[0]?.selectionStart).toBe(3);
  });

  it('renders a preview of the line once it loses focus', async () => {
    await openProjectEditor(harness, 'Plain');
    const input = typeInLine('## Big **deal**');
    input.dispatchEvent(new Event('blur'));

    const heading = blockWrappers()[0]!.querySelector('.text-block-line-preview h2');
    expect(heading?.id).toBe('big-deal');
    expect(heading?.querySelector('strong')?.textContent).toBe('deal');
    expect(blockWrappers()[0]!.querySelector<HTMLElement>('.text-block-line')?.dataset.lineType).toBe('heading-2');
  });

  it('numbers repeated headings like the server does', async () => {
    await openProjectEditor(harness, '# Same\n# Same');
    const headings = blockWrappers()[0]!.querySelectorAll('.text-block-line-preview h1');
    expect(Array.from(headings).map((heading) => heading.id)).toEqual(['same', 'same_1']);

    const input = typeInLine('# Same', 0, 1);
    input.dispatchEvent(new Event('blur'));
    const again = blockWrappers()[0]!.querySelectorAll('.text-block-line-preview h1');
    expect(again[1]?.id).toBe('same_1');
  });
});

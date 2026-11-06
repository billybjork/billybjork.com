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
import { renderedToRawBoundaries, renderLinePreview } from '../../static/ts/edit/inline-markdown';

const AUTO_SAVE_MS = 2000;
const FRAME_MS = 20;

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

function selectIn(text: string, target: string): HTMLTextAreaElement {
  const input = typeInLine(text);
  const start = text.indexOf(target);
  input.setSelectionRange(start, start + target.length);
  return input;
}

async function inlineButton(action: string): Promise<HTMLButtonElement> {
  await vi.advanceTimersByTimeAsync(FRAME_MS);
  const button = document.querySelector<HTMLButtonElement>(`.inline-format-btn-${action}`);
  if (!button) throw new Error(`No inline button ${action}`);
  return button;
}

describe('formatting shortcuts', () => {
  it.each([
    ['b', 'bold word', 'word', 'bold **word**'],
    ['i', 'plain word', 'word', 'plain *word*'],
    ['u', 'plain word', 'word', 'plain <u>word</u>'],
  ])('Cmd+%s wraps the selection', async (key, text, target, expected) => {
    await openProjectEditor(harness, 'x');
    const input = selectIn(text, target);
    pressKey(input, key, { metaKey: true });

    expect(lineInputs()[0]?.value).toBe(expected);
    expect(input.value.slice(input.selectionStart, input.selectionEnd)).toBe(target);
    expect(await savedMarkdown()).toBe(expected);
  });

  it.each([
    ['b', 'a **word** b', 'a word b'],
    ['i', 'a *word* b', 'a word b'],
    ['u', 'a <u>word</u> b', 'a word b'],
  ])('Cmd+%s unwraps formatting already there', async (key, text, expected) => {
    await openProjectEditor(harness, 'x');
    const input = selectIn(text, 'word');
    pressKey(input, key, { metaKey: true });
    expect(input.value).toBe(expected);
  });

  it('keeps bold and italic independent', async () => {
    await openProjectEditor(harness, 'x');
    const input = selectIn('a **word** b', 'word');
    pressKey(input, 'i', { metaKey: true });
    expect(input.value).toBe('a ***word*** b');

    const again = selectIn('a ***word*** b', 'word');
    pressKey(again, 'i', { metaKey: true });
    expect(again.value).toBe('a **word** b');

    const bold = selectIn('a ***word*** b', 'word');
    pressKey(bold, 'b', { metaKey: true });
    expect(bold.value).toBe('a *word* b');
  });

  it('ignores markers on other lines of the value', async () => {
    await openProjectEditor(harness, 'x');
    const input = selectIn('plain', 'plain');
    pressKey(input, 'b', { ctrlKey: true });
    expect(input.value).toBe('**plain**');
  });

  it('wraps a placeholder when nothing is selected', async () => {
    await openProjectEditor(harness, 'x');
    const input = typeInLine('');
    pressKey(input, 'b', { metaKey: true });
    expect(input.value).toBe('**text**');
    expect(input.value.slice(input.selectionStart, input.selectionEnd)).toBe('text');
  });
});

describe('the inline toolbar', () => {
  it('appears for a selection and lights the formats it sits in', async () => {
    await openProjectEditor(harness, 'x');
    selectIn('a ***word*** b', 'word');
    await vi.advanceTimersByTimeAsync(FRAME_MS);

    expect(document.querySelector('.inline-format-toolbar')?.classList.contains('visible')).toBe(true);
    expect((await inlineButton('bold')).classList.contains('is-active')).toBe(true);
    expect((await inlineButton('italic')).classList.contains('is-active')).toBe(true);
    expect((await inlineButton('underline')).classList.contains('is-active')).toBe(false);
  });

  it('agrees with the toggle about plain bold', async () => {
    await openProjectEditor(harness, 'x');
    const input = selectIn('a **word** b', 'word');
    expect((await inlineButton('italic')).classList.contains('is-active')).toBe(false);

    (await inlineButton('italic')).click();
    expect(input.value).toBe('a ***word*** b');
  });

  it('hides when the selection collapses', async () => {
    await openProjectEditor(harness, 'x');
    const input = selectIn('some text', 'text');
    await vi.advanceTimersByTimeAsync(FRAME_MS);
    input.setSelectionRange(0, 0);
    input.dispatchEvent(new Event('select'));
    await vi.advanceTimersByTimeAsync(FRAME_MS);

    expect(document.querySelector('.inline-format-toolbar')?.classList.contains('visible')).toBe(false);
  });

  it('toggles a heading on the line, shifting the selection with it', async () => {
    await openProjectEditor(harness, 'x');
    const input = selectIn('Title', 'Title');
    (await inlineButton('heading-2')).click();
    expect(input.value).toBe('## Title');
    expect(input.value.slice(input.selectionStart, input.selectionEnd)).toBe('Title');

    expect((await inlineButton('heading-2')).classList.contains('is-active')).toBe(true);
    (await inlineButton('heading-3')).click();
    expect(input.value).toBe('### Title');

    (await inlineButton('heading-3')).click();
    expect(input.value).toBe('Title');
    expect(await savedMarkdown()).toBe('Title');
  });
});

describe('links', () => {
  function dialogUrl(): HTMLInputElement {
    return document.querySelector<HTMLInputElement>('.link-dialog-url')!;
  }

  function submitDialog(url: string): void {
    dialogUrl().value = url;
    document.querySelector<HTMLButtonElement>('.link-dialog-actions .edit-btn-primary')!.click();
  }

  it.each([
    ['example.com', 'https://example.com'],
    ['me@example.com', 'mailto:me@example.com'],
    ['#section', '#section'],
    ['/path', '/path'],
    ['mailto:a@b.co', 'mailto:a@b.co'],
  ])('Cmd+K wraps the selection, normalizing %j', async (typed, stored) => {
    await openProjectEditor(harness, 'x');
    const input = selectIn('see docs', 'docs');
    pressKey(input, 'k', { metaKey: true });
    submitDialog(typed);
    await vi.advanceTimersByTimeAsync(0);

    expect(input.value).toBe(`see [docs](${stored})`);
    expect(await savedMarkdown()).toBe(`see [docs](${stored})`);
  });

  it('edits the link under the cursor', async () => {
    await openProjectEditor(harness, 'x');
    const input = typeInLine('a [b](https://old.example) c');
    input.setSelectionRange(3, 3);
    pressKey(input, 'k', { metaKey: true });
    expect(dialogUrl().value).toBe('https://old.example');
    submitDialog('https://new.example');
    await vi.advanceTimersByTimeAsync(0);

    expect(input.value).toBe('a [b](https://new.example) c');
  });

  it('removes a link but keeps its text', async () => {
    await openProjectEditor(harness, 'x');
    const input = typeInLine('a [b](https://old.example) c');
    input.setSelectionRange(3, 3);
    pressKey(input, 'k', { metaKey: true });
    Array.from(document.querySelectorAll<HTMLButtonElement>('.link-dialog-actions button'))
      .find((button) => button.textContent === 'Remove Link')!.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(input.value).toBe('a b c');
  });

  it('offers the document\'s headings as link targets', async () => {
    await openProjectEditor(harness, '## First section\n\n<!-- block -->\n\nBody');
    const input = selectIn('Body', 'Body');
    pressKey(input, 'k', { metaKey: true });

    const sections = Array.from(document.querySelectorAll('.link-dialog-section')).map((el) => el.textContent);
    expect(sections).toEqual(['Top of page', 'First section']);
  });

  it('Escape closes the dialog and leaves the editor open', async () => {
    await openProjectEditor(harness, 'x');
    const input = selectIn('see docs', 'docs');
    pressKey(input, 'k', { metaKey: true });

    pressKey(dialogUrl(), 'Escape');
    await vi.advanceTimersByTimeAsync(200);

    expect(document.querySelector('.link-dialog-backdrop')).toBeNull();
    expect(input.value).toBe('see docs');
    expect(harness.reload).not.toHaveBeenCalled();
  });

  it('unlocks page scrolling once the dialog is gone', async () => {
    await openProjectEditor(harness, 'x');
    const input = selectIn('see docs', 'docs');
    pressKey(input, 'k', { metaKey: true });
    expect(document.body.classList.contains('modal-open')).toBe(true);

    pressKey(dialogUrl(), 'Escape');
    await vi.advanceTimersByTimeAsync(200);
    expect(document.body.classList.contains('modal-open')).toBe(false);
  });
});

describe('lists', () => {
  it('Enter continues a bullet with exactly one new line', async () => {
    await openProjectEditor(harness, 'x');
    const input = typeInLine('- one');
    pressKey(input, 'Enter');

    expect(lineInputs().map((line) => line.value)).toEqual(['- one', '- ']);
    expect(document.activeElement).toBe(lineInputs()[1]);
    expect(lineInputs()[1]?.selectionStart).toBe(2);
    expect(await savedMarkdown()).toBe('- one\n-');
  });

  it('numbers the next ordered item', async () => {
    await openProjectEditor(harness, 'x');
    pressKey(typeInLine('7. seven'), 'Enter');
    expect(lineInputs().map((line) => line.value)).toEqual(['7. seven', '8. ']);
  });

  it('keeps indentation and the marker', async () => {
    await openProjectEditor(harness, 'x');
    pressKey(typeInLine('   * nested'), 'Enter');
    expect(lineInputs().map((line) => line.value)).toEqual(['   * nested', '   * ']);
  });

  it('splits an item at the cursor', async () => {
    await openProjectEditor(harness, 'x');
    const input = typeInLine('- one two');
    input.setSelectionRange(5, 5);
    pressKey(input, 'Enter');
    expect(lineInputs().map((line) => line.value)).toEqual(['- one', '-  two']);
  });

  it('Enter on an empty item ends the list', async () => {
    await openProjectEditor(harness, 'x');
    pressKey(typeInLine('- '), 'Enter');
    expect(lineInputs().map((line) => line.value)).toEqual(['']);
  });

  it('also splits when the browser\'s insert does not fire input', async () => {
    (document as unknown as { execCommand: () => boolean }).execCommand = () => false;
    await openProjectEditor(harness, 'x');
    pressKey(typeInLine('- one'), 'Enter');
    expect(lineInputs().map((line) => line.value)).toEqual(['- one', '- ']);
  });

  it('Tab indents and turns a numbered item into a bullet; Shift+Tab outdents', async () => {
    await openProjectEditor(harness, 'x');
    const input = typeInLine('1. one');
    pressKey(input, 'Tab');
    expect(input.value).toBe('   - one');
    expect(await savedMarkdown()).toBe('- one');

    const again = typeInLine('   - two');
    pressKey(again, 'Tab', { shiftKey: true });
    expect(again.value).toBe('- two');
  });
});

describe('code blocks', () => {
  it('Tab inserts spaces and the block keeps them', async () => {
    await openProjectEditor(harness, '```js\nx\n```');
    const textarea = blockWrappers()[0]!.querySelector<HTMLTextAreaElement>('.code-textarea')!;
    textarea.focus();
    textarea.setSelectionRange(1, 1);
    pressKey(textarea, 'Tab');

    expect(textarea.value).toBe('x    ');
    expect(await savedMarkdown()).toBe('```js\nx    \n```');
  });

  it('saves a changed language', async () => {
    await openProjectEditor(harness, '```python\nx\n```');
    const select = blockWrappers()[0]!.querySelector<HTMLSelectElement>('.code-language-select')!;
    expect(select.value).toBe('python');
    select.value = 'go';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(await savedMarkdown()).toBe('```go\nx\n```');
  });
});

describe('callouts', () => {
  it('saves typed content', async () => {
    await openProjectEditor(harness, '<div class="callout">Old</div>');
    const textarea = blockWrappers()[0]!.querySelector<HTMLTextAreaElement>('.callout-textarea')!;
    textarea.value = 'New';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    expect(await savedMarkdown()).toBe('<div class="callout">New</div>');
  });
});

describe('line previews', () => {
  it.each([
    ['', 'empty'],
    ['---', 'divider'],
    ['> quoted', 'quote'],
    ['- item', 'list'],
    ['1. item', 'list'],
    ['#### Four', 'heading-4'],
    ['plain', 'paragraph'],
  ])('classifies %j as %s', async (line, type) => {
    await openProjectEditor(harness, `first\n${line}\nlast`);
    expect(blockWrappers()[0]!.querySelectorAll<HTMLElement>('.text-block-line')[1]?.dataset.lineType).toBe(type);
  });

  it('shows a placeholder for a block with nothing in it', async () => {
    await openProjectEditor(harness, '');
    const preview = blockWrappers()[0]!.querySelector('.text-block-line-preview');
    expect(preview?.classList.contains('text-block-line-placeholder')).toBe(true);
  });

  function html(markdown: string): string {
    const holder = document.createElement('div');
    holder.appendChild(renderLinePreview(markdown, new Set()).node);
    return (holder.firstElementChild as HTMLElement).innerHTML;
  }

  it('renders inline markdown', () => {
    expect(html('**b** *i* `c` ~~s~~ <u>u</u>')).toBe('<strong>b</strong> <em>i</em> <code>c</code> <s>s</s> <u>u</u>');
    expect(html('[out](https://a.example)')).toBe('<a href="https://a.example/" rel="noopener" target="_blank">out</a>');
    expect(html('[in](/here)')).toBe('<a href="/here">in</a>');
  });

  it('leaves unsafe and empty links as text', () => {
    expect(html('[x](javascript:alert(1))')).not.toContain('<a');
    expect(html('[x]()')).toBe('[x]()');
    expect(html('[](y)')).toBe('[](y)');
  });

  it.each([
    ['plain', 'paragraph', 'plain', 2, 2],
    ['**bold**', 'paragraph', 'bold', 1, 3],
    ['## Head', 'heading-2', 'Head', 0, 3],
    ['> quote', 'quote', 'quote', 0, 2],
    ['a [link](https://x.example) b', 'paragraph', 'a link b', 2, 3],
  ])('maps a click in the rendered %j back to the raw offset', (line, type, rendered, offset, raw) => {
    const boundaries = renderedToRawBoundaries(line, type);
    expect(boundaries).toHaveLength(rendered.length + 1);
    expect(boundaries[offset]).toBe(raw);
  });
});

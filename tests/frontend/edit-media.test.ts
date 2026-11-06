import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  blockWrappers,
  installHarness,
  jsonResponse,
  notifications,
  openProjectEditor,
  stubXhr,
  type EditorHarness,
} from './edit-harness';

const AUTO_SAVE_MS = 2000;
const IMAGE = '![Cat](https://cdn.example/cat.webp)';
const VIDEO = '<video src="https://cdn.example/v.mp4" poster="https://cdn.example/p.webp" controls></video>';

let harness: EditorHarness;

beforeEach(() => {
  vi.useFakeTimers();
  harness = installHarness();
  installImagePipeline();
});

afterEach(() => {
  harness.teardown();
});

async function savedMarkdown(): Promise<unknown> {
  await vi.advanceTimersByTimeAsync(AUTO_SAVE_MS);
  return harness.lastSave().markdown;
}

/** jsdom has no canvas or image decoding; these stand in with a loaded 3000x1500 image. */
function installImagePipeline(): void {
  class LoadedImage {
    width = 3000;
    height = 1500;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal('Image', LoadedImage);
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() })) as never;
  HTMLCanvasElement.prototype.toBlob = function toBlob(callback: BlobCallback) {
    callback(new Blob(['webp'], { type: 'image/webp' }));
  };
}

function dropFile(zone: HTMLElement, file: File): void {
  const input = zone.querySelector<HTMLInputElement>('.upload-input')!;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

function setRect(element: Element, width: number, height: number): void {
  element.getBoundingClientRect = () => ({ top: 0, left: 0, right: width, bottom: height, width, height, x: 0, y: 0, toJSON: () => ({}) });
}

describe('image blocks', () => {
  it('saves alt text and caption edits', async () => {
    await openProjectEditor(harness, IMAGE);
    const wrapper = blockWrappers()[0]!;
    const alt = wrapper.querySelector<HTMLInputElement>('.image-alt-input')!;
    alt.value = 'Dog';
    alt.dispatchEvent(new Event('input', { bubbles: true }));
    const caption = wrapper.querySelector<HTMLInputElement>('.media-caption-input')!;
    caption.value = 'A good dog';
    caption.dispatchEvent(new Event('input', { bubbles: true }));

    expect(await savedMarkdown()).toBe('![Dog](https://cdn.example/cat.webp)\n<p class="media-caption">A good dog</p>');
  });

  it('fills an empty block from an upload', async () => {
    harness.respond('/api/upload-media', () => jsonResponse({ url: 'https://cdn.example/new.webp' }));
    await openProjectEditor(harness, '![](https://cdn.example/x.webp)\n\n<!-- block -->\n\nText');
    document.querySelector<HTMLButtonElement>('.add-block-wrapper-top .merge-add-btn')!.click();
    document.querySelector<HTMLButtonElement>('.slash-menu-item[data-command="image"]')!.click();

    dropFile(blockWrappers()[0]!.querySelector('.upload-zone')!, new File(['x'], 'my photo.png', { type: 'image/png' }));
    await vi.advanceTimersByTimeAsync(0);

    expect(blockWrappers()[0]!.querySelector<HTMLImageElement>('.block-image')?.src).toBe('https://cdn.example/new.webp');
    expect(notifications()).toContain('Image uploaded!');
    const upload = harness.calls.find((call) => call.url === '/api/upload-media')?.body as FormData;
    expect(Array.from(upload.keys())).toEqual(['file']);
    expect(String(await savedMarkdown()).startsWith('![my photo](https://cdn.example/new.webp)')).toBe(true);
  });

  it('reports a failed upload', async () => {
    harness.respond('/api/upload-media', () => jsonResponse({ detail: 'Too big' }, 400));
    await openProjectEditor(harness, 'Text');
    document.querySelector<HTMLButtonElement>('.add-block-wrapper-top .merge-add-btn')!.click();
    document.querySelector<HTMLButtonElement>('.slash-menu-item[data-command="image"]')!.click();

    dropFile(blockWrappers()[0]!.querySelector('.upload-zone')!, new File(['x'], 'a.png', { type: 'image/png' }));
    await vi.advanceTimersByTimeAsync(0);

    expect(notifications()).toContain('Too big');
  });
});

describe('resizing', () => {
  function selectAndDragHandle(element: HTMLElement, handleClass: string, deltaX: number, deltaY = 0): void {
    setRect(element, 400, 200);
    setRect(element.closest('.block-content')!, 800, 400);
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const handle = document.querySelector<HTMLElement>(`.resize-handle.${handleClass}`)!;
    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 100, clientY: 100, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 100 + deltaX, clientY: 100 + deltaY }));
    document.dispatchEvent(new MouseEvent('mouseup'));
  }

  it('selects with corner handles and deselects on a click elsewhere', async () => {
    await openProjectEditor(harness, `${IMAGE}\n\n<!-- block -->\n\nText`);
    const image = blockWrappers()[0]!.querySelector<HTMLElement>('.block-image')!;
    setRect(image, 400, 200);

    image.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelectorAll('.resize-handle')).toHaveLength(4);
    expect(image.classList.contains('media-selected')).toBe(true);

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelectorAll('.resize-handle')).toHaveLength(0);
    expect(image.classList.contains('media-selected')).toBe(false);
  });

  it('stores a dragged width', async () => {
    await openProjectEditor(harness, IMAGE);
    selectAndDragHandle(blockWrappers()[0]!.querySelector<HTMLElement>('.block-image')!, 'se', 100);

    expect(await savedMarkdown()).toBe('<img src="https://cdn.example/cat.webp" alt="Cat" style="display: block; width: 500px">');
  });

  it('counts the west handles from the other side', async () => {
    await openProjectEditor(harness, IMAGE);
    selectAndDragHandle(blockWrappers()[0]!.querySelector<HTMLElement>('.block-image')!, 'nw', 100);

    expect(await savedMarkdown()).toContain('width: 300px');
  });

  it('drops the width when dragged to the full width of the column', async () => {
    await openProjectEditor(harness, IMAGE);
    selectAndDragHandle(blockWrappers()[0]!.querySelector<HTMLElement>('.block-image')!, 'se', 2000);

    expect(await savedMarkdown()).toBe('![Cat](https://cdn.example/cat.webp)');
  });

  it('keeps alignment through a resize', async () => {
    await openProjectEditor(harness, '<img src="a.webp" alt="" style="display: block; width: 300px; margin-left: auto; margin-right: auto">');
    selectAndDragHandle(blockWrappers()[0]!.querySelector<HTMLElement>('.block-image')!, 'se', 100);

    expect(await savedMarkdown()).toBe('<img src="a.webp" alt="" style="display: block; width: 500px; margin-left: auto; margin-right: auto">');
  });

  it('gives html blocks edge handles that set a fixed height', async () => {
    await openProjectEditor(harness, '<!-- html -->\n<b>x</b>\n<!-- /html -->');
    const iframe = blockWrappers()[0]!.querySelector<HTMLIFrameElement>('iframe')!;
    expect(iframe.dataset.autoHeight).toBe('true');

    setRect(iframe, 400, 200);
    setRect(iframe.closest('.block-content')!, 800, 400);
    blockWrappers()[0]!.querySelector<HTMLButtonElement>('.html-block-select-overlay')!.click();
    expect(document.querySelectorAll('.resize-handle')).toHaveLength(8);

    const handle = document.querySelector<HTMLElement>('.resize-handle.s')!;
    handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 100, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 0, clientY: 150 }));
    document.dispatchEvent(new MouseEvent('mouseup'));

    expect(iframe.dataset.autoHeight).toBe('false');
    expect(await savedMarkdown()).toBe('<!-- html style="height: 250px; width: 400px" -->\n<b>x</b>\n<!-- /html -->');
  });

  it('resizes a column\'s media without touching the other column', async () => {
    await openProjectEditor(harness, `<!-- row -->\n${IMAGE}\n<!-- col -->\nRight\n<!-- /row -->`);
    const image = document.querySelector<HTMLElement>('.row-column-left .block-image')!;
    setRect(image.closest('.row-column')!, 500, 400);
    setRect(image, 200, 100);
    image.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.querySelector<HTMLElement>('.resize-handle.se')!.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0, bubbles: true }));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 0 }));
    document.dispatchEvent(new MouseEvent('mouseup'));

    expect(await savedMarkdown()).toBe('<!-- row -->\n<img src="https://cdn.example/cat.webp" alt="Cat" style="display: block; width: 250px">\n<!-- col -->\nRight\n<!-- /row -->');
  });
});

describe('video blocks', () => {
  function posterInput(): HTMLInputElement {
    return blockWrappers()[0]!.querySelector<HTMLInputElement>('.video-poster-input')!;
  }

  it('never autoplays in the editor, whatever the block says', async () => {
    await openProjectEditor(harness, '<video src="a.mp4" autoplay loop muted playsinline></video>');
    const video = blockWrappers()[0]!.querySelector<HTMLVideoElement>('video')!;

    expect(video.autoplay).toBe(false);
    expect(video.hasAttribute('autoplay')).toBe(false);
    expect(video.controls).toBe(true);
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
  });

  it('saves the autoplay choice and hides the poster fields for it', async () => {
    await openProjectEditor(harness, VIDEO);
    const toggle = blockWrappers()[0]!.querySelector<HTMLInputElement>('.video-option-checkbox')!;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));

    expect(posterInput().disabled).toBe(true);
    expect(blockWrappers()[0]!.querySelector('.video-poster-controls')?.classList.contains('poster-fields-hidden')).toBe(true);
    expect(await savedMarkdown()).toBe('<video src="https://cdn.example/v.mp4" poster="https://cdn.example/p.webp" autoplay loop muted playsinline></video>');
  });

  it('marks a replaced poster for cleanup and ignores half-typed URLs', async () => {
    await openProjectEditor(harness, VIDEO);
    posterInput().value = 'https://cdn';
    posterInput().dispatchEvent(new Event('input', { bubbles: true }));
    posterInput().value = 'https://cdn.example/q.webp';
    posterInput().dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(AUTO_SAVE_MS);

    expect(harness.lastSave().cleanup_candidates).toEqual(['https://cdn.example/p.webp']);
    expect(harness.lastSave().markdown).toContain('poster="https://cdn.example/q.webp"');
  });

  it('clears the poster', async () => {
    await openProjectEditor(harness, VIDEO);
    Array.from(blockWrappers()[0]!.querySelectorAll<HTMLButtonElement>('.video-poster-action'))
      .find((button) => button.textContent === 'Clear')!.click();

    expect(blockWrappers()[0]!.querySelector('video')?.hasAttribute('poster')).toBe(false);
    expect(await savedMarkdown()).toBe('<video src="https://cdn.example/v.mp4" controls></video>');
  });

  it('uploads a video with progress, then shows it', async () => {
    const xhr = stubXhr();
    await openProjectEditor(harness, 'Text');
    document.querySelector<HTMLButtonElement>('.add-block-wrapper-top .merge-add-btn')!.click();
    document.querySelector<HTMLButtonElement>('.slash-menu-item[data-command="video"]')!.click();
    const zone = blockWrappers()[0]!.querySelector<HTMLElement>('.upload-zone')!;

    dropFile(zone, new File(['x'], 'clip.mp4', { type: 'video/mp4' }));
    expect(xhr.instance().url).toBe('/api/process-content-video');

    xhr.instance().progress(52428800, 104857600);
    expect(zone.querySelector('.upload-zone-progress-text')?.textContent).toBe('Uploading video... 50% (50.0 / 100.0 MB)');
    expect(zone.classList.contains('uploading')).toBe(true);

    xhr.instance().sent();
    expect(zone.querySelector('.upload-zone-progress-fill')?.classList.contains('is-indeterminate')).toBe(true);

    xhr.instance().finish(200, { url: 'https://cdn.example/clip.mp4' });
    await vi.advanceTimersByTimeAsync(0);

    expect(blockWrappers()[0]!.querySelector<HTMLVideoElement>('.block-video')?.src).toBe('https://cdn.example/clip.mp4');
    expect(notifications()).toContain('Video processed!');
  });

  it('shows the server\'s reason when a video upload fails', async () => {
    const xhr = stubXhr();
    await openProjectEditor(harness, 'Text');
    document.querySelector<HTMLButtonElement>('.add-block-wrapper-top .merge-add-btn')!.click();
    document.querySelector<HTMLButtonElement>('.slash-menu-item[data-command="video"]')!.click();
    const zone = blockWrappers()[0]!.querySelector<HTMLElement>('.upload-zone')!;

    dropFile(zone, new File(['x'], 'clip.mp4', { type: 'video/mp4' }));
    xhr.instance().finish(400, { detail: 'Bad codec' });
    await vi.advanceTimersByTimeAsync(0);

    expect(notifications()).toContain('Bad codec');
    expect(zone.classList.contains('upload-error')).toBe(true);
  });
});

describe('pasting an image', () => {
  it('uploads into the focused image block', async () => {
    harness.respond('/api/upload-media', () => jsonResponse({ url: 'https://cdn.example/pasted.webp' }));
    await openProjectEditor(harness, IMAGE);
    blockWrappers()[0]!.querySelector<HTMLInputElement>('.image-alt-input')!.focus();

    const file = new File(['x'], 'pasted.png', { type: 'image/png' });
    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', { value: { items: [{ type: 'image/png', getAsFile: () => file }] } });
    document.dispatchEvent(event);
    await vi.advanceTimersByTimeAsync(0);

    expect(event.defaultPrevented).toBe(true);
    expect(blockWrappers()[0]!.querySelector<HTMLImageElement>('.block-image')?.src).toBe('https://cdn.example/pasted.webp');
  });

  it('leaves text paste to the browser', async () => {
    await openProjectEditor(harness, IMAGE);
    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', { value: { items: [{ type: 'text/plain', getAsFile: () => null }] } });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installHarness,
  jsonResponse,
  notifications,
  openProjectEditor,
  PROJECT,
  pressKey,
  statusText,
  stubXhr,
  type EditorHarness,
  type FakeXhr,
} from './edit-harness';

vi.mock('../../static/ts/core/hls', () => ({
  attachHlsPlayback: vi.fn(async () => {}),
  destroyHlsInstance: vi.fn(),
}));

const NEW_VIDEO = { hls: 'https://cdn.example/hero2/master.m3u8', spriteSheet: 'https://cdn.example/hero2/sprite.webp', frames: 30 };

let harness: EditorHarness;

beforeEach(() => {
  vi.useFakeTimers();
  harness = installHarness();
  URL.createObjectURL = vi.fn(() => 'blob:local');
  URL.revokeObjectURL = vi.fn();
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as never;
});

afterEach(() => {
  harness.teardown();
});

async function settle(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

function dialog(): HTMLElement | null {
  return document.querySelector('.edit-hero-dialog-modal');
}

function respondWithExistingVideo(): void {
  harness.respond('/api/video-thumbnails-existing', () => jsonResponse({
    success: true,
    temp_id: 'temp-1',
    duration: 20,
    frames: ['AAAA'],
    hls_url: PROJECT.video.hls,
  }));
  harness.respond('/api/video-thumbnails/more/temp-1', () => jsonResponse({ frames: ['AAAA', 'BBBB'], complete: true }));
}

function respondToProcess(): void {
  harness.respond('/api/generate-sprite-sheet', () => jsonResponse({ success: true, video: NEW_VIDEO }));
}

async function openUpdateSprite(): Promise<void> {
  await openProjectEditor(harness, 'Body');
  respondWithExistingVideo();
  document.querySelector<HTMLButtonElement>('[data-action="update-sprite"]')!.click();
  await settle();
}

function formField(url: string, name: string): FormDataEntryValue | null {
  const call = harness.calls.find((candidate) => candidate.url === url);
  return (call?.body as FormData | undefined)?.get(name) ?? null;
}

async function openWithUpload(): Promise<{ xhr: FakeXhr }> {
  const stub = stubXhr();
  await openProjectEditor(harness, 'Body');
  const input = document.querySelector<HTMLInputElement>('.edit-hero-video-file')!;
  Object.defineProperty(input, 'files', { value: [new File(['x'], 'hero.mov', { type: 'video/quicktime' })], configurable: true });
  input.dispatchEvent(new Event('change'));
  return { xhr: stub.instance() };
}

describe('re-cutting the sprite from the current video', () => {
  it('loads the timeline from the project\'s saved video', async () => {
    await openUpdateSprite();

    expect(formField('/api/video-thumbnails-existing', 'project_slug')).toBe(PROJECT.slug);
    expect(dialog()?.querySelector('h2')?.textContent).toBe('Update Hero Sprite');
    expect(dialog()?.querySelector('.edit-hero-total-time')?.textContent).toBe('0:20');
    expect(dialog()?.querySelector('.edit-hero-sprite-info')?.textContent).toBe('Sprite: 0:00 - 0:03 (3.0s)');
    expect(dialog()?.querySelector<HTMLButtonElement>('#hero-video-process')?.disabled).toBe(false);
  });

  it('sends the chosen range, and the project saves the new video', async () => {
    await openUpdateSprite();
    respondToProcess();

    pressKey(document, 'ArrowRight');
    pressKey(document, 'ArrowRight', { shiftKey: true });
    expect(dialog()?.querySelector('.edit-hero-sprite-info')?.textContent).toBe('Sprite: 0:00 - 0:04 (3.5s)');

    dialog()!.querySelector<HTMLButtonElement>('#hero-video-process')!.click();
    await settle();

    expect(formField('/api/generate-sprite-sheet', 'temp_id')).toBe('temp-1');
    expect(formField('/api/generate-sprite-sheet', 'project_slug')).toBe(PROJECT.slug);
    expect(formField('/api/generate-sprite-sheet', 'sprite_start')).toBe('0.5');
    expect(formField('/api/generate-sprite-sheet', 'sprite_duration')).toBe('3.5');
    expect(notifications()).toContain('Hero sprite updated successfully!');
    expect(statusText()).toBe('(unsaved)');

    await settle(1000);
    expect(dialog()).toBeNull();
    await settle(2000);
    expect(harness.lastSave().video).toEqual(NEW_VIDEO);
    expect(document.querySelector('.edit-hero-video-status')?.textContent).toBe('Current: master.m3u8');
  });

  it('stays open and re-enables the button when processing fails', async () => {
    await openUpdateSprite();
    harness.respond('/api/generate-sprite-sheet', () => jsonResponse({ detail: 'ffmpeg sad' }, 500));
    const button = dialog()!.querySelector<HTMLButtonElement>('#hero-video-process')!;
    button.click();
    await settle();

    expect(notifications()).toContain('Video processing failed: ffmpeg sad');
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Generate New Sprite');
    expect(dialog()).not.toBeNull();
  });

  it('warns before leaving only while processing', async () => {
    await openUpdateSprite();
    let finish!: (response: Response) => void;
    harness.respond('/api/generate-sprite-sheet', () => new Promise<Response>((resolve) => { finish = resolve; }));
    dialog()!.querySelector<HTMLButtonElement>('#hero-video-process')!.click();
    await settle();

    const blocked = (): boolean => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(blocked()).toBe(true);

    finish(jsonResponse({ detail: 'nope' }, 500));
    await settle();
    expect(blocked()).toBe(false);
  });

  it('closes when the current video cannot load', async () => {
    await openProjectEditor(harness, 'Body');
    harness.respond('/api/video-thumbnails-existing', () => jsonResponse({ detail: 'gone' }, 404));
    document.querySelector<HTMLButtonElement>('[data-action="update-sprite"]')!.click();
    await settle();

    expect(notifications()).toContain('Failed to load existing hero video: gone');
    expect(dialog()).toBeNull();
    expect(document.body.classList.contains('modal-open')).toBe(false);
  });
});

describe('closing the dialog', () => {
  it.each([
    ['the X', () => dialog()!.querySelector<HTMLButtonElement>('.edit-hero-dialog-close')!.click()],
    ['Cancel', () => dialog()!.querySelector<HTMLButtonElement>('#hero-video-cancel')!.click()],
    ['the overlay', () => dialog()!.querySelector<HTMLElement>('.edit-hero-dialog-overlay')!.click()],
  ])('%s closes it and unlocks scrolling', async (_name, closeIt) => {
    await openUpdateSprite();
    expect(document.body.classList.contains('modal-open')).toBe(true);

    closeIt();

    expect(dialog()).toBeNull();
    expect(document.body.classList.contains('modal-open')).toBe(false);
  });

  it('Escape closes only the dialog, not the editor', async () => {
    await openUpdateSprite();
    pressKey(document, 'Escape');
    await settle();

    expect(dialog()).toBeNull();
    expect(harness.reload).not.toHaveBeenCalled();
  });

  it('stops answering arrow keys once closed', async () => {
    await openUpdateSprite();
    dialog()!.querySelector<HTMLButtonElement>('#hero-video-cancel')!.click();

    const event = pressKey(document, 'ArrowRight');
    expect(event.defaultPrevented).toBe(false);
  });

  it('aborts an upload still running', async () => {
    const { xhr } = await openWithUpload();
    dialog()!.querySelector<HTMLButtonElement>('#hero-video-cancel')!.click();
    await settle();

    expect(xhr.aborted).toBe(true);
    expect(notifications()).toEqual([]);
  });
});

describe('uploading a new video', () => {
  async function finishUpload(xhr: FakeXhr, extra: Record<string, unknown> = {}): Promise<void> {
    harness.respond('/api/video-thumbnails/more/temp-2', () => jsonResponse({ frames: [], complete: true }));
    xhr.finish(200, { success: true, temp_id: 'temp-2', duration: 12, frames: ['AAAA'], ...extra });
    await settle();
  }

  it('shows the file and upload progress', async () => {
    const { xhr } = await openWithUpload();

    expect(dialog()?.querySelector('h2')?.textContent).toBe('Process Hero Video');
    expect(dialog()?.querySelector('.edit-hero-file-info')?.textContent).toContain('hero.mov');
    expect(xhr.url).toBe('/api/video-thumbnails');
    expect(xhr.body?.get('project_slug')).toBe(PROJECT.slug);

    xhr.progress(1048576, 4194304);
    expect(dialog()?.querySelector('.edit-hero-progress-text')?.textContent).toBe('Uploading: 1.0 / 4.0 MB');
    expect(dialog()?.querySelector<HTMLElement>('.edit-hero-progress-fill')?.style.width).toBe('12.5%');
  });

  it('previews the local file and hides the bar when no encode is running', async () => {
    const { xhr } = await openWithUpload();
    await finishUpload(xhr);

    const video = dialog()!.querySelector<HTMLVideoElement>('video')!;
    expect(video.src).toBe('blob:local');
    expect(dialog()?.querySelector<HTMLElement>('.edit-hero-progress')?.style.display).toBe('none');
    expect(dialog()?.querySelector<HTMLButtonElement>('#hero-video-process')?.disabled).toBe(false);
  });

  it('tracks the encode on the bar, then swaps the preview to HLS', async () => {
    const { attachHlsPlayback } = await import('../../static/ts/core/hls');
    const { xhr } = await openWithUpload();
    let progress: Record<string, unknown> = { status: 'processing', progress: 50 };
    harness.respond('/api/hls-progress/session-1', () => jsonResponse(progress));
    await finishUpload(xhr, { hls_session_id: 'session-1' });

    await settle(1000);
    expect(dialog()?.querySelector<HTMLElement>('.edit-hero-progress-fill')?.style.width).toBe('75%');
    expect(dialog()?.querySelector('.edit-hero-progress-text')?.textContent).toBe('Encoding HLS... 50%');

    progress = { status: 'complete', hls_url: 'https://cdn.example/h/master.m3u8' };
    await settle(1000);
    expect(attachHlsPlayback).toHaveBeenCalledWith(expect.objectContaining({ sourceUrl: 'https://cdn.example/h/master.m3u8' }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local');
    expect(dialog()?.querySelector('.edit-hero-progress-text')?.textContent).toBe('HLS ready! Select sprite range and confirm.');

    const pollsAfterComplete = harness.calls.filter((call) => call.url.includes('hls-progress')).length;
    await settle(3000);
    expect(harness.calls.filter((call) => call.url.includes('hls-progress'))).toHaveLength(pollsAfterComplete);
    expect(dialog()?.querySelector<HTMLElement>('.edit-hero-progress')?.style.display).toBe('none');
  });

  it('keeps polling through a failed progress request', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { xhr } = await openWithUpload();
    harness.respond('/api/hls-progress/session-1', () => jsonResponse({}, 500));
    await finishUpload(xhr, { hls_session_id: 'session-1' });
    await settle(3000);

    expect(harness.calls.filter((call) => call.url.includes('hls-progress')).length).toBe(3);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('flags a failed encode and still lets the sprite retry it', async () => {
    const { xhr } = await openWithUpload();
    harness.respond('/api/hls-progress/session-1', () => jsonResponse({ status: 'error' }));
    await finishUpload(xhr, { hls_session_id: 'session-1' });
    await settle(1000);

    const fill = dialog()!.querySelector<HTMLElement>('.edit-hero-progress-fill')!;
    expect(fill.classList.contains('has-error')).toBe(true);
    expect(dialog()?.querySelector('.edit-hero-progress-text')?.textContent).toBe('HLS encoding failed - will retry on confirm');

    await settle(2000);
    expect(fill.classList.contains('has-error')).toBe(false);
  });

  it('confirming during the encode sends the session and reports on the processing range', async () => {
    const { xhr } = await openWithUpload();
    harness.respond('/api/hls-progress/session-1', () => jsonResponse({ status: 'processing', progress: 50, stage: 'Encoding 720p' }));
    let finish!: (response: Response) => void;
    harness.respond('/api/generate-sprite-sheet', () => new Promise<Response>((resolve) => { finish = resolve; }));
    await finishUpload(xhr, { hls_session_id: 'session-1' });

    dialog()!.querySelector<HTMLButtonElement>('#hero-video-process')!.click();
    expect(dialog()?.querySelector<HTMLElement>('.edit-hero-progress-fill')?.style.width).toBe('20%');
    await settle(1000);
    expect(dialog()?.querySelector<HTMLElement>('.edit-hero-progress-fill')?.style.width).toBe('50%');
    expect(dialog()?.querySelector('.edit-hero-progress-text')?.textContent).toBe('Encoding 720p');
    expect(formField('/api/generate-sprite-sheet', 'hls_session_id')).toBe('session-1');

    finish(jsonResponse({ success: true, video: NEW_VIDEO }));
    await settle();
    expect(notifications()).toContain('Video processed successfully!');
    const polls = harness.calls.filter((call) => call.url.includes('hls-progress')).length;
    await settle(2000);
    expect(harness.calls.filter((call) => call.url.includes('hls-progress'))).toHaveLength(polls);
  });

  it('reports the server\'s reason for a rejected upload', async () => {
    const { xhr } = await openWithUpload();
    xhr.finish(400, { detail: 'Too large' });
    await settle();

    expect(notifications()).toContain('Too large');
    expect(dialog()).toBeNull();
  });

  it('rejects a non-video file before opening', async () => {
    await openProjectEditor(harness, 'Body');
    const input = document.querySelector<HTMLInputElement>('.edit-hero-video-file')!;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.png', { type: 'image/png' })], configurable: true });
    input.dispatchEvent(new Event('change'));

    expect(notifications()).toContain('Please select a video file');
    expect(dialog()).toBeNull();
  });
});

describe('the OG image override', () => {
  function ogInput(): HTMLInputElement {
    return document.querySelector<HTMLInputElement>('.edit-hero-thumbnail-input')!;
  }

  it('saves a changed URL and offers the old one for cleanup', async () => {
    await openProjectEditor(harness, 'Body');
    ogInput().value = 'https://cdn.example/new.webp';
    ogInput().dispatchEvent(new Event('change', { bubbles: true }));
    await settle(2000);

    expect(harness.lastSave().og_image).toBe('https://cdn.example/new.webp');
    expect(harness.lastSave().cleanup_candidates).toEqual([PROJECT.og_image]);
  });

  it('is not an edit just to focus and leave the field', async () => {
    await openProjectEditor(harness, 'Body');
    ogInput().focus();
    ogInput().blur();
    await settle(2000);

    expect(harness.saves()).toHaveLength(0);
  });

  it('clears, and previews the fallback', async () => {
    await openProjectEditor(harness, 'Body');
    document.querySelector<HTMLButtonElement>('[data-action="clear"]')!.click();
    await settle(2000);

    expect(harness.lastSave().og_image).toBeNull();
    expect(document.querySelector<HTMLImageElement>('.edit-hero-thumbnail-preview')?.src).toBe(PROJECT.video.spriteSheet);
  });

  it('keeps sending the stored value on every save', async () => {
    await openProjectEditor(harness, 'Body');
    const name = document.querySelector<HTMLInputElement>('.edit-project-header-name-input')!;
    name.value = 'New';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(2000);

    expect(harness.lastSave().og_image).toBe(PROJECT.og_image);
  });
});

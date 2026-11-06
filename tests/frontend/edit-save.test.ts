import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  blockWrappers,
  installHarness,
  jsonResponse,
  lineInputs,
  mountProjectPage,
  notifications,
  openAboutEditor,
  openProjectEditor,
  PROJECT,
  pressKey,
  statusText,
  toolbarButton,
  typeInLine,
  type EditorHarness,
} from './edit-harness';

const AUTO_SAVE_MS = 2000;
const RETRY_MS = 5000;

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

function conflictOnce(route: string): void {
  let conflicted = false;
  const normal = (call: { body: unknown }) => jsonResponse({
    success: true,
    slug: (call.body as { slug?: string }).slug,
    revision: 'rev-after-force',
  });
  harness.respond(route, (call) => {
    if (conflicted) return normal(call);
    conflicted = true;
    return jsonResponse({ conflict: true }, 409);
  });
}

describe('autosave', () => {
  it('sends the whole project two seconds after the last edit', async () => {
    await openProjectEditor(harness, 'Hello');
    typeInLine('Hello there');
    await settle(AUTO_SAVE_MS - 1);
    expect(harness.saves()).toHaveLength(0);
    expect(statusText()).toBe('(unsaved)');

    await settle(1);

    expect(harness.lastSave()).toEqual({
      slug: PROJECT.slug,
      original_slug: PROJECT.slug,
      name: PROJECT.name,
      date: PROJECT.date,
      pinned: false,
      draft: true,
      youtube: PROJECT.youtube,
      og_image: PROJECT.og_image,
      video: PROJECT.video,
      markdown: 'Hello there',
      base_revision: 'rev-1',
    });
    expect(statusText()).toBe('All changes saved');
  });

  it('bases the next save on the revision the last save returned', async () => {
    await openProjectEditor(harness, 'Hello');
    typeInLine('One');
    await settle(AUTO_SAVE_MS);
    typeInLine('Two');
    await settle(AUTO_SAVE_MS);

    expect(harness.saves().map((save) => save.base_revision)).toEqual(['rev-1', 'rev-2']);
  });

  it('sends only markdown and the revision from the about page', async () => {
    await openAboutEditor(harness, 'About me');
    typeInLine('About you');
    await settle(AUTO_SAVE_MS);

    expect(harness.lastSave()).toEqual({ markdown: 'About you', base_revision: 'rev-1' });
  });

  it('coalesces edits made within the delay', async () => {
    await openProjectEditor(harness, 'Hello');
    typeInLine('A');
    await settle(AUTO_SAVE_MS / 2);
    typeInLine('AB');
    await settle(AUTO_SAVE_MS);

    expect(harness.saves().map((save) => save.markdown)).toEqual(['AB']);
  });

  it('retries a failed save after five seconds and clears the error', async () => {
    await openProjectEditor(harness, 'Hello');
    harness.respond('/api/save-project', () => jsonResponse({ detail: 'nope' }, 500));
    typeInLine('Edited');
    await settle(AUTO_SAVE_MS);
    expect(statusText()).toBe('Save failed');

    harness.respond('/api/save-project', () => jsonResponse({ success: true, slug: PROJECT.slug, revision: 'rev-2' }));
    await settle(RETRY_MS);

    expect(harness.saves()).toHaveLength(2);
    expect(statusText()).toBe('All changes saved');
  });

  it('settles the status to "no unsaved changes" three seconds after saving', async () => {
    await openProjectEditor(harness, 'Hello');
    typeInLine('Edited');
    await settle(AUTO_SAVE_MS);
    expect(statusText()).toBe('All changes saved');
    await settle(3000);
    expect(statusText()).toBe('No unsaved changes');
  });
});

describe('editing during a save', () => {
  /** Holds each save open until the test answers it. */
  function holdSaves(): Array<(response?: Response) => void> {
    const pending: Array<(response?: Response) => void> = [];
    harness.respond('/api/save-project', (call) => new Promise<Response>((resolve) => {
      pending.push((response) => resolve(response ?? jsonResponse({
        success: true,
        slug: (call.body as { slug: string }).slug,
        revision: `rev-${pending.length + 1}`,
      })));
    }));
    return pending;
  }

  it('keeps a keystroke made while the request is out, and saves it next', async () => {
    await openProjectEditor(harness, 'Hello');
    const pending = holdSaves();
    typeInLine('First');
    await settle(AUTO_SAVE_MS);
    expect(harness.saves().map((save) => save.markdown)).toEqual(['First']);

    typeInLine('First and more');
    pending[0]!();
    await settle();

    expect(statusText()).toBe('(unsaved)');
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    await settle(AUTO_SAVE_MS);
    expect(harness.saves().map((save) => save.markdown)).toEqual(['First', 'First and more']);
    pending[1]!();
    await settle();
    expect(statusText()).toBe('All changes saved');
  });

  it('waits for the save in flight and builds on its revision, rather than aborting it', async () => {
    await openProjectEditor(harness, 'Hello');
    const pending = holdSaves();
    typeInLine('First');
    await settle(AUTO_SAVE_MS);

    typeInLine('Second');
    await settle(AUTO_SAVE_MS);
    expect(harness.saves()).toHaveLength(1);

    pending[0]!();
    await settle();

    expect(harness.saves().map((save) => [save.markdown, save.base_revision])).toEqual([
      ['First', 'rev-1'],
      ['Second', 'rev-2'],
    ]);
  });

  it('keeps a cleanup candidate that arrives while the request is out', async () => {
    const poster = (name: string) => `<video src="https://cdn.example/v.mp4" poster="https://cdn.example/${name}.webp" controls></video>`;
    await openProjectEditor(harness, `${poster('a')}\n\n<!-- block -->\n\n${poster('b')}\n\n<!-- block -->\n\nText`);
    const pending = holdSaves();
    blockWrappers()[0]!.querySelector<HTMLButtonElement>('.block-delete-btn')!.click();
    await settle(AUTO_SAVE_MS);
    expect(harness.lastSave().cleanup_candidates).toEqual(['https://cdn.example/a.webp']);

    blockWrappers()[0]!.querySelector<HTMLButtonElement>('.block-delete-btn')!.click();
    pending[0]!();
    await settle(AUTO_SAVE_MS);

    expect(harness.lastSave().cleanup_candidates).toEqual(['https://cdn.example/b.webp']);
  });

  it('does not overwrite a slug typed while the rename was saving', async () => {
    await openProjectEditor(harness, 'Hello');
    const pending = holdSaves();
    const slugInput = document.querySelector<HTMLInputElement>('#inline-settings-slug')!;
    slugInput.value = 'new';
    slugInput.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(AUTO_SAVE_MS);

    slugInput.value = 'newer';
    slugInput.dispatchEvent(new Event('input', { bubbles: true }));
    pending[0]!();
    await settle();

    expect(slugInput.value).toBe('newer');
    await settle(AUTO_SAVE_MS);
    expect(harness.lastSave()).toMatchObject({ slug: 'newer', original_slug: 'new' });
  });

  it('the Save button waits for the save in flight, and leaves only once everything is saved', async () => {
    await openProjectEditor(harness, 'Hello');
    const pending = holdSaves();
    typeInLine('First');
    await settle(AUTO_SAVE_MS);

    typeInLine('Second');
    toolbarButton('save').click();
    await settle();
    expect(harness.saves()).toHaveLength(1);
    expect(harness.reload).not.toHaveBeenCalled();

    pending[0]!();
    await settle();
    expect(harness.saves().map((save) => save.markdown)).toEqual(['First', 'Second']);
    expect(harness.reload).not.toHaveBeenCalled();

    pending[1]!();
    await settle();
    expect(harness.reload).toHaveBeenCalledTimes(1);
  });

  it('Cmd+S does not resend when the save in flight covered everything', async () => {
    await openProjectEditor(harness, 'Hello');
    const pending = holdSaves();
    typeInLine('First');
    await settle(AUTO_SAVE_MS);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true }));
    pending[0]!();
    await vi.waitFor(() => expect(harness.reload).toHaveBeenCalledTimes(1));

    expect(harness.saves()).toHaveLength(1);
  });

  it('Cmd+S stops at a conflict from the save in flight', async () => {
    await openProjectEditor(harness, 'Hello');
    const pending = holdSaves();
    typeInLine('First');
    await settle(AUTO_SAVE_MS);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true }));
    pending[0]!(jsonResponse({ conflict: true }, 409));
    await vi.waitFor(() => expect(document.querySelector('.edit-conflict-banner')).not.toBeNull());
    await settle();

    expect(harness.saves()).toHaveLength(1);
    expect(harness.reload).not.toHaveBeenCalled();
  });

  it('Discard aborts the save in flight', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    let aborted = false;
    await openProjectEditor(harness, 'Hello');
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        aborted = true;
        reject(new DOMException('Aborted', 'AbortError'));
      });
    })));
    typeInLine('First');
    await settle(AUTO_SAVE_MS);

    toolbarButton('cancel').click();
    await settle();

    expect(aborted).toBe(true);
    expect(harness.reload).toHaveBeenCalledTimes(1);
  });
});

describe('unsaved-changes warning', () => {
  function leaveIsBlocked(): boolean {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }

  it('warns while dirty and stops once saved', async () => {
    await openProjectEditor(harness, 'Hello');
    expect(leaveIsBlocked()).toBe(false);

    typeInLine('Edited');
    expect(leaveIsBlocked()).toBe(true);

    await settle(AUTO_SAVE_MS);
    expect(leaveIsBlocked()).toBe(false);
  });
});

describe('conflicts', () => {
  it('stops autosaving and offers both resolutions when the server reports a conflict', async () => {
    await openProjectEditor(harness, 'Hello');
    conflictOnce('/api/save-project');
    typeInLine('Mine');
    await settle(AUTO_SAVE_MS);

    expect(statusText()).toBe('Conflict');
    expect(document.querySelector('.edit-conflict-banner')).not.toBeNull();
    await settle(RETRY_MS * 2);
    expect(harness.saves()).toHaveLength(1);
  });

  it('"Keep mine" force-saves without a base revision', async () => {
    await openProjectEditor(harness, 'Hello');
    conflictOnce('/api/save-project');
    typeInLine('Mine');
    await settle(AUTO_SAVE_MS);

    document.querySelector<HTMLButtonElement>('.edit-conflict-keep')!.click();
    await settle();

    const save = harness.lastSave();
    expect(save.force).toBe(true);
    expect(save).not.toHaveProperty('base_revision');
    expect(save.markdown).toBe('Mine');
    expect(document.querySelector('.edit-conflict-banner')).toBeNull();
    expect(statusText()).toBe('All changes saved');
    expect(notifications()).toContain('Changes saved (overwritten)');
  });

  it('"Keep mine" sends force for the about page too', async () => {
    await openAboutEditor(harness, 'About');
    conflictOnce('/api/save-about');
    typeInLine('Mine');
    await settle(AUTO_SAVE_MS);

    document.querySelector<HTMLButtonElement>('.edit-conflict-keep')!.click();
    await settle();

    expect(harness.lastSave()).toEqual({ markdown: 'Mine', force: true });
  });

  it('"Keep mine" reports a failed force save', async () => {
    await openProjectEditor(harness, 'Hello');
    harness.respond('/api/save-project', () => jsonResponse({ conflict: true }, 409));
    typeInLine('Mine');
    await settle(AUTO_SAVE_MS);

    harness.respond('/api/save-project', () => jsonResponse({ detail: 'nope' }, 500));
    document.querySelector<HTMLButtonElement>('.edit-conflict-keep')!.click();
    await settle();

    expect(statusText()).toBe('Save failed');
    expect(notifications()).toContain('Force save failed');
  });

  it('"Keep mine" replaces a pending autosave rather than racing it', async () => {
    await openProjectEditor(harness, 'Hello');
    conflictOnce('/api/save-project');
    typeInLine('Mine');
    await settle(AUTO_SAVE_MS);
    typeInLine('Mine, again');
    document.querySelector<HTMLButtonElement>('.edit-conflict-keep')!.click();
    await settle(AUTO_SAVE_MS * 2);

    expect(harness.saves()).toHaveLength(2);
    expect(harness.lastSave()).toMatchObject({ force: true, markdown: 'Mine, again' });
  });

  it('"Load theirs" reloads out of edit mode without saving', async () => {
    await openProjectEditor(harness, 'Hello');
    conflictOnce('/api/save-project');
    typeInLine('Mine');
    await settle(AUTO_SAVE_MS);
    const savesBefore = harness.saves().length;

    document.querySelector<HTMLButtonElement>('.edit-conflict-reload')!.click();
    await settle();

    expect(harness.reload).toHaveBeenCalledTimes(1);
    expect(new URL(window.location.href).searchParams.has('edit')).toBe(false);
    expect(harness.saves()).toHaveLength(savesBefore);
  });
});

describe('the Save button', () => {
  it('reloads without a request when nothing changed', async () => {
    await openProjectEditor(harness, 'Hello');
    toolbarButton('save').click();
    await settle();

    expect(harness.saves()).toHaveLength(0);
    expect(harness.reload).toHaveBeenCalledTimes(1);
  });

  it('saves immediately, then reloads out of edit mode', async () => {
    await openProjectEditor(harness, 'Hello');
    typeInLine('Edited');
    toolbarButton('save').click();
    await settle();

    expect(harness.lastSave().markdown).toBe('Edited');
    expect(harness.reload).toHaveBeenCalledTimes(1);
    expect(new URL(window.location.href).searchParams.has('edit')).toBe(false);
  });

  it('does not let a pending autosave fire after saving', async () => {
    await openProjectEditor(harness, 'Hello');
    typeInLine('Edited');
    toolbarButton('save').click();
    await settle(AUTO_SAVE_MS + RETRY_MS);

    expect(harness.saves()).toHaveLength(1);
  });

  it('stays in the editor and reports a failure', async () => {
    await openProjectEditor(harness, 'Hello');
    harness.respond('/api/save-project', () => jsonResponse({ detail: 'nope' }, 500));
    typeInLine('Edited');
    toolbarButton('save').click();
    await settle();

    expect(harness.reload).not.toHaveBeenCalled();
    expect(statusText()).toBe('Save failed');
    expect(notifications()).toContain('Failed to save');
  });

  it('shows the conflict banner instead of reloading', async () => {
    await openProjectEditor(harness, 'Hello');
    conflictOnce('/api/save-project');
    typeInLine('Edited');
    toolbarButton('save').click();
    await settle();

    expect(harness.reload).not.toHaveBeenCalled();
    expect(document.querySelector('.edit-conflict-banner')).not.toBeNull();
  });

  it('is disabled and labelled while a save is in flight', async () => {
    await openProjectEditor(harness, 'Hello');
    let finish!: (response: Response) => void;
    harness.respond('/api/save-project', () => new Promise<Response>((resolve) => { finish = resolve; }));
    typeInLine('Edited');
    toolbarButton('save').click();
    await settle();

    expect(toolbarButton('save').disabled).toBe(true);
    expect(toolbarButton('save').textContent).toBe('Saving...');

    finish(jsonResponse({ success: true, slug: PROJECT.slug, revision: 'rev-2' }));
    await settle();
    expect(harness.reload).toHaveBeenCalledTimes(1);
  });

  it('Cmd+S acts as Save', async () => {
    await openProjectEditor(harness, 'Hello');
    typeInLine('Edited');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true }));
    await settle();

    expect(harness.lastSave().markdown).toBe('Edited');
  });
});

describe('Discard', () => {
  it('sends no autosave while the asset cleanup is in flight', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    let finish!: (response: Response) => void;
    harness.respond('/api/cleanup-assets', () => new Promise<Response>((resolve) => { finish = resolve; }));
    await openProjectEditor(harness, '<video src="https://cdn.example/v.mp4" poster="https://cdn.example/p.webp" controls></video>\n\n<!-- block -->\n\nText');
    blockWrappers()[0]!.querySelector<HTMLButtonElement>('.block-delete-btn')!.click();
    toolbarButton('cancel').click();
    await settle(AUTO_SAVE_MS * 2);
    expect(harness.saves()).toHaveLength(0);

    finish(jsonResponse({ success: true }));
    await settle();
    expect(harness.reload).toHaveBeenCalledTimes(1);
  });

  it('asks first when dirty and stays if declined', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    await openProjectEditor(harness, 'Hello');
    typeInLine('Edited');
    toolbarButton('cancel').click();
    await settle();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(harness.reload).not.toHaveBeenCalled();
  });

  it('reloads without saving if accepted, and no autosave follows', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    await openProjectEditor(harness, 'Hello');
    typeInLine('Edited');
    toolbarButton('cancel').click();
    await settle(AUTO_SAVE_MS * 2);

    expect(harness.saves()).toHaveLength(0);
    expect(harness.reload).toHaveBeenCalledTimes(1);
    expect(new URL(window.location.href).searchParams.has('edit')).toBe(false);
  });

  it('Escape acts as Discard', async () => {
    await openProjectEditor(harness, 'Hello');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();

    expect(harness.reload).toHaveBeenCalledTimes(1);
  });

  it('removes assets the session stopped using, on projects only', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    harness.respond('/api/cleanup-assets', () => jsonResponse({ success: true }));
    await openProjectEditor(harness, '<video src="https://cdn.example/v.mp4" poster="https://cdn.example/p.webp" controls></video>\n\n<!-- block -->\n\nText');
    blockWrappers()[0]!.querySelector<HTMLButtonElement>('.block-delete-btn')!.click();
    toolbarButton('cancel').click();
    await settle();

    const cleanup = harness.calls.find((call) => call.url === '/api/cleanup-assets');
    expect(cleanup?.body).toEqual({ urls: ['https://cdn.example/p.webp'] });
  });

  it('discards on the about page without asset cleanup', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    await openAboutEditor(harness, '<video src="https://cdn.example/v.mp4" poster="https://cdn.example/p.webp" controls></video>\n\n<!-- block -->\n\nText');
    blockWrappers()[0]!.querySelector<HTMLButtonElement>('.block-delete-btn')!.click();
    toolbarButton('cancel').click();
    await settle();

    expect(harness.calls.some((call) => call.url === '/api/cleanup-assets')).toBe(false);
    expect(harness.reload).toHaveBeenCalledTimes(1);
  });
});

describe('cleanup candidates', () => {
  it('travel with the next project save and are not repeated', async () => {
    await openProjectEditor(harness, '<video src="https://cdn.example/v.mp4" poster="https://cdn.example/p.webp" controls></video>\n\n<!-- block -->\n\nText');
    blockWrappers()[0]!.querySelector<HTMLButtonElement>('.block-delete-btn')!.click();
    await settle(AUTO_SAVE_MS);
    expect(harness.lastSave().cleanup_candidates).toEqual(['https://cdn.example/p.webp']);

    typeInLine('More');
    await settle(AUTO_SAVE_MS);
    expect(harness.lastSave()).not.toHaveProperty('cleanup_candidates');
  });
});

describe('renaming the slug', () => {
  it('keeps saving under the new slug and moves the URL once the server accepts it', async () => {
    await openProjectEditor(harness, 'Hello');
    const slugInput = document.querySelector<HTMLInputElement>('#inline-settings-slug')!;
    slugInput.value = 'new-slug';
    slugInput.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(AUTO_SAVE_MS);

    expect(harness.lastSave()).toMatchObject({ slug: 'new-slug', original_slug: PROJECT.slug });
    expect(window.location.pathname).toBe('/new-slug');

    typeInLine('More');
    await settle(AUTO_SAVE_MS);
    expect(harness.lastSave()).toMatchObject({ slug: 'new-slug', original_slug: 'new-slug' });
  });
});

describe('project metadata', () => {
  it('sends edited fields with the next save', async () => {
    await openProjectEditor(harness, 'Hello');
    const nameInput = document.querySelector<HTMLInputElement>('.edit-project-header-name-input')!;
    nameInput.value = 'Renamed';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    const pinned = document.querySelector<HTMLInputElement>('#inline-settings-pinned')!;
    pinned.checked = true;
    pinned.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(AUTO_SAVE_MS);

    expect(harness.lastSave()).toMatchObject({ name: 'Renamed', pinned: true, markdown: 'Hello' });
    expect(document.querySelector('.edit-project-name')?.textContent).toBe('Editing: Renamed');
  });
});

describe('keys pressed in the header inputs', () => {
  function nameInput(): HTMLInputElement {
    const input = document.querySelector<HTMLInputElement>('.edit-project-header-name-input')!;
    input.focus();
    return input;
  }

  it('Cmd+S saves', async () => {
    await openProjectEditor(harness, 'Hello');
    typeInLine('Edited');
    pressKey(nameInput(), 's', { metaKey: true });
    await settle();

    expect(harness.lastSave().markdown).toBe('Edited');
  });

  it('Escape discards', async () => {
    await openProjectEditor(harness, 'Hello');
    pressKey(nameInput(), 'Escape');
    await settle();

    expect(harness.reload).toHaveBeenCalledTimes(1);
  });

  it('Cmd+Z undoes', async () => {
    await openProjectEditor(harness, 'Hello');
    typeInLine('Edited');
    await settle(500);
    pressKey(nameInput(), 'z', { metaKey: true });

    expect(lineInputs()[0]?.value).toBe('Hello');
  });
});

describe('deleting the project', () => {
  it('asks, deletes, and leaves for the homepage', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    harness.respond(`DELETE /api/project/${PROJECT.slug}`, () => jsonResponse({ success: true }));
    await openProjectEditor(harness, 'Hello');
    toolbarButton('delete').click();
    await settle();

    expect(harness.calls.some((call) => call.method === 'DELETE' && call.url === `/api/project/${PROJECT.slug}`)).toBe(true);
    expect(harness.navigations).toEqual(['http://localhost/']);
  });

  it('does nothing if declined', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    await openProjectEditor(harness, 'Hello');
    toolbarButton('delete').click();
    await settle();

    expect(harness.calls.some((call) => call.method === 'DELETE')).toBe(false);
  });

  it('is not offered on the about page', async () => {
    await openAboutEditor(harness, 'About');
    expect(document.querySelector('.edit-mode-toolbar [data-action="delete"]')).toBeNull();
  });
});

describe('opening the editor', () => {
  it('opens one session even when asked twice while loading', async () => {
    mountProjectPage();
    harness.respond(`/api/project/${PROJECT.slug}`, () => jsonResponse({ ...PROJECT, markdown: 'Hello' }));
    const { openEditor } = await import('../../static/ts/edit/session');
    const { projectPage } = await import('../../static/ts/edit/page-adapter');
    await Promise.all([openEditor(projectPage(PROJECT.slug)), openEditor(projectPage(PROJECT.slug))]);

    expect(document.querySelectorAll('.edit-mode-toolbar')).toHaveLength(1);
    expect(blockWrappers()).toHaveLength(1);
  });

  it('stops answering keys and page events after leaving', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    await openProjectEditor(harness, 'Hello');
    typeInLine('Edited');
    toolbarButton('cancel').click();
    await settle();
    harness.reload.mockClear();

    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();

    expect(unload.defaultPrevented).toBe(false);
    expect(harness.reload).not.toHaveBeenCalled();
  });

  it('hides the project\'s own controls and shows the editing panel above the hero', async () => {
    await openProjectEditor(harness, 'Hello');

    expect(document.querySelector('.edit-buttons')?.classList.contains('edit-controls-hidden')).toBe(true);
    expect(document.querySelector('.edit-inline-top-controls')?.nextElementSibling?.classList.contains('video-container')).toBe(true);
  });

  it('marks the URL and the body, and replaces the page content with blocks', async () => {
    await openProjectEditor(harness, 'One\n\n<!-- block -->\n\nTwo');

    expect(new URL(window.location.href).searchParams.has('edit')).toBe(true);
    expect(window.history.state).toMatchObject({ homepage: true, slug: PROJECT.slug });
    expect(document.body.classList.contains('editing')).toBe(true);
    expect(blockWrappers()).toHaveLength(2);
    expect(document.querySelector('.edit-project-name')?.textContent).toBe('Editing: Sample Project');
    expect(statusText()).toBe('No unsaved changes');
  });

  it('labels the about page and shows no project controls', async () => {
    await openAboutEditor(harness, 'About');

    expect(document.querySelector('.edit-project-name')?.textContent).toBe('Editing: About Page');
    expect(document.querySelector('.edit-inline-top-controls')).toBeNull();
  });

  it('reports a failed load and stays out of edit mode', async () => {
    mountFailingProject(harness);
    const { openEditor } = await import('../../static/ts/edit/session');
  const { projectPage } = await import('../../static/ts/edit/page-adapter');
    await openEditor(projectPage(PROJECT.slug));

    expect(notifications()).toContain('Failed to load project');
    expect(document.body.classList.contains('editing')).toBe(false);
  });
});

function mountFailingProject(h: EditorHarness): void {
  document.body.innerHTML = '<section class="project-content"></section>';
  h.respond(`/api/project/${PROJECT.slug}`, () => jsonResponse({ detail: 'gone' }, 404));
}

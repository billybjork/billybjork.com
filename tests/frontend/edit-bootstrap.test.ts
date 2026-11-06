import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  installHarness,
  jsonResponse,
  mountAboutPage,
  mountProjectPage,
  PROJECT,
  registerRuntime,
  type EditorHarness,
} from './edit-harness';

let harness: EditorHarness;

beforeEach(() => {
  harness = installHarness();
  harness.respond(`/api/project/${PROJECT.slug}`, () => jsonResponse({ ...PROJECT, markdown: 'Body' }));
  harness.respond('/api/about', () => jsonResponse({ markdown: 'About', revision: 'rev-1' }));
});

afterEach(() => {
  harness.teardown();
});

async function flushAsyncWork(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
}

async function boot(): Promise<void> {
  const { init } = await import('../../static/ts/edit/bootstrap');
  init();
  await flushAsyncWork();
}

function fetched(url: string): boolean {
  return harness.calls.some((call) => call.url === url);
}

function pressEdit(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'e', metaKey: true }));
}

describe('entering the editor', () => {
  it('opens the about page from its header button', async () => {
    mountAboutPage();
    await boot();
    expect(document.body.classList.contains('editing')).toBe(false);

    document.querySelector<HTMLButtonElement>('.new-project-btn')!.click();
    await flushAsyncWork();

    expect(fetched('/api/about')).toBe(true);
    expect(document.body.classList.contains('editing')).toBe(true);
  });

  it('opens the about page from ?edit', async () => {
    mountAboutPage();
    window.history.replaceState(null, '', 'http://localhost/me?edit');
    await boot();

    expect(fetched('/api/about')).toBe(true);
    expect(document.querySelector('.edit-mode-toolbar')).not.toBeNull();
  });

  it('opens the about page from Cmd+E', async () => {
    mountAboutPage();
    await boot();
    pressEdit();
    await flushAsyncWork();

    expect(fetched('/api/about')).toBe(true);
    expect(new URL(window.location.href).searchParams.has('edit')).toBe(true);
  });

  it('opens the open project from the homepage detail button', async () => {
    mountProjectPage();
    window.history.replaceState({ homepage: true, slug: PROJECT.slug }, '', 'http://localhost/');
    registerRuntime(PROJECT.slug);
    await boot();

    document.querySelector<HTMLButtonElement>('[data-homepage-edit-project]')!.click();
    await flushAsyncWork();

    expect(fetched(`/api/project/${PROJECT.slug}`)).toBe(true);
    expect(document.body.classList.contains('editing')).toBe(true);
  });

  it('opens the project from Cmd+E and keeps the history state', async () => {
    mountProjectPage();
    registerRuntime(PROJECT.slug);
    await boot();

    pressEdit();
    await flushAsyncWork();

    expect(fetched(`/api/project/${PROJECT.slug}`)).toBe(true);
    expect(new URL(window.location.href).searchParams.has('edit')).toBe(true);
    expect(window.history.state).toMatchObject({ homepage: true, slug: PROJECT.slug });
  });

  it('opens the project from ?edit', async () => {
    mountProjectPage();
    window.history.replaceState({}, '', `http://localhost/${PROJECT.slug}?edit`);
    registerRuntime(PROJECT.slug);
    await boot();

    expect(fetched(`/api/project/${PROJECT.slug}`)).toBe(true);
  });

  it('does nothing on a page without the homepage runtime', async () => {
    mountProjectPage();
    await boot();

    pressEdit();
    await flushAsyncWork();

    expect(fetched(`/api/project/${PROJECT.slug}`)).toBe(false);
  });

  it('stays out when the project never becomes ready', async () => {
    mountProjectPage();
    registerRuntime(PROJECT.slug).waitForProjectReady = async () => null;
    await boot();

    pressEdit();
    await flushAsyncWork();

    expect(fetched(`/api/project/${PROJECT.slug}`)).toBe(false);
  });

  it('ignores Cmd+E while typing or already editing', async () => {
    mountProjectPage();
    registerRuntime(PROJECT.slug);
    await boot();

    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    pressEdit();
    await flushAsyncWork();
    expect(fetched(`/api/project/${PROJECT.slug}`)).toBe(false);

    field.blur();
    pressEdit();
    await flushAsyncWork();
    pressEdit();
    await flushAsyncWork();
    expect(harness.calls.filter((call) => call.url === `/api/project/${PROJECT.slug}`)).toHaveLength(1);
  });
});

describe('the header controls', () => {
  it('offers New Project off the about page and opens the create dialog', async () => {
    mountProjectPage();
    await boot();

    const button = document.querySelector<HTMLButtonElement>('.new-project-btn')!;
    expect(button.getAttribute('aria-label')).toBe('New Project');
    button.click();

    expect(document.querySelector('.edit-create-modal')).not.toBeNull();
  });

  it('offers the drafts toggle only on the homepage, and it remembers the choice', async () => {
    window.history.replaceState(null, '', 'http://localhost/');
    document.body.innerHTML = '<header id="main-header"><nav></nav></header>';
    await boot();

    document.querySelector<HTMLButtonElement>('.show-drafts-toggle')!.click();

    expect(harness.navigations).toEqual(['http://localhost/?show_drafts=true']);
    expect(sessionStorage.getItem('bb_show_drafts')).toBe('true');
  });

  it('remembers a show_drafts parameter it finds in the URL', async () => {
    window.history.replaceState(null, '', 'http://localhost/?show_drafts=true');
    document.body.innerHTML = '<header id="main-header"><nav></nav></header>';
    await boot();

    expect(sessionStorage.getItem('bb_show_drafts')).toBe('true');
    expect(harness.navigations).toEqual([]);
  });

  it('turns the drafts view off again', async () => {
    window.history.replaceState(null, '', 'http://localhost/?show_drafts=true');
    document.body.innerHTML = '<header id="main-header"><nav></nav></header>';
    await boot();

    document.querySelector<HTMLButtonElement>('.show-drafts-toggle')!.click();

    expect(harness.navigations).toEqual(['http://localhost/']);
    expect(sessionStorage.getItem('bb_show_drafts')).toBeNull();
  });

  it('sends the homepage back to its drafts view when the tab remembers it', async () => {
    window.history.replaceState(null, '', 'http://localhost/');
    document.body.innerHTML = '<header id="main-header"><nav></nav></header>';
    sessionStorage.setItem('bb_show_drafts', 'true');
    await boot();

    expect(harness.navigations).toEqual(['http://localhost/?show_drafts=true']);
  });
});

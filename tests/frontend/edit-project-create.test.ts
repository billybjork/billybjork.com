import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installHarness, jsonResponse, notifications, type EditorHarness } from './edit-harness';

let harness: EditorHarness;

beforeEach(() => {
  harness = installHarness();
});

afterEach(() => {
  harness.teardown();
});

async function open(): Promise<void> {
  const { showProjectCreateDialog } = await import('../../static/ts/edit/project-create');
  showProjectCreateDialog();
}

function field(id: string): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(`#${id}`)!;
}

function typeName(name: string): void {
  field('project-name').value = name;
  field('project-name').dispatchEvent(new Event('input', { bubbles: true }));
}

function flush(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe('creating a project', () => {
  it('suggests a slug as the name is typed', async () => {
    await open();
    typeName('Crème Brûlée!');
    expect(field('project-slug').value).toBe('creme-brulee');
  });

  it('creates it as a draft by default and goes to it', async () => {
    harness.respond('/api/create-project', () => jsonResponse({ success: true, slug: 'new-thing' }));
    await open();
    typeName('New Thing');
    document.querySelector('form')!.requestSubmit();
    await flush();

    const call = harness.calls.find((candidate) => candidate.url === '/api/create-project');
    expect(call?.body).toMatchObject({ name: 'New Thing', slug: 'new-thing', draft: true, pinned: false, markdown: '' });
    expect(harness.navigations).toEqual(['http://localhost/new-thing']);
    expect(document.querySelector('.edit-create-modal')).toBeNull();
  });

  it('carries the drafts view to the new project', async () => {
    sessionStorage.setItem('bb_show_drafts', 'true');
    harness.respond('/api/create-project', () => jsonResponse({ success: true, slug: 'new-thing' }));
    await open();
    typeName('New Thing');
    document.querySelector('form')!.requestSubmit();
    await flush();

    expect(harness.navigations).toEqual(['http://localhost/new-thing?show_drafts=true']);
  });

  it('blocks a slug the server would reject before any request', async () => {
    await open();
    typeName('Fine');
    field('project-slug').value = 'Not Valid';
    document.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();

    expect(harness.calls).toHaveLength(0);
    expect(document.querySelector('.edit-create-modal')).not.toBeNull();
  });

  it('shows the server\'s refusal and stays open', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    harness.respond('/api/create-project', () => jsonResponse({ detail: 'Project with this slug already exists' }, 400));
    await open();
    typeName('Taken');
    document.querySelector('form')!.requestSubmit();
    await flush();

    expect(notifications()).toContain('Project with this slug already exists');
    expect(document.querySelector('.edit-create-modal')).not.toBeNull();
  });

  it.each([
    ['Escape', () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))],
    ['Cancel', () => document.querySelector<HTMLButtonElement>('#create-cancel')!.click()],
    ['the overlay', () => document.querySelector<HTMLElement>('.edit-create-overlay')!.click()],
  ])('%s closes it and unlocks scrolling', async (_name, closeIt) => {
    await open();
    expect(document.body.classList.contains('modal-open')).toBe(true);

    closeIt();

    expect(document.querySelector('.edit-create-modal')).toBeNull();
    expect(document.body.classList.contains('modal-open')).toBe(false);
  });
});

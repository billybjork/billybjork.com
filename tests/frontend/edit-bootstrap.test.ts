import { describe, expect, it, vi } from 'vitest';

import { registerHomepageRuntime } from '../../static/ts/core/runtime-registry';

type EditModeWindow = Window & typeof globalThis & {
  EditMode?: {
    init: ReturnType<typeof vi.fn>;
    initAbout: ReturnType<typeof vi.fn>;
  };
  ProjectCreate?: {
    show: ReturnType<typeof vi.fn>;
  };
};

function setBootstrapFixture(pathname: string): void {
  window.history.replaceState({ homepage: true, slug: pathname === '/project-one' ? 'project-one' : null }, '', `http://localhost${pathname}`);
  document.body.dataset.editMode = 'true';
  document.body.innerHTML = `
    <header id="main-header">
      <h1><a href="/" class="site-title">Billy Bjork</a></h1>
      <nav></nav>
    </header>
    <section id="homepage-detail-scene" data-open-project-slug="project-one">
      <button type="button" data-homepage-edit-project data-project-slug="project-one">Edit</button>
      <section id="homepage-detail-content">
        <div class="project-content"><p>Editable content</p></div>
      </section>
    </section>
  `;

  const win = window as EditModeWindow;
  win.EditMode = {
    init: vi.fn(),
    initAbout: vi.fn(),
  };
  win.ProjectCreate = {
    show: vi.fn(),
  };
}

async function flushAsyncWork(iterations: number = 4): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
}

describe('Edit bootstrap', () => {
  it('supports about-page header entry, homepage detail entry, and Cmd+E without losing history state', async () => {
    setBootstrapFixture('/me');
    registerHomepageRuntime({
      getOpenProjectSlug: () => 'project-one',
      waitForProjectReady: async () => 'project-one',
      renameProjectSlug: vi.fn(),
    });

    const { default: EditBootstrap } = await import('../../static/ts/edit/bootstrap');
    EditBootstrap.init();
    await flushAsyncWork();

    const headerButton = document.querySelector<HTMLButtonElement>('.new-project-btn');
    headerButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsyncWork();

    expect((window as EditModeWindow).EditMode?.initAbout).toHaveBeenCalledTimes(1);

    window.history.replaceState({ homepage: true, slug: 'project-one' }, '', 'http://localhost/');
    const detailButton = document.querySelector<HTMLButtonElement>('[data-homepage-edit-project]');
    detailButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsyncWork();

    expect((window as EditModeWindow).EditMode?.init).toHaveBeenCalledWith('project-one');

    window.history.replaceState({ homepage: true, slug: 'project-one' }, '', 'http://localhost/project-one');
    document.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'e',
      metaKey: true,
    }));
    await flushAsyncWork();

    expect((window as EditModeWindow).EditMode?.init).toHaveBeenCalledWith('project-one');
    expect(new URL(window.location.href).searchParams.has('edit')).toBe(true);
    expect(window.history.state).toMatchObject({ homepage: true, slug: 'project-one' });

    registerHomepageRuntime(null);
  });
});

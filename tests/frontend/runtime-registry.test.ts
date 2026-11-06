import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadBundleCopy() {
  vi.resetModules();
  return import('../../static/ts/core/runtime-registry');
}

const runtime = {
  getOpenProjectSlug: () => null,
  waitForProjectReady: async () => null,
  renameProjectSlug: () => {},
};

afterEach(() => {
  delete window.__bbHomepageRuntime;
});

describe('homepage runtime across bundles', () => {
  it('reaches another bundle, which holds its own copy of the module', async () => {
    const homepageBundle = await loadBundleCopy();
    homepageBundle.registerHomepageRuntime(runtime);

    const editBundle = await loadBundleCopy();
    expect(editBundle.getHomepageRuntime).not.toBe(homepageBundle.getHomepageRuntime);
    expect(editBundle.getHomepageRuntime()).toBe(runtime);
  });

  it('is absent on a page without the homepage bundle', async () => {
    const editBundle = await loadBundleCopy();
    expect(editBundle.getHomepageRuntime()).toBeNull();
  });
});

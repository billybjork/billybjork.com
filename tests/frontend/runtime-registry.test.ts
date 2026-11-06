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

afterEach(async () => {
  (await loadBundleCopy()).registerHomepageRuntime(null);
  vi.useRealTimers();
});

describe('homepage runtime across bundles', () => {
  it('wakes a waiter in another bundle as soon as the runtime registers', async () => {
    const homepageBundle = await loadBundleCopy();
    const editBundle = await loadBundleCopy();
    expect(editBundle.waitForHomepageRuntime).not.toBe(homepageBundle.waitForHomepageRuntime);

    vi.useFakeTimers();
    const waiting = editBundle.waitForHomepageRuntime(1500);
    homepageBundle.registerHomepageRuntime(runtime);

    await expect(waiting).resolves.toBe(runtime);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('finds a runtime another bundle registered earlier', async () => {
    const homepageBundle = await loadBundleCopy();
    homepageBundle.registerHomepageRuntime(runtime);

    const editBundle = await loadBundleCopy();
    expect(editBundle.getHomepageRuntime()).toBe(runtime);
    await expect(editBundle.waitForHomepageRuntime()).resolves.toBe(runtime);
  });

  it('gives up with null at the timeout when no homepage ever registers', async () => {
    const editBundle = await loadBundleCopy();
    vi.useFakeTimers();

    const waiting = editBundle.waitForHomepageRuntime(1500);
    vi.advanceTimersByTime(1500);

    await expect(waiting).resolves.toBeNull();
  });
});

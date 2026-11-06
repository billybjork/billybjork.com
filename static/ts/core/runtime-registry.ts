export interface HomepageRuntimeApi {
  getOpenProjectSlug(): string | null;
  waitForProjectReady(slug?: string | null, timeoutMs?: number): Promise<string | null>;
  renameProjectSlug(previousSlug: string, nextSlug: string): void;
}

declare global {
  interface Window {
    __bbHomepageRuntime?: HomepageRuntimeApi;
  }
}

/**
 * homepage.js and edit.js are separate bundles, each with its own copy of this
 * module, so the runtime and its wake-up have to travel through `window`.
 */
const RUNTIME_CHANGED_EVENT = 'bb:homepage-runtime-changed';

export function registerHomepageRuntime(runtime: HomepageRuntimeApi | null): void {
  if (runtime) {
    window.__bbHomepageRuntime = runtime;
  } else {
    delete window.__bbHomepageRuntime;
  }
  window.dispatchEvent(new CustomEvent(RUNTIME_CHANGED_EVENT));
}

export function getHomepageRuntime(): HomepageRuntimeApi | null {
  return window.__bbHomepageRuntime ?? null;
}

export function waitForHomepageRuntime(timeoutMs: number = 2000): Promise<HomepageRuntimeApi | null> {
  const existing = getHomepageRuntime();
  if (existing) {
    return Promise.resolve(existing);
  }

  return new Promise((resolve) => {
    const finish = (): void => {
      window.removeEventListener(RUNTIME_CHANGED_EVENT, finish);
      clearTimeout(timeoutId);
      resolve(getHomepageRuntime());
    };
    const timeoutId = window.setTimeout(finish, timeoutMs);
    window.addEventListener(RUNTIME_CHANGED_EVENT, finish);
  });
}

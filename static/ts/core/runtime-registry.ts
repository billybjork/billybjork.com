export interface HomepageRuntimeApi {
  /** The project the detail scene shows or is opening. */
  getOpenProjectSlug(): string | null;
  /** Settles when the scene comes to rest: with the slug if it shows that project, otherwise null. */
  waitForProjectReady(slug: string): Promise<string | null>;
  /** Moves the URL to a project's new slug. Editing ends in a navigation, so nothing else needs to follow. */
  renameProjectSlug(nextSlug: string): void;
}

declare global {
  interface Window {
    __bbHomepageRuntime?: HomepageRuntimeApi;
  }
}

/**
 * homepage.js and edit.js are separate bundles, each with its own copy of this module, so the
 * runtime travels through `window`. Both are deferred, homepage.js first, so edit.js finds it
 * registered on any page that has one.
 */
export function registerHomepageRuntime(runtime: HomepageRuntimeApi): void {
  window.__bbHomepageRuntime = runtime;
}

export function getHomepageRuntime(): HomepageRuntimeApi | null {
  return window.__bbHomepageRuntime ?? null;
}

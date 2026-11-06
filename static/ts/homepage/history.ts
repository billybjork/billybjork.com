import { projectSlugFromPath } from '../core/project-path';
import { withShowDrafts } from '../core/show-drafts';

export function currentProjectSlug(): string | null {
  return projectSlugFromPath(window.location.pathname);
}

function buildProjectUrl(slug: string | null, preserveHash: boolean): string {
  const url = new URL(withShowDrafts('/'));
  if (slug) {
    url.pathname = `/${encodeURIComponent(slug)}`;
    if (preserveHash && currentProjectSlug() === slug) {
      url.hash = window.location.hash;
    }
  }
  return url.toString();
}

export function pushProjectUrl(slug: string | null): void {
  const nextUrl = buildProjectUrl(slug, false);
  if (window.location.href !== nextUrl) {
    window.history.pushState(null, '', nextUrl);
  }
}

/** Puts back the URL of the project being edited, in the form the editor gave it, after history moved away. */
export function restoreEditingUrl(slug: string): void {
  const url = new URL(buildProjectUrl(slug, false));
  url.searchParams.set('edit', '');
  window.history.pushState(null, '', url.toString());
}

export function replaceProjectUrl(slug: string | null, options: { preserveHash?: boolean } = {}): void {
  window.history.replaceState(null, '', buildProjectUrl(slug, options.preserveHash === true));
}

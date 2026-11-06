import { projectSlugFromPath } from '../core/project-path';

const QUERY_KEEP_KEYS = ['show_drafts'];

export function currentProjectSlug(): string | null {
  return projectSlugFromPath(window.location.pathname);
}

function buildProjectUrl(slug: string | null, preserveHash: boolean): string {
  const url = new URL('/', window.location.origin);
  const current = new URL(window.location.href);
  QUERY_KEEP_KEYS.forEach((key) => {
    const value = current.searchParams.get(key);
    if (value) {
      url.searchParams.set(key, value);
    }
  });

  if (slug) {
    url.pathname = `/${encodeURIComponent(slug)}`;
    if (preserveHash && currentProjectSlug() === slug) {
      url.hash = current.hash;
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

export function replaceProjectUrl(slug: string | null, options: { preserveHash?: boolean } = {}): void {
  window.history.replaceState(null, '', buildProjectUrl(slug, options.preserveHash === true));
}

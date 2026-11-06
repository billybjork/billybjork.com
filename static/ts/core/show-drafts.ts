const STORAGE_KEY = 'bb_show_drafts';
const QUERY_PARAM = 'show_drafts';

/** Public pages read this too, and a browser can refuse storage access outright. */
function isRemembered(): boolean {
  try {
    return sessionStorage.getItem(STORAGE_KEY) === 'true';
  } catch (error) {
    console.warn('Could not read the remembered drafts view:', error);
    return false;
  }
}

/** The URL's show_drafts parameter wins; otherwise what this tab remembers. */
export function isShowDraftsActive(): boolean {
  const value = new URLSearchParams(window.location.search).get(QUERY_PARAM);
  return value === null ? isRemembered() : value === 'true';
}

export function rememberShowDrafts(active: boolean): void {
  if (active) {
    sessionStorage.setItem(STORAGE_KEY, 'true');
  } else {
    sessionStorage.removeItem(STORAGE_KEY);
  }
}

export function withShowDrafts(url: string): string {
  const next = new URL(url, window.location.origin);
  if (isShowDraftsActive()) {
    next.searchParams.set(QUERY_PARAM, 'true');
  }
  return next.toString();
}

export function withoutShowDrafts(url: string): string {
  const next = new URL(url, window.location.origin);
  next.searchParams.delete(QUERY_PARAM);
  return next.toString();
}

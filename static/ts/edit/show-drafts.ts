const SHOW_DRAFTS_KEY = 'bb_show_drafts';

/** The `show_drafts` query parameter wins and is remembered for the tab. */
export function isShowDraftsActive(): boolean {
  const params = new URLSearchParams(window.location.search);
  if (params.has('show_drafts')) {
    const isActive = params.get('show_drafts') === 'true';
    setShowDraftsRemembered(isActive);
    return isActive;
  }
  return sessionStorage.getItem(SHOW_DRAFTS_KEY) === 'true';
}

export function setShowDraftsRemembered(active: boolean): void {
  if (active) {
    sessionStorage.setItem(SHOW_DRAFTS_KEY, 'true');
  } else {
    sessionStorage.removeItem(SHOW_DRAFTS_KEY);
  }
}

export function withShowDrafts(url: string): string {
  const next = new URL(url, window.location.origin);
  if (isShowDraftsActive()) {
    next.searchParams.set('show_drafts', 'true');
  }
  return next.toString();
}

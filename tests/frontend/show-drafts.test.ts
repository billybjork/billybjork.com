import { describe, expect, it, vi } from 'vitest';

import { isShowDraftsActive, rememberShowDrafts, withoutShowDrafts, withShowDrafts } from '../../static/ts/core/show-drafts';

describe('the drafts view', () => {
  it('follows the URL over what the tab remembers', () => {
    sessionStorage.setItem('bb_show_drafts', 'true');
    window.history.replaceState(null, '', '/?show_drafts=false');
    expect(isShowDraftsActive()).toBe(false);

    window.history.replaceState(null, '', '/?show_drafts=true');
    sessionStorage.clear();
    expect(isShowDraftsActive()).toBe(true);
  });

  it('falls back to what the tab remembers', () => {
    expect(isShowDraftsActive()).toBe(false);
    rememberShowDrafts(true);
    expect(isShowDraftsActive()).toBe(true);
    rememberShowDrafts(false);
    expect(isShowDraftsActive()).toBe(false);
  });

  it('reading it does not write anything', () => {
    window.history.replaceState(null, '', '/?show_drafts=true');
    expect(isShowDraftsActive()).toBe(true);
    expect(sessionStorage.getItem('bb_show_drafts')).toBeNull();
  });

  it('survives a browser that refuses storage', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Denied', 'SecurityError');
    });
    expect(isShowDraftsActive()).toBe(false);
  });

  it('adds itself to a URL only while active, and comes off again', () => {
    expect(withShowDrafts('/a?_partial=1')).toBe('http://localhost/a?_partial=1');
    rememberShowDrafts(true);
    expect(withShowDrafts('/a?_partial=1')).toBe('http://localhost/a?_partial=1&show_drafts=true');
    expect(withoutShowDrafts('http://localhost/a?show_drafts=true')).toBe('http://localhost/a');
  });
});

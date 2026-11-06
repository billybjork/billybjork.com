import { beforeEach, describe, expect, it, vi } from 'vitest';

import '../../static/ts/about/index';
import { flushAsyncWork } from './homepage-fixture';

function clickHitMeUp(): void {
  document.body.innerHTML = `
    <section class="about-details">
      <a id="hit-me-up" href="#" class="copy-text-link" data-copy-text="billy@billybjork.com" data-notification-message="Email copied to clipboard!">Hit me up!</a>
    </section>`;
  document.getElementById('hit-me-up')?.click();
}

describe('the about page bundle', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/me');
  });

  it('copies the email from the link and confirms it, without following the href', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    clickHitMeUp();
    await flushAsyncWork();

    expect(writeText).toHaveBeenCalledWith('billy@billybjork.com');
    const notification = document.querySelector('.copy-notification');
    expect(notification?.textContent).toBe('Email copied to clipboard!');
    expect(notification?.classList.contains('error')).toBe(false);
    expect(window.location.hash).toBe('');
  });

  it('says so when the browser refuses the copy', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => { throw new Error('denied'); }) } });

    clickHitMeUp();
    await flushAsyncWork();

    const notification = document.querySelector('.copy-notification');
    expect(notification?.textContent).toBe('Failed to copy to clipboard.');
    expect(notification?.classList.contains('error')).toBe(true);
  });
});

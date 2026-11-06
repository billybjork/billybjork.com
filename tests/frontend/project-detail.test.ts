import { describe, expect, it } from 'vitest';

import { hydrateProjectDetail } from '../../static/ts/project/detail-runtime';

function encodeUtf8Base64(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

describe('hydrateProjectDetail', () => {
  it('renders HTML blocks with their non-ASCII text intact', () => {
    document.body.innerHTML = `
      <section class="project-content">
        <div class="html-block-sandbox" data-html-b64="${encodeUtf8Base64('<p>café — ✓ 日本語</p>')}"></div>
      </section>
    `;

    hydrateProjectDetail(document.body);

    expect(document.querySelector('iframe.html-block-sandbox')?.getAttribute('srcdoc')).toContain('<p>café — ✓ 日本語</p>');
  });

  it('loads lazy inline videos, marks lightbox triggers, and opens external links in a new tab', () => {
    document.body.innerHTML = `
      <section class="project-content">
        <video id="clip" class="lazy-inline-video" data-src="http://localhost/clip.mp4" loop muted>
          <source data-src="http://localhost/clip.webm">
        </video>
        <a id="outside" href="https://elsewhere.test/page">Out</a>
        <a id="inside" href="/other-project">In</a>
        <a id="mail" href="mailto:a@b.test">Mail</a>
      </section>
    `;

    hydrateProjectDetail(document.body);

    const clip = document.getElementById('clip') as HTMLVideoElement;
    expect(clip.src).toBe('http://localhost/clip.mp4');
    expect(clip.querySelector('source')?.src).toBe('http://localhost/clip.webm');
    expect(clip.classList.contains('lightbox-trigger-video')).toBe(true);
    expect(document.getElementById('outside')?.getAttribute('target')).toBe('_blank');
    expect(document.getElementById('outside')?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(document.getElementById('inside')?.hasAttribute('target')).toBe(false);
    expect(document.getElementById('mail')?.hasAttribute('target')).toBe(false);
  });
});

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
});

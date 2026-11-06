import { describe, expect, it } from 'vitest';

import { parseAlignmentFromStyle } from '../../static/ts/core/alignment';
import { createSandboxedIframe } from '../../static/ts/core/html-sandbox';

function mount(style?: string, align?: 'left' | 'center' | 'right'): HTMLIFrameElement {
  const iframe = createSandboxedIframe('<p>Hi</p>', style, align);
  document.body.appendChild(iframe);
  iframe.dispatchEvent(new Event('load'));
  return iframe;
}

function report(source: MessageEventSource | null, height: number): void {
  window.dispatchEvent(new MessageEvent('message', { source, data: { type: 'sandbox-resize', height } }));
}

describe('sandboxed iframes', () => {
  it('run scripts with no same-origin access, and may go fullscreen', () => {
    const iframe = mount();
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe.getAttribute('allow')).toBe('fullscreen');
    expect(iframe.srcdoc).toContain('<p>Hi</p>');
  });

  it('resize from their own window only', () => {
    const iframe = mount();
    const other = mount();

    report(iframe.contentWindow, 300);
    expect(iframe.style.height).toBe('300px');
    expect(other.style.height).toBe('');

    report(window, 999);
    expect(iframe.style.height).toBe('300px');
  });

  it('keep a height their style sets', () => {
    const iframe = mount('height: 240px');
    expect(iframe.dataset.autoHeight).toBe('false');

    report(iframe.contentWindow, 900);
    expect(iframe.style.height).toBe('240px');
  });

  it('scale proportionally when the style sets both sizes', () => {
    const iframe = mount('width: 400px; height: 200px');
    expect(iframe.style.width).toBe('400px');
    expect(iframe.style.aspectRatio).toBe('400 / 200');
  });

  it('align from the given alignment, or else their style', () => {
    expect(mount('margin-left: auto; margin-right: auto').style.marginRight).toBe('auto');
    expect(mount('margin-left: auto').style.marginRight).toBe('0px');
    expect(mount(undefined, 'center').style.marginLeft).toBe('auto');
    expect(mount('margin-left: auto', 'left').style.marginLeft).toBe('');
  });
});

describe('parseAlignmentFromStyle', () => {
  it.each([
    [null, 'left'],
    ['width: 10px', 'left'],
    ['margin-right: auto', 'left'],
    ['margin-left:auto', 'right'],
    ['display: block; margin-left: auto !important', 'right'],
    ['margin-left: auto; margin-right: auto', 'center'],
    ['margin-left:  auto;margin-right:auto;', 'center'],
    ['margin-left: 0 auto', 'left'],
  ])('reads %j as %s', (style, expected) => {
    expect(parseAlignmentFromStyle(style)).toBe(expected);
  });
});

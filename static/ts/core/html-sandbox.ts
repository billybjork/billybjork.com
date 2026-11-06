import { applyAlignment, parseAlignmentFromStyle, type Alignment } from './alignment';

const PX_SIZE_VALUE_PATTERN = /^\s*([0-9]*\.?[0-9]+)\s*px(?:\s*!important)?\s*$/i;

const iframesByWindow = new WeakMap<Window, HTMLIFrameElement>();

let listenerInitialized = false;

/**
 * Sandboxed content is untrusted. event.source cannot be forged, so a frame can only ever
 * resize itself; a secret passed into the frame would be readable by that same content.
 */
function initGlobalResizeListener(): void {
  if (listenerInitialized) return;
  listenerInitialized = true;

  window.addEventListener('message', (e: MessageEvent) => {
    if (!e.source || typeof e.data !== 'object') return;
    if (e.data?.type !== 'sandbox-resize') return;

    const iframe = iframesByWindow.get(e.source as Window);
    if (iframe?.dataset.autoHeight === 'true') {
      iframe.style.height = `${e.data.height}px`;
    }
  });
}

export function styleDeclares(style: string | null | undefined, property: 'width' | 'height'): boolean {
  return !!style && new RegExp(`(^|;)\\s*${property}\\s*:`).test(style);
}

/** A frame whose style sets a height keeps it; otherwise it grows to fit its content. */
export function syncSandboxAutoHeight(iframe: HTMLIFrameElement, style: string | null | undefined): void {
  iframe.dataset.autoHeight = styleDeclares(style, 'height') ? 'false' : 'true';
}

function extractPixelDimension(style: string, property: 'width' | 'height'): number | null {
  const pattern = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'i');
  const match = style.match(pattern);
  if (!match) return null;

  const size = match[1]?.match(PX_SIZE_VALUE_PATTERN);
  if (!size) return null;

  const value = Number.parseFloat(size[1] ?? '');
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function applySandboxInlineStyle(iframe: HTMLIFrameElement, inlineStyle: string | null | undefined, align: Alignment | undefined): void {
  syncSandboxAutoHeight(iframe, inlineStyle);
  if (inlineStyle) {
    iframe.style.cssText += `; ${inlineStyle}`;
  }
  applyAlignment(iframe, align ?? parseAlignmentFromStyle(inlineStyle));

  if (!inlineStyle) return;

  const width = extractPixelDimension(inlineStyle, 'width');
  const height = extractPixelDimension(inlineStyle, 'height');
  if (!width || !height) return;

  // Keep authored dimensions at full width, but downscale proportionally on narrow viewports.
  iframe.style.width = `${width}px`;
  iframe.style.height = 'auto';
  iframe.style.aspectRatio = `${width} / ${height}`;
  iframe.style.maxWidth = '100%';
}

function wrapHtmlContent(html: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; }
  </style>
</head>
<body>
${html}
<script>
(function() {
  function reportHeight() {
    var height = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    );
    window.parent.postMessage({ type: 'sandbox-resize', height: height }, '*');
  }
  new ResizeObserver(reportHeight).observe(document.body);
  window.addEventListener('load', reportHeight);
  reportHeight();
})();
</script>
</body>
</html>`;
}

export function createSandboxedIframe(
  html: string,
  inlineStyle: string | null | undefined,
  align?: Alignment
): HTMLIFrameElement {
  initGlobalResizeListener();

  const iframe = document.createElement('iframe');
  iframe.className = 'html-block-sandbox';
  iframe.setAttribute('allow', 'fullscreen');
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.srcdoc = wrapHtmlContent(html);
  iframe.style.minHeight = '60px';
  applySandboxInlineStyle(iframe, inlineStyle, align);

  iframe.addEventListener('load', () => {
    if (iframe.contentWindow) {
      iframesByWindow.set(iframe.contentWindow, iframe);
    }
  });

  return iframe;
}

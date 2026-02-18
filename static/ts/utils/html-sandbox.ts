/**
 * HTML Sandbox Utility
 * Provides iframe-based isolation for HTML blocks
 */

interface SandboxOptions {
  allowFullscreen?: boolean;
  allowPointerLock?: boolean;
  minHeight?: number;
}

interface IframeRegistry {
  iframe: HTMLIFrameElement;
  nonce: string;
}

// Global registry: contentWindow -> { iframe, nonce }
const iframeRegistry = new WeakMap<Window, IframeRegistry>();

// Single global message listener (set up once)
let listenerInitialized = false;

function initGlobalResizeListener(): void {
  if (listenerInitialized) return;
  listenerInitialized = true;

  window.addEventListener('message', (e: MessageEvent) => {
    if (!e.source || typeof e.data !== 'object') return;
    if (e.data?.type !== 'sandbox-resize') return;

    const entry = iframeRegistry.get(e.source as Window);
    if (!entry) return;

    // Validate nonce to prevent spoofing
    if (e.data.nonce !== entry.nonce) return;

    entry.iframe.style.height = `${e.data.height}px`;
  });
}

function generateNonce(): string {
  return crypto.randomUUID();
}

function wrapHtmlContent(html: string, nonce: string): string {
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
  var nonce = "${nonce}";
  function reportHeight() {
    var height = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    );
    window.parent.postMessage({ type: 'sandbox-resize', nonce: nonce, height: height }, '*');
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
  options: SandboxOptions = {}
): HTMLIFrameElement {
  initGlobalResizeListener();

  const iframe = document.createElement('iframe');
  iframe.className = 'html-block-sandbox';

  // Build sandbox attribute
  const sandboxParts = ['allow-scripts'];
  if (options.allowFullscreen !== false) {
    sandboxParts.push('allow-fullscreen');
    iframe.setAttribute('allow', 'fullscreen');
  }
  if (options.allowPointerLock) sandboxParts.push('allow-pointer-lock');
  iframe.setAttribute('sandbox', sandboxParts.join(' '));

  const nonce = generateNonce();
  iframe.srcdoc = wrapHtmlContent(html, nonce);
  iframe.style.minHeight = `${options.minHeight ?? 60}px`;

  // Register for resize messages
  iframe.addEventListener('load', () => {
    if (iframe.contentWindow) {
      iframeRegistry.set(iframe.contentWindow, { iframe, nonce });
    }
  });

  return iframe;
}

export function updateIframeSrcdoc(iframe: HTMLIFrameElement, html: string): void {
  const nonce = generateNonce();
  iframe.srcdoc = wrapHtmlContent(html, nonce);

  // Update registry on next load
  iframe.addEventListener('load', () => {
    if (iframe.contentWindow) {
      iframeRegistry.set(iframe.contentWindow, { iframe, nonce });
    }
  }, { once: true });
}

export function cleanupIframe(iframe: HTMLIFrameElement): void {
  if (iframe.contentWindow) {
    iframeRegistry.delete(iframe.contentWindow);
  }
}

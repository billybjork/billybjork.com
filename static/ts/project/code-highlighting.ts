const PRISM_BASE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.30.0';

let prismLoading: Promise<void> | null = null;

function appendToHead(element: HTMLScriptElement | HTMLLinkElement): Promise<void> {
  return new Promise((resolve) => {
    element.onload = () => resolve();
    document.head.appendChild(element);
  });
}

function appendScript(src: string): Promise<void> {
  const script = document.createElement('script');
  script.src = src;
  return appendToHead(script);
}

async function loadPrism(): Promise<void> {
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = `${PRISM_BASE_URL}/themes/prism-okaidia.min.css`;
  await appendToHead(stylesheet);
  await appendScript(`${PRISM_BASE_URL}/prism.min.js`);
  await appendScript(`${PRISM_BASE_URL}/components/prism-python.min.js`);
}

export function checkAndHighlightCode(targetElement: Element): void {
  if (!targetElement.querySelector('pre code')) return;

  prismLoading ??= window.Prism ? Promise.resolve() : loadPrism();
  void prismLoading.then(() => window.Prism?.highlightAllUnder(targetElement));
}

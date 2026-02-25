/**
 * Code Highlighting Module
 * Dynamically loads Prism.js for syntax highlighting
 */

// Prism.js CDN URLs
const PRISM_CSS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/themes/prism-okaidia.min.css';
const PRISM_JS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js';
const PRISM_PYTHON_URL = 'https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-python.min.js';

/**
 * Dynamically load a JavaScript file
 */
function loadScript(url: string, callback?: () => void): void {
  const script = document.createElement('script');
  script.type = 'text/javascript';

  script.onload = function() {
    if (callback) callback();
  };

  script.src = url;
  document.head.appendChild(script);
}

/**
 * Dynamically load a CSS file
 */
function loadCSS(url: string, callback?: () => void): void {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;

  link.onload = function() {
    if (callback) callback();
  };

  document.head.appendChild(link);
}

/**
 * Load Prism.js and its CSS
 */
function loadPrism(callback?: () => void): void {
  loadCSS(PRISM_CSS_URL, function() {
    loadScript(PRISM_JS_URL, function() {
      // Load the necessary language components
      loadScript(PRISM_PYTHON_URL, function() {
        if (callback) callback();
      });
    });
  });
}

/**
 * Check for code snippets and highlight them
 */
export function checkAndHighlightCode(targetElement: Element): void {
  if (targetElement.querySelector('pre code')) {
    if (typeof window.Prism === 'undefined') {
      loadPrism(function() {
        window.Prism?.highlightAllUnder(targetElement);
      });
    } else {
      window.Prism.highlightAllUnder(targetElement);
    }
  }
}

export default {
  checkAndHighlightCode,
};

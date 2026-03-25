import { afterEach, beforeEach, vi } from 'vitest';

class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '0px';
  readonly thresholds = [0];
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  disconnect(): void {}

  observe(target: Element): void {
    this.callback([
      {
        boundingClientRect: target.getBoundingClientRect(),
        intersectionRatio: 1,
        intersectionRect: target.getBoundingClientRect(),
        isIntersecting: true,
        rootBounds: null,
        target,
        time: Date.now(),
      } as IntersectionObserverEntry,
    ], this);
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  unobserve(): void {}
}

class MockResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

Object.defineProperty(window, 'IntersectionObserver', {
  configurable: true,
  writable: true,
  value: MockIntersectionObserver,
});

Object.defineProperty(window, 'ResizeObserver', {
  configurable: true,
  writable: true,
  value: MockResizeObserver,
});

Object.defineProperty(window, 'requestAnimationFrame', {
  configurable: true,
  writable: true,
  value: (callback: FrameRequestCallback): number => (
    window.setTimeout(() => callback(Date.now()), 0)
  ),
});

Object.defineProperty(window, 'cancelAnimationFrame', {
  configurable: true,
  writable: true,
  value: (handle: number): void => {
    window.clearTimeout(handle);
  },
});

Object.defineProperty(window, 'scrollTo', {
  configurable: true,
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(window, 'pageYOffset', {
  configurable: true,
  writable: true,
  value: 0,
});

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
  configurable: true,
  writable: true,
  value(options?: ScrollToOptions | number, y?: number): void {
    const top = typeof options === 'number' ? y ?? 0 : options?.top ?? 0;
    Object.defineProperty(this, 'scrollTop', {
      configurable: true,
      writable: true,
      value: top,
    });
  },
});

Object.defineProperty(HTMLElement.prototype, 'animate', {
  configurable: true,
  writable: true,
  value: vi.fn(() => ({
    finished: Promise.resolve(),
    cancel: vi.fn(),
  })),
});

Object.defineProperty(HTMLMediaElement.prototype, 'play', {
  configurable: true,
  writable: true,
  value: vi.fn(() => Promise.resolve()),
});

Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
  configurable: true,
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(HTMLMediaElement.prototype, 'load', {
  configurable: true,
  writable: true,
  value: vi.fn(),
});

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.body.className = '';
  document.body.dataset.editMode = 'false';
  window.sessionStorage?.clear?.();
  window.localStorage?.clear?.();
  window.history.replaceState(null, '', '/');
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

import { vi } from 'vitest';

import { registerHomepageRuntime, type HomepageRuntimeApi } from '../../static/ts/core/runtime-registry';

export interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
}

export interface EditorHarness {
  calls: RecordedCall[];
  reload: ReturnType<typeof vi.fn>;
  navigations: string[];
  saves(): Array<Record<string, unknown>>;
  lastSave(): Record<string, unknown>;
  respond(route: string, handler: (call: RecordedCall) => Response | Promise<Response>): void;
  teardown(): void;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const PROJECT = {
  slug: 'sample-project',
  name: 'Sample Project',
  date: '2024-01-15',
  pinned: false,
  draft: true,
  youtube: 'https://youtube.com/watch?v=abc',
  og_image: 'https://cdn.example/og.webp',
  video: { hls: 'https://cdn.example/hero/master.m3u8', spriteSheet: 'https://cdn.example/hero/sprite.webp' },
  revision: 'rev-1',
};

/** Records the listeners an editor session adds, so one test's session cannot answer the next test's events. */
function trackListeners(): () => void {
  const added: Array<() => void> = [];
  for (const target of [document, window] as EventTarget[]) {
    const original = target.addEventListener;
    target.addEventListener = ((type: string, listener: EventListener, options?: AddEventListenerOptions) => {
      original.call(target, type, listener, options);
      added.push(() => target.removeEventListener(type, listener, options));
    }) as typeof target.addEventListener;
    added.push(() => {
      target.addEventListener = original;
    });
  }
  return () => added.forEach((remove) => remove());
}

/** jsdom has no execCommand: edits apply and fire `input` as a browser's would, native undo declines. */
function installExecCommand(): void {
  (document as unknown as { execCommand: unknown }).execCommand = (command: string, _ui: boolean, text?: string) => {
    if (command !== 'insertText') return false;
    const active = document.activeElement as HTMLTextAreaElement | null;
    if (!active || active.tagName !== 'TEXTAREA') return false;
    active.setRangeText(text ?? '', active.selectionStart, active.selectionEnd, 'end');
    active.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  };
}

/** Stubs fetch, location.reload, and assignments to location.href; the rest of location stays real. */
export function installHarness(): EditorHarness {
  vi.resetModules();
  document.body.removeAttribute('data-scroll-lock-count');
  document.body.removeAttribute('style');
  const calls: RecordedCall[] = [];
  const handlers = new Map<string, (call: RecordedCall) => Response | Promise<Response>>();
  const reload = vi.fn();
  const navigations: string[] = [];

  const realLocation = window.location;
  vi.stubGlobal('location', new Proxy({}, {
    get(_target, key) {
      if (key === 'reload') return reload;
      if (key === 'replace') return (url: string) => navigations.push(url);
      const value = Reflect.get(realLocation, key);
      return typeof value === 'function' ? value.bind(realLocation) : value;
    },
    set(_target, key, value) {
      if (key === 'href') {
        navigations.push(String(value));
        return true;
      }
      return Reflect.set(realLocation, key, value);
    },
  }));

  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = String(input);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body ?? null;
    const call = { url, method: init.method ?? 'GET', body };
    calls.push(call);
    if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const handler = handlers.get(`${call.method} ${url}`) ?? handlers.get(url);
    if (!handler) return jsonResponse({ detail: `No handler for ${call.method} ${url}` }, 404);
    return handler(call);
  }));

  installExecCommand();
  const removeListeners = trackListeners();

  return {
    calls,
    reload,
    navigations,
    saves: () => calls
      .filter((call) => call.url === '/api/save-project' || call.url === '/api/save-about')
      .map((call) => call.body as Record<string, unknown>),
    lastSave() {
      const saves = this.saves();
      const last = saves[saves.length - 1];
      if (!last) throw new Error('Nothing was saved');
      return last;
    },
    respond(route, handler) {
      handlers.set(route, handler);
    },
    teardown() {
      delete window.__bbHomepageRuntime;
      removeListeners();
      vi.useRealTimers();
    },
  };
}

export function mountProjectPage(slug: string = PROJECT.slug): void {
  window.history.replaceState({ homepage: true, slug }, '', `http://localhost/${slug}`);
  document.body.innerHTML = `
    <header id="main-header"><h1><a href="/" class="site-title">Billy Bjork</a></h1><nav></nav></header>
    <section id="homepage-detail-scene">
      <div class="homepage-detail-header">
        <h2 class="homepage-detail-title">Sample Project</h2>
        <div class="homepage-detail-date">Jan 2024</div>
      </div>
      <div class="homepage-detail-actions edit-buttons">
        <button type="button" data-homepage-edit-project>Edit</button>
      </div>
      <div class="video-container"><video></video></div>
      <section id="homepage-detail-content"><div class="project-content"><p>Rendered</p></div></section>
    </section>
  `;
}

export function mountAboutPage(): void {
  window.history.replaceState(null, '', 'http://localhost/me');
  document.body.innerHTML = `
    <header id="main-header"><h1><a href="/" class="site-title">Billy Bjork</a></h1><nav></nav></header>
    <section class="about-content"><p>Rendered</p></section>
  `;
}

/** Stands in for homepage.js, which on a real page has registered before edit.js runs. */
export function registerRuntime(openSlug: string | null): HomepageRuntimeApi {
  const runtime = {
    getOpenProjectSlug: vi.fn(() => openSlug),
    waitForProjectReady: vi.fn(async (slug: string): Promise<string | null> => slug),
    renameProjectSlug: vi.fn(),
  };
  registerHomepageRuntime(runtime);
  return runtime;
}

export async function openProjectEditor(harness: EditorHarness, markdown: string, overrides: Record<string, unknown> = {}): Promise<void> {
  mountProjectPage();
  registerRuntime(PROJECT.slug);
  harness.respond(`/api/project/${PROJECT.slug}`, () => jsonResponse({ ...PROJECT, markdown, ...overrides }));
  harness.respond('/api/save-project', (call) => jsonResponse({
    success: true,
    slug: (call.body as { slug: string }).slug,
    revision: `rev-${harness.saves().length + 1}`,
  }));
  const { openEditor } = await import('../../static/ts/edit/session');
  const { projectPage } = await import('../../static/ts/edit/page-adapter');
  await openEditor(projectPage(PROJECT.slug));
}

export async function openAboutEditor(harness: EditorHarness, markdown: string): Promise<void> {
  mountAboutPage();
  harness.respond('/api/about', () => jsonResponse({ markdown, revision: 'rev-1' }));
  harness.respond('/api/save-about', () => jsonResponse({
    success: true,
    revision: `rev-${harness.saves().length + 1}`,
  }));
  const { openEditor } = await import('../../static/ts/edit/session');
  const { aboutPage } = await import('../../static/ts/edit/page-adapter');
  await openEditor(aboutPage());
}

export function toolbarButton(action: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(`.edit-mode-toolbar [data-action="${action}"]`);
  if (!button) throw new Error(`No toolbar button ${action}`);
  return button;
}

export function statusText(): string {
  return document.querySelector('.edit-status')?.textContent ?? '';
}

export function blockWrappers(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.block-wrapper'));
}

export function lineInputs(blockIndex = 0): HTMLTextAreaElement[] {
  return Array.from(blockWrappers()[blockIndex]?.querySelectorAll<HTMLTextAreaElement>('.text-line-input') ?? []);
}

/** Types into a line the way a browser would: activate it, change the value, fire `input`. */
export function typeInLine(text: string, blockIndex = 0, lineIndex = 0): HTMLTextAreaElement {
  const row = blockWrappers()[blockIndex]?.querySelectorAll<HTMLElement>('.text-block-line')[lineIndex];
  if (!row) throw new Error(`No line ${lineIndex} in block ${blockIndex}`);
  row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  const input = row.querySelector<HTMLTextAreaElement>('.text-line-input')!;
  input.value = text;
  input.setSelectionRange(text.length, text.length);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return input;
}

export function pressKey(target: EventTarget, key: string, modifiers: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
  target.dispatchEvent(event);
  return event;
}

export function notifications(): string[] {
  return Array.from(document.querySelectorAll('.edit-notification')).map((el) => el.textContent ?? '');
}

/** A hand-driven XMLHttpRequest. */
export function stubXhr(): { instance(): FakeXhr } {
  let last: FakeXhr | null = null;
  vi.stubGlobal('XMLHttpRequest', class extends FakeXhr {
    constructor() {
      super();
      last = this;
    }
  });
  return { instance: () => last as unknown as FakeXhr };
}

export class FakeXhr {
  url = '';
  status = 0;
  responseText = '';
  aborted = false;
  body: FormData | null = null;
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();
  private readonly uploadListeners = new Map<string, Array<(event: unknown) => void>>();
  readonly upload = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      this.uploadListeners.set(type, [...(this.uploadListeners.get(type) ?? []), listener]);
    },
  };

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  open(_method: string, url: string): void {
    this.url = url;
  }

  send(body: FormData): void {
    this.body = body;
  }

  abort(): void {
    this.aborted = true;
    this.listeners.get('abort')?.forEach((listener) => listener({}));
  }

  progress(loaded: number, total: number): void {
    this.uploadListeners.get('progress')?.forEach((listener) => listener({ lengthComputable: true, loaded, total }));
  }

  sent(): void {
    this.uploadListeners.get('load')?.forEach((listener) => listener({}));
  }

  finish(status: number, body: unknown): void {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.listeners.get('load')?.forEach((listener) => listener({}));
  }
}

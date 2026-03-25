export interface HomepageRuntimeApi {
  getOpenProjectSlug(): string | null;
  waitForProjectReady(slug?: string | null, timeoutMs?: number): Promise<string | null>;
  renameProjectSlug(previousSlug: string, nextSlug: string): void;
}

interface RuntimeServices {
  homepage?: HomepageRuntimeApi;
}

declare global {
  interface Window {
    __bbRuntimeServices__?: RuntimeServices;
  }
}

const RUNTIME_STORE_KEY = '__bbRuntimeServices__';

type RuntimeServiceName = keyof RuntimeServices;

type RuntimeWaiterMap = {
  [K in RuntimeServiceName]: Array<(service: NonNullable<RuntimeServices[K]> | null) => void>;
};

const runtimeWaiters: RuntimeWaiterMap = {
  homepage: [],
};

function getRuntimeStore(): RuntimeServices {
  window[RUNTIME_STORE_KEY] ??= {};
  return window[RUNTIME_STORE_KEY] as RuntimeServices;
}

export function registerRuntime<K extends RuntimeServiceName>(
  name: K,
  service: RuntimeServices[K] | null
): void {
  const store = getRuntimeStore();

  if (service) {
    store[name] = service;
  } else {
    delete store[name];
  }

  const waiters = runtimeWaiters[name];
  if (!waiters.length) return;

  const queued = waiters.splice(0, waiters.length);
  queued.forEach((resolve) => resolve((store[name] ?? null) as NonNullable<RuntimeServices[K]> | null));
}

export function getRuntime<K extends RuntimeServiceName>(
  name: K
): NonNullable<RuntimeServices[K]> | null {
  const store = getRuntimeStore();
  return (store[name] ?? null) as NonNullable<RuntimeServices[K]> | null;
}

export function waitForRuntime<K extends RuntimeServiceName>(
  name: K,
  timeoutMs: number = 2000
): Promise<NonNullable<RuntimeServices[K]> | null> {
  const existing = getRuntime(name);
  if (existing) {
    return Promise.resolve(existing);
  }

  return new Promise((resolve) => {
    const waiters = runtimeWaiters[name] as Array<(service: NonNullable<RuntimeServices[K]> | null) => void>;
    let settled = false;

    const finish = (service: NonNullable<RuntimeServices[K]> | null): void => {
      if (settled) return;
      settled = true;
      const index = waiters.indexOf(finish);
      if (index >= 0) {
        waiters.splice(index, 1);
      }
      clearTimeout(timeoutId);
      resolve(service);
    };

    const timeoutId = window.setTimeout(() => {
      finish(getRuntime(name));
    }, timeoutMs);

    waiters.push(finish);
  });
}

export function registerHomepageRuntime(runtime: HomepageRuntimeApi | null): void {
  registerRuntime('homepage', runtime);
}

export function getHomepageRuntime(): HomepageRuntimeApi | null {
  return getRuntime('homepage');
}

export function waitForHomepageRuntime(timeoutMs?: number): Promise<HomepageRuntimeApi | null> {
  return waitForRuntime('homepage', timeoutMs);
}

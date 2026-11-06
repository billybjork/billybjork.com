import type { FetchJSONOptions } from '../types/api';

export async function fetchJSON<T>(url: string, options: FetchJSONOptions = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(errorBody?.detail || `HTTP error! status: ${response.status}`);
  }

  return await response.json() as T;
}

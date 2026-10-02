import { ambient } from './ambient.js';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
  get detail(): string {
    try {
      const detail: unknown = JSON.parse(this.message).detail;
      if (typeof detail === 'string') return detail;
      if (detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string') return detail.message;
    } catch {}
    return this.message;
  }
}

export type Query = Record<string, string | number | boolean | undefined>;
export function buildUrl(path: string, query?: Query): string {
  const url = new URL(ambient().url + '/fn/data' + path);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}
export function send(url: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${ambient().token}`);
  return fetch(url, { ...init, headers });
}
export async function call<T = unknown>(method: string, path: string, options: { query?: Query; body?: unknown } = {}): Promise<T> {
  const response = await send(buildUrl(path, options.query), {
    method,
    ...(options.body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(options.body) } : {}),
  });
  if (!response.ok) throw new ApiError(response.status, await response.text());
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}
export async function getOrNull<T>(path: string, query?: Query): Promise<T | null> {
  const response = await send(buildUrl(path, query), { method: 'GET' });
  if (response.status === 404) return null;
  if (!response.ok) throw new ApiError(response.status, await response.text());
  return await response.json() as T;
}

'use client';

/**
 * Fetch wrapper for the browser.
 *
 * Server error messages are preserved and surfaced. The UI's job is to tell
 * the trader exactly what went wrong, not to hide it behind a generic toast.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
      ...init?.headers,
    },
  });

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { error: text.slice(0, 300) };
  }

  if (!response.ok) {
    const body = payload as { error?: string; issues?: { path: string; message: string }[] };
    throw new ApiError(body?.error ?? `Request failed (${response.status}).`, response.status, body?.issues);
  }

  return payload as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const put = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'PUT', body: JSON.stringify(body) });
export const patch = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });
export const upload = <T>(path: string, form: FormData) =>
  api<T>(path, { method: 'POST', body: form });

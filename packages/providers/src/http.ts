import { unavailable, type DataUnavailable } from '@xau/core';

/**
 * Shared HTTP helper.
 *
 * Maps transport and vendor failures onto the application's explicit
 * `unavailable` result, including rate limits, so the UI can say exactly why
 * a value is missing instead of showing a blank or a stale number.
 */

export interface HttpOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Search parameters appended to the URL. Undefined values are dropped. */
  query?: Record<string, string | number | undefined>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'rate-limited' | 'provider-error' | 'network-error' | 'no-data',
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

function buildUrl(url: string, query?: HttpOptions['query']): string {
  if (!query) return url;
  const target = new URL(url);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue;
    target.searchParams.set(key, String(value));
  }
  return target.toString();
}

export async function getJson<T>(url: string, options: HttpOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 12_000);

  try {
    const response = await fetch(buildUrl(url, options.query), {
      signal: controller.signal,
      headers: { Accept: 'application/json', ...options.headers },
    });

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'));
      throw new ProviderError(
        'Provider rate limit reached.',
        'rate-limited',
        Number.isFinite(retryAfter) ? retryAfter : 60,
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ProviderError(
        `HTTP ${response.status} ${response.statusText}${body ? `: ${body.slice(0, 200)}` : ''}`,
        'provider-error',
      );
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ProviderError('Provider request timed out.', 'network-error');
    }
    throw new ProviderError(
      error instanceof Error ? error.message : 'Unknown network failure.',
      'network-error',
    );
  } finally {
    clearTimeout(timeout);
  }
}

/** Convert a thrown error into the application's unavailable result. */
export function toUnavailable(providerId: string, error: unknown): DataUnavailable {
  if (error instanceof ProviderError) {
    return unavailable(providerId, error.kind, error.message, error.retryAfterSeconds);
  }
  return unavailable(
    providerId,
    'provider-error',
    error instanceof Error ? error.message : 'Unknown provider failure.',
  );
}

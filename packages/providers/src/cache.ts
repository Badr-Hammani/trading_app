import type { DataResult } from '@xau/core';
import { unavailable } from '@xau/core';

/**
 * TTL cache with an explicit staleness boundary.
 *
 * Two ages matter and they are different: `ttlMs` is how long a value is
 * fresh, `maxStaleMs` is how long it may still be shown while labelled stale.
 * Past that, the entry is dropped and the caller gets DATA UNAVAILABLE rather
 * than an old number presented as current.
 */

interface CacheEntry<T> {
  value: T;
  storedAt: number;
}

export interface CacheOptions {
  ttlMs: number;
  /** 0 means never serve a stale value. */
  maxStaleMs?: number;
}

export interface CachedValue<T> {
  value: T;
  ageMs: number;
  stale: boolean;
}

export class TtlCache {
  private readonly store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string, options: CacheOptions): CachedValue<T> | null {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return null;

    const ageMs = Date.now() - entry.storedAt;
    const maxStale = options.maxStaleMs ?? 0;

    if (ageMs > options.ttlMs + maxStale) {
      this.store.delete(key);
      return null;
    }

    return { value: entry.value, ageMs, stale: ageMs > options.ttlMs };
  }

  set<T>(key: string, value: T): void {
    this.store.set(key, { value, storedAt: Date.now() });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

export const sharedCache = new TtlCache();

/**
 * Cache a provider call. Only successful results are cached: caching an
 * outage would turn a transient failure into a persistent one.
 */
export async function cached<T>(
  key: string,
  options: CacheOptions,
  loader: () => Promise<DataResult<T>>,
  cache: TtlCache = sharedCache,
): Promise<DataResult<T>> {
  const hit = cache.get<DataResult<T>>(key, options);
  if (hit && hit.value.status === 'ok') {
    if (!hit.stale) return hit.value;
    // A stale hit is only a fallback if the refresh fails.
    const refreshed = await loader();
    if (refreshed.status === 'ok') {
      cache.set(key, refreshed);
      return refreshed;
    }
    return unavailable(
      hit.value.provider,
      'stale',
      `Last successful update was ${Math.round(hit.ageMs / 1000)}s ago and the refresh failed: ${refreshed.message}`,
    );
  }

  const result = await loader();
  if (result.status === 'ok') cache.set(key, result);
  return result;
}

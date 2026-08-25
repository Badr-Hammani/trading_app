'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, get } from './client';

/**
 * Polling data hook.
 *
 * Failures surface as an error the caller renders, never as stale data shown
 * as if it were current.
 */
export function usePolling<T>(
  path: string | null,
  intervalMs = 30_000,
): {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (!path) return;
    try {
      const payload = await get<T>(path);
      if (!mounted.current) return;
      setData(payload);
      setError(null);
    } catch (caught) {
      if (!mounted.current) return;
      setError(caught instanceof ApiError ? caught.message : 'Request failed.');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    if (!path || intervalMs <= 0) return () => {
      mounted.current = false;
    };

    const timer = setInterval(() => void refresh(), intervalMs);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [path, intervalMs, refresh]);

  return { data, error, loading, refresh };
}

/** A ticking clock for countdowns, so seconds advance without refetching. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Async action state, for buttons that submit. */
export function useAction<Args extends unknown[], Result>(
  fn: (...args: Args) => Promise<Result>,
): {
  run: (...args: Args) => Promise<Result | null>;
  busy: boolean;
  error: string | null;
  clearError: () => void;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (...args: Args) => {
      setBusy(true);
      setError(null);
      try {
        return await fn(...args);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Action failed.');
        return null;
      } finally {
        setBusy(false);
      }
    },
    [fn],
  );

  return { run, busy, error, clearError: () => setError(null) };
}

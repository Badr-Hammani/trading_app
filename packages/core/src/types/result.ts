/**
 * Provider results.
 *
 * The application must never fabricate a value it does not have. Providers
 * therefore return an explicit `unavailable` result carrying a human-readable
 * reason the UI renders as DATA UNAVAILABLE.
 */

export type UnavailableReason =
  | 'not-configured'
  | 'rate-limited'
  | 'provider-error'
  | 'network-error'
  | 'not-supported'
  | 'stale'
  | 'no-data';

export interface DataOk<T> {
  status: 'ok';
  data: T;
  provider: string;
  /** epoch ms when the value was produced by this application. */
  fetchedAt: number;
  /** Set when the provider labels its data delayed, with the delay in seconds. */
  delaySeconds?: number;
}

export interface DataUnavailable {
  status: 'unavailable';
  reason: UnavailableReason;
  message: string;
  provider: string;
  fetchedAt: number;
  /** Populated for `rate-limited`, so the UI can show a retry time. */
  retryAfterSeconds?: number;
}

export type DataResult<T> = DataOk<T> | DataUnavailable;

export function ok<T>(
  data: T,
  provider: string,
  extra?: { delaySeconds?: number },
): DataOk<T> {
  return { status: 'ok', data, provider, fetchedAt: Date.now(), ...extra };
}

export function unavailable(
  provider: string,
  reason: UnavailableReason,
  message: string,
  retryAfterSeconds?: number,
): DataUnavailable {
  return {
    status: 'unavailable',
    reason,
    message,
    provider,
    fetchedAt: Date.now(),
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  };
}

export function isOk<T>(result: DataResult<T>): result is DataOk<T> {
  return result.status === 'ok';
}

/** Map an ok-result's payload, passing an unavailable result straight through. */
export function mapResult<A, B>(result: DataResult<A>, fn: (value: A) => B): DataResult<B> {
  return result.status === 'ok' ? { ...result, data: fn(result.data) } : result;
}

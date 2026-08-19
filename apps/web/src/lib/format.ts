import { DateTime } from 'luxon';

/**
 * Display formatting.
 *
 * A missing value renders as an em dash, never as 0. The difference between
 * "no data" and "zero" matters on a trading screen.
 */

export const DASH = '—';

export function fmtNumber(
  value: number | null | undefined,
  decimals = 2,
  options: { sign?: boolean; suffix?: string } = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  const sign = options.sign && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}${options.suffix ?? ''}`;
}

export function fmtPrice(value: number | null | undefined, precision = 2): string {
  return fmtNumber(value, precision);
}

export function fmtPercent(value: number | null | undefined, decimals = 1, sign = false): string {
  return fmtNumber(value, decimals, { sign, suffix: '%' });
}

export function fmtR(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  return `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}R`;
}

export function fmtCurrency(
  value: number | null | undefined,
  currency = 'USD',
  decimals = 2,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return DASH;
  const symbol = currency === 'USD' ? '$' : `${currency} `;
  return `${value < 0 ? '-' : ''}${symbol}${Math.abs(value).toFixed(decimals)}`;
}

export function fmtTime(epochSeconds: number | null | undefined, timezone: string, format = 'HH:mm'): string {
  if (!epochSeconds) return DASH;
  return DateTime.fromSeconds(epochSeconds, { zone: 'utc' }).setZone(timezone).toFormat(format);
}

export function fmtDateTime(epochSeconds: number | null | undefined, timezone: string): string {
  return fmtTime(epochSeconds, timezone, 'dd LLL HH:mm');
}

export function fmtIsoDateTime(iso: string | Date | null | undefined, timezone: string, format = 'dd LLL HH:mm'): string {
  if (!iso) return DASH;
  const dt = typeof iso === 'string' ? DateTime.fromISO(iso) : DateTime.fromJSDate(iso);
  return dt.isValid ? dt.setZone(timezone).toFormat(format) : DASH;
}

export function toneForValue(value: number | null | undefined): 'bull' | 'bear' | 'neutral' {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'neutral';
  if (value > 0) return 'bull';
  if (value < 0) return 'bear';
  return 'neutral';
}

export const toneClass = {
  bull: 'text-bull',
  bear: 'text-bear',
  neutral: 'text-ink-300',
} as const;

/** Parse a numeric input, treating an empty field as "not provided". */
export function parseNumberInput(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

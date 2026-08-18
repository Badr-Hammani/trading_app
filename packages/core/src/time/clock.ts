import { DateTime } from 'luxon';

/**
 * Timezone-aware helpers.
 *
 * Engines work in UTC epoch seconds; every conversion to a wall clock goes
 * through here so daylight-saving transitions are handled by the IANA
 * database rather than by fixed offsets.
 */

export const DEFAULT_TIMEZONE = 'Africa/Casablanca';

export function isValidTimezone(zone: string): boolean {
  return DateTime.local().setZone(zone).isValid;
}

export function toZoned(epochSeconds: number, timezone: string): DateTime {
  return DateTime.fromSeconds(epochSeconds, { zone: 'utc' }).setZone(timezone);
}

/** Format an instant in the user's timezone. */
export function formatInZone(
  epochSeconds: number,
  timezone: string,
  format = 'yyyy-LL-dd HH:mm',
): string {
  return toZoned(epochSeconds, timezone).toFormat(format);
}

/** Minutes past local midnight, in the given timezone. */
export function minutesOfDay(epochSeconds: number, timezone: string): number {
  const dt = toZoned(epochSeconds, timezone);
  return dt.hour * 60 + dt.minute;
}

/** ISO weekday in the given timezone: 1 = Monday … 7 = Sunday. */
export function weekdayInZone(epochSeconds: number, timezone: string): number {
  return toZoned(epochSeconds, timezone).weekday;
}

/** Local calendar day key, e.g. `2026-08-18`. */
export function dayKey(epochSeconds: number, timezone: string): string {
  return toZoned(epochSeconds, timezone).toFormat('yyyy-LL-dd');
}

/** Start of the local calendar day, as UTC epoch seconds. */
export function startOfLocalDay(epochSeconds: number, timezone: string): number {
  return Math.floor(toZoned(epochSeconds, timezone).startOf('day').toSeconds());
}

/** Start of the local ISO week (Monday), as UTC epoch seconds. */
export function startOfLocalWeek(epochSeconds: number, timezone: string): number {
  return Math.floor(toZoned(epochSeconds, timezone).startOf('week').toSeconds());
}

/** Parse `HH:mm` into minutes past midnight. Throws on malformed input. */
export function parseHhMm(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error(`Invalid HH:mm time: "${value}"`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error(`Time out of range: "${value}"`);
  return hours * 60 + minutes;
}

export function formatHhMm(minutesPastMidnight: number): string {
  const normalised = ((minutesPastMidnight % 1440) + 1440) % 1440;
  const hours = Math.floor(normalised / 60);
  const minutes = normalised % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Human-readable countdown, e.g. `2h 14m` or `47s`. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

/**
 * Convert a wall-clock time in one timezone to UTC epoch seconds on a given
 * local date. Returns null when the wall time does not exist (spring-forward
 * gap), which the caller must surface rather than silently shifting.
 */
export function zonedTimeToEpoch(
  localDate: string,
  minutesPastMidnight: number,
  timezone: string,
): number | null {
  const dt = DateTime.fromISO(localDate, { zone: timezone })
    .startOf('day')
    .plus({ minutes: minutesPastMidnight });
  if (!dt.isValid) return null;
  // Luxon resolves gaps forward; detect the shift so callers can flag DST.
  if (dt.hour * 60 + dt.minute !== minutesPastMidnight % 1440) return null;
  return Math.floor(dt.toSeconds());
}

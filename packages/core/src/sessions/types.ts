/**
 * Session configuration.
 *
 * Times are never hardcoded: each session stores its own IANA timezone so a
 * "London open at 08:00 London time" stays anchored to the local open across
 * daylight-saving changes, no matter what timezone the user reads it in.
 */

export type SessionKind = 'asian' | 'london' | 'newyork' | 'overlap' | 'custom';

export interface SessionDefinition {
  id: string;
  name: string;
  kind: SessionKind;
  /** IANA zone the start/end wall times are expressed in. */
  timezone: string;
  /** Minutes past local midnight. `end <= start` means the session wraps midnight. */
  startMinutes: number;
  endMinutes: number;
  /** ISO weekdays the session runs on: 1 = Monday … 7 = Sunday. */
  days: number[];
  /** Whether the user permits execution inside this window. */
  tradingPermitted: boolean;
  enabled: boolean;
  /** Hex colour used for chart overlays. */
  color: string;
}

export interface SessionOccurrence {
  definition: SessionDefinition;
  /** UTC epoch seconds. */
  start: number;
  end: number;
}

export interface SessionStatus {
  /** Sessions containing the reference instant. */
  active: SessionOccurrence[];
  /** The next session to open, or null when none is scheduled in the horizon. */
  next: SessionOccurrence | null;
  secondsToNextOpen: number | null;
  /** Earliest close among active sessions. */
  secondsToActiveClose: number | null;
  /** True when at least one active session permits execution. */
  executionWindow: boolean;
  /** Names of the active sessions, for compact display. */
  activeNames: string[];
}

export const WEEKDAYS_MON_FRI = [1, 2, 3, 4, 5];
export const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];

/**
 * Defaults matching the user's strategy: execution in London and New York
 * only. Asian is tracked for its range (Asian high/low liquidity) but is not
 * an execution window.
 */
export const DEFAULT_SESSIONS: SessionDefinition[] = [
  {
    id: 'asian',
    name: 'Asian',
    kind: 'asian',
    timezone: 'Asia/Tokyo',
    startMinutes: 9 * 60,
    endMinutes: 15 * 60,
    days: WEEKDAYS_MON_FRI,
    tradingPermitted: false,
    enabled: true,
    color: '#3b82f6',
  },
  {
    id: 'london',
    name: 'London',
    kind: 'london',
    timezone: 'Europe/London',
    startMinutes: 8 * 60,
    endMinutes: 16 * 60 + 30,
    days: WEEKDAYS_MON_FRI,
    tradingPermitted: true,
    enabled: true,
    color: '#22c55e',
  },
  {
    id: 'newyork',
    name: 'New York',
    kind: 'newyork',
    timezone: 'America/New_York',
    startMinutes: 8 * 60 + 30,
    endMinutes: 17 * 60,
    days: WEEKDAYS_MON_FRI,
    tradingPermitted: true,
    enabled: true,
    color: '#f59e0b',
  },
  {
    id: 'overlap',
    name: 'London / NY Overlap',
    kind: 'overlap',
    timezone: 'America/New_York',
    startMinutes: 8 * 60 + 30,
    endMinutes: 11 * 60 + 30,
    days: WEEKDAYS_MON_FRI,
    tradingPermitted: true,
    enabled: true,
    color: '#a855f7',
  },
];

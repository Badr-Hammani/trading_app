import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { DEFAULT_SESSIONS, type SessionDefinition } from './types.js';
import { activeSessions, marketStatus, sessionLabelAt, sessionStatus } from './engine.js';

const at = (iso: string): number => Math.floor(DateTime.fromISO(iso, { zone: 'utc' }).toSeconds());

const london = DEFAULT_SESSIONS.find((session) => session.id === 'london')!;

describe('session engine', () => {
  it('opens London at its local open in winter', () => {
    // 08:00 London (GMT/UTC) in January is 08:00 UTC.
    expect(activeSessions([london], at('2026-01-15T08:00:00Z')).length).toBe(1);
    expect(activeSessions([london], at('2026-01-15T07:30:00Z')).length).toBe(0);
  });

  it('shifts the UTC open when London is on summer time', () => {
    // 08:00 London in July (BST, UTC+1) is 07:00 UTC.
    expect(activeSessions([london], at('2026-07-15T07:00:00Z')).length).toBe(1);
    expect(activeSessions([london], at('2026-07-15T06:30:00Z')).length).toBe(0);
  });

  it('does not run sessions at the weekend', () => {
    expect(activeSessions([london], at('2026-01-17T10:00:00Z')).length).toBe(0);
  });

  it('reports the execution window only for permitted sessions', () => {
    const asian = DEFAULT_SESSIONS.find((session) => session.id === 'asian')!;
    // Asian runs 00:00 UTC to 09:00 UTC.
    const status = sessionStatus([asian], at('2026-01-15T05:00:00Z'));
    expect(status.active.length).toBe(1);
    expect(status.executionWindow).toBe(false);
  });

  it('counts down to the next session open', () => {
    // 06:00 UTC in January. Next London open is at 08:00 UTC, in 2 hours.
    const status = sessionStatus([london], at('2026-01-15T06:00:00Z'));
    expect(status.next).not.toBeNull();
    expect(status.secondsToNextOpen).toBe(2 * 3600);
    expect(status.executionWindow).toBe(false);
  });

  it('prefers the overlap label when several sessions are live', () => {
    // 14:00 UTC is during London (08:00-16:30 UTC) and NY (13:00-22:00 UTC), so Overlap is active.
    const label = sessionLabelAt(DEFAULT_SESSIONS, at('2026-01-15T14:00:00Z'));
    expect(label).toBe('London / NY Overlap');
  });

  it('honours a custom session definition in the user timezone', () => {
    const custom: SessionDefinition = {
      id: 'custom',
      name: 'Casablanca morning',
      kind: 'custom',
      timezone: 'Africa/Casablanca',
      startMinutes: 9 * 60,
      endMinutes: 12 * 60,
      days: [1, 2, 3, 4, 5],
      tradingPermitted: true,
      enabled: true,
      color: '#fff',
    };
    // Casablanca is UTC+1 in January 2026.
    expect(activeSessions([custom], at('2026-01-15T09:30:00Z')).length).toBe(1);
    expect(activeSessions([custom], at('2026-01-15T07:30:00Z')).length).toBe(0);
  });

  it('reports the market as closed at the weekend', () => {
    expect(marketStatus(at('2026-01-17T12:00:00Z'))).toBe('weekend');
    expect(marketStatus(at('2026-01-15T12:00:00Z'))).toBe('open');
    expect(marketStatus(at('2026-01-15T21:30:00Z'))).toBe('closed');
  });
});

import { describe, expect, it } from 'vitest';
import { parseOhlcvCsv, toCsv } from './csv.js';

describe('CSV import', () => {
  it('parses a standard OHLCV export', () => {
    const csv = [
      'time,open,high,low,close,volume',
      '2026-01-05T08:00:00Z,2000,2005,1999,2004,120',
      '2026-01-05T08:05:00Z,2004,2010,2003,2008,140',
    ].join('\n');

    const { candles, report } = parseOhlcvCsv(csv, { timezone: 'UTC', timeframe: '5M' });
    expect(candles).toHaveLength(2);
    expect(candles[0]!.open).toBe(2000);
    expect(candles[1]!.volume).toBe(140);
    expect(report.invalidRows).toHaveLength(0);
  });

  it('infers common column aliases and delimiters', () => {
    const csv = ['Date;Open;High;Low;Last', '2026.01.05 08:00:00;2000;2005;1999;2004'].join('\n');
    const { candles } = parseOhlcvCsv(csv, { timezone: 'UTC', timeframe: '5M' });
    expect(candles).toHaveLength(1);
    expect(candles[0]!.close).toBe(2004);
  });

  it('converts timestamps from the stated timezone', () => {
    const csv = ['time,open,high,low,close', '2026-01-05 09:00:00,2000,2005,1999,2004'].join('\n');
    const utc = parseOhlcvCsv(csv, { timezone: 'UTC', timeframe: '5M' }).candles[0]!;
    const casa = parseOhlcvCsv(csv, { timezone: 'Africa/Casablanca', timeframe: '5M' }).candles[0]!;
    // Casablanca is UTC+1 in January, so the same wall time is an hour earlier in UTC.
    expect(utc.time - casa.time).toBe(3600);
  });

  it('removes duplicate bars, keeping the later revision', () => {
    const csv = [
      'time,open,high,low,close',
      '2026-01-05T08:00:00Z,2000,2005,1999,2004',
      '2026-01-05T08:00:00Z,2000,2006,1999,2005',
    ].join('\n');

    const { candles, report } = parseOhlcvCsv(csv, { timezone: 'UTC', timeframe: '5M' });
    expect(candles).toHaveLength(1);
    expect(candles[0]!.close).toBe(2005);
    expect(report.duplicatesRemoved).toBe(1);
  });

  it('reports gaps rather than filling them', () => {
    const csv = [
      'time,open,high,low,close',
      '2026-01-05T08:00:00Z,2000,2005,1999,2004',
      '2026-01-05T12:00:00Z,2004,2010,2003,2008',
    ].join('\n');

    const { candles, report } = parseOhlcvCsv(csv, { timezone: 'UTC', timeframe: '5M' });
    expect(candles).toHaveLength(2);
    expect(report.gaps).toHaveLength(1);
    expect(report.gaps[0]!.missingBars).toBe(47);
  });

  it('flags bars whose high and low do not bracket the body', () => {
    const csv = ['time,open,high,low,close', '2026-01-05T08:00:00Z,2000,1999,1998,2004'].join('\n');
    const { report } = parseOhlcvCsv(csv, { timezone: 'UTC', timeframe: '5M' });
    expect(report.inconsistentBars).toBe(1);
  });

  it('reports unusable rows instead of dropping them silently', () => {
    const csv = [
      'time,open,high,low,close',
      'not-a-date,2000,2005,1999,2004',
      '2026-01-05T08:05:00Z,x,2010,2003,2008',
    ].join('\n');

    const { candles, report } = parseOhlcvCsv(csv, { timezone: 'UTC', timeframe: '5M' });
    expect(candles).toHaveLength(0);
    expect(report.invalidRows).toHaveLength(2);
  });

  it('fails clearly when the header cannot be understood', () => {
    const { report } = parseOhlcvCsv('a,b,c\n1,2,3', { timezone: 'UTC', timeframe: '5M' });
    expect(report.invalidRows[0]!.reason).toMatch(/Could not identify/);
  });

  it('escapes values on export', () => {
    const csv = toCsv([{ note: 'says "hi", loudly', r: 1 }]);
    expect(csv).toContain('"says ""hi"", loudly"');
  });
});

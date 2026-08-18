import type { Candle, Timeframe } from '../types/market.js';
import { TIMEFRAME_MINUTES } from '../types/market.js';
import { DateTime } from 'luxon';

/**
 * CSV import/export.
 *
 * Importing your own history is a first-class path, not a fallback: the app
 * must be fully usable for backtesting with no paid API configured at all.
 */

export interface CsvColumnMap {
  time: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
}

export const COMMON_COLUMN_ALIASES: Record<keyof CsvColumnMap, string[]> = {
  time: ['time', 'date', 'datetime', 'timestamp', 'date_time', 'local time', 'gmt time'],
  open: ['open', 'o'],
  high: ['high', 'h'],
  low: ['low', 'l'],
  close: ['close', 'c', 'last'],
  volume: ['volume', 'vol', 'v', 'tickvol', 'tick_volume'],
};

export interface CsvImportOptions {
  /** Timezone the CSV timestamps are expressed in. */
  timezone: string;
  timeframe: Timeframe;
  /** Explicit column mapping; inferred from the header when omitted. */
  columns?: Partial<CsvColumnMap>;
  /** Custom Luxon format if the timestamps are not ISO or epoch. */
  timeFormat?: string;
  delimiter?: string;
}

export interface DataQualityReport {
  rows: number;
  parsed: number;
  duplicatesRemoved: number;
  /** Gaps where at least one expected bar is missing. */
  gaps: { after: number; before: number; missingBars: number }[];
  invalidRows: { line: number; reason: string }[];
  /** Bars whose high/low do not bracket the open/close. */
  inconsistentBars: number;
  firstTime: number | null;
  lastTime: number | null;
}

export interface CsvImportResult {
  candles: Candle[];
  report: DataQualityReport;
}

function detectDelimiter(headerLine: string): string {
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = 0;
  for (const candidate of candidates) {
    const count = headerLine.split(candidate).length;
    if (count > bestCount) {
      bestCount = count;
      best = candidate;
    }
  }
  return best;
}

function normaliseHeader(value: string): string {
  return value.trim().toLowerCase().replace(/^["']|["']$/g, '');
}

function inferColumns(header: string[], overrides?: Partial<CsvColumnMap>): CsvColumnMap | null {
  const normalised = header.map(normaliseHeader);
  const resolve = (field: keyof CsvColumnMap): string | undefined => {
    const override = overrides?.[field];
    if (override) return override;
    for (const alias of COMMON_COLUMN_ALIASES[field]) {
      const index = normalised.indexOf(alias);
      if (index !== -1) return header[index];
    }
    return undefined;
  };

  const time = resolve('time');
  const open = resolve('open');
  const high = resolve('high');
  const low = resolve('low');
  const close = resolve('close');
  if (!time || !open || !high || !low || !close) return null;

  const volume = resolve('volume');
  return { time, open, high, low, close, ...(volume ? { volume } : {}) };
}

function parseTime(raw: string, options: CsvImportOptions): number | null {
  const value = raw.trim().replace(/^["']|["']$/g, '');
  if (value === '') return null;

  if (options.timeFormat) {
    const parsed = DateTime.fromFormat(value, options.timeFormat, { zone: options.timezone });
    return parsed.isValid ? Math.floor(parsed.toSeconds()) : null;
  }

  // Epoch seconds or milliseconds.
  if (/^\d{10}$/.test(value)) return Number(value);
  if (/^\d{13}$/.test(value)) return Math.floor(Number(value) / 1000);

  const iso = DateTime.fromISO(value, { zone: options.timezone });
  if (iso.isValid) return Math.floor(iso.toSeconds());

  for (const format of [
    'yyyy-LL-dd HH:mm:ss',
    'yyyy-LL-dd HH:mm',
    'yyyy.LL.dd HH:mm:ss',
    'yyyy.LL.dd HH:mm',
    'LL/dd/yyyy HH:mm:ss',
    'dd/LL/yyyy HH:mm:ss',
    'dd.LL.yyyy HH:mm:ss',
  ]) {
    const parsed = DateTime.fromFormat(value, format, { zone: options.timezone });
    if (parsed.isValid) return Math.floor(parsed.toSeconds());
  }
  return null;
}

/**
 * Parse OHLCV CSV into candles, reporting every problem found rather than
 * silently dropping rows. Duplicate timestamps keep the LAST occurrence, which
 * is how a re-exported bar is normally a correction of the earlier one.
 */
export function parseOhlcvCsv(text: string, options: CsvImportOptions): CsvImportResult {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const invalidRows: { line: number; reason: string }[] = [];

  if (lines.length < 2) {
    return {
      candles: [],
      report: {
        rows: lines.length,
        parsed: 0,
        duplicatesRemoved: 0,
        gaps: [],
        invalidRows: [{ line: 0, reason: 'File has no data rows.' }],
        inconsistentBars: 0,
        firstTime: null,
        lastTime: null,
      },
    };
  }

  const delimiter = options.delimiter ?? detectDelimiter(lines[0]!);
  const header = lines[0]!.split(delimiter).map((cell) => cell.trim());
  const columns = inferColumns(header, options.columns);

  if (!columns) {
    return {
      candles: [],
      report: {
        rows: lines.length - 1,
        parsed: 0,
        duplicatesRemoved: 0,
        gaps: [],
        invalidRows: [
          {
            line: 1,
            reason: `Could not identify time/open/high/low/close columns in header: ${header.join(', ')}`,
          },
        ],
        inconsistentBars: 0,
        firstTime: null,
        lastTime: null,
      },
    };
  }

  const indexOf = (name: string): number => header.findIndex((cell) => cell === name);
  const timeIndex = indexOf(columns.time);
  const openIndex = indexOf(columns.open);
  const highIndex = indexOf(columns.high);
  const lowIndex = indexOf(columns.low);
  const closeIndex = indexOf(columns.close);
  const volumeIndex = columns.volume ? indexOf(columns.volume) : -1;

  const byTime = new Map<number, Candle>();
  let duplicatesRemoved = 0;
  let inconsistentBars = 0;

  for (let line = 1; line < lines.length; line += 1) {
    const cells = lines[line]!.split(delimiter);
    const time = parseTime(cells[timeIndex] ?? '', options);
    if (time === null) {
      invalidRows.push({ line: line + 1, reason: `Unparseable timestamp "${cells[timeIndex] ?? ''}"` });
      continue;
    }

    const open = Number(cells[openIndex]);
    const high = Number(cells[highIndex]);
    const low = Number(cells[lowIndex]);
    const close = Number(cells[closeIndex]);
    const volumeRaw = volumeIndex >= 0 ? Number(cells[volumeIndex]) : NaN;

    if (![open, high, low, close].every((value) => Number.isFinite(value))) {
      invalidRows.push({ line: line + 1, reason: 'Non-numeric OHLC value' });
      continue;
    }

    if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) {
      inconsistentBars += 1;
    }

    if (byTime.has(time)) duplicatesRemoved += 1;
    byTime.set(time, {
      time,
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volumeRaw) ? volumeRaw : null,
    });
  }

  const candles = [...byTime.values()].sort((a, b) => a.time - b.time);
  const gaps = findGaps(candles, options.timeframe);

  return {
    candles,
    report: {
      rows: lines.length - 1,
      parsed: candles.length,
      duplicatesRemoved,
      gaps,
      invalidRows,
      inconsistentBars,
      firstTime: candles[0]?.time ?? null,
      lastTime: candles[candles.length - 1]?.time ?? null,
    },
  };
}

/**
 * Missing bars, ignoring the weekend break. Reported rather than filled: an
 * invented candle is worse than a visible hole.
 */
export function findGaps(
  candles: Candle[],
  timeframe: Timeframe,
): { after: number; before: number; missingBars: number }[] {
  const step = TIMEFRAME_MINUTES[timeframe] * 60;
  const gaps: { after: number; before: number; missingBars: number }[] = [];

  for (let i = 1; i < candles.length; i += 1) {
    const previous = candles[i - 1]!;
    const current = candles[i]!;
    const delta = current.time - previous.time;
    if (delta <= step) continue;

    // Skip the weekly close: a gap that starts Friday and ends Sunday/Monday.
    const previousDay = DateTime.fromSeconds(previous.time, { zone: 'utc' }).weekday;
    const currentDay = DateTime.fromSeconds(current.time, { zone: 'utc' }).weekday;
    if (previousDay === 5 && (currentDay === 7 || currentDay === 1)) continue;
    // Skip the daily rollover break.
    if (delta <= 2 * 3600) continue;

    gaps.push({
      after: previous.time,
      before: current.time,
      missingBars: Math.floor(delta / step) - 1,
    });
  }
  return gaps;
}

export function candlesToCsv(candles: Candle[], timezone = 'UTC'): string {
  const header = 'time,open,high,low,close,volume';
  const rows = candles.map((candle) => {
    const time = DateTime.fromSeconds(candle.time, { zone: 'utc' })
      .setZone(timezone)
      .toFormat("yyyy-LL-dd'T'HH:mm:ssZZ");
    return [time, candle.open, candle.high, candle.low, candle.close, candle.volume ?? ''].join(',');
  });
  return [header, ...rows].join('\n');
}

/** Generic object-array to CSV, used for trade/journal/statistics exports. */
export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return '';
  const keys = columns ?? [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const text = value instanceof Date ? value.toISOString() : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [keys.join(','), ...rows.map((row) => keys.map((key) => escape(row[key])).join(','))].join('\n');
}

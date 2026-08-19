import type { DataResult } from '@xau/core';
import { ok, unavailable } from '@xau/core';
import { getJson, toUnavailable } from '../http.js';
import type {
  CalendarRequest,
  EconomicDataProvider,
  EconomicEvent,
  EventImportance,
  ProviderInfo,
} from '../types.js';
import { DateTime } from 'luxon';

/**
 * Trading Economics calendar provider.
 *
 * The point-in-time endpoint matters more than the live one: a backtest that
 * reads today's revised figure for a 2024 release is silently cheating. When
 * `asOf` is set the request is routed to the snapshot endpoint, and the rows
 * are tagged `pointInTime` so the backtester can refuse anything else.
 */

const GOLD_RELEVANT = [
  'fomc',
  'fed funds',
  'federal funds',
  'interest rate',
  'cpi',
  'core cpi',
  'inflation rate',
  'pce',
  'core pce',
  'non farm payrolls',
  'nonfarm payrolls',
  'unemployment rate',
  'gdp',
  'ism manufacturing',
  'ism services',
  'retail sales',
  'jobless claims',
  'powell',
  'fed ',
  'treasury',
  'bond auction',
  'yield',
  'ppi',
  'michigan consumer sentiment',
];

export interface TradingEconomicsConfig {
  /** Format is `client:key`, issued at developer.tradingeconomics.com. */
  apiKey: string;
  baseUrl?: string;
  countries?: string[];
}

interface TeCalendarRow {
  CalendarId?: string | number;
  Date?: string;
  Country?: string;
  Category?: string;
  Event?: string;
  Reference?: string;
  Source?: string;
  Actual?: string | number | null;
  Previous?: string | number | null;
  Forecast?: string | number | null;
  TEForecast?: string | number | null;
  Importance?: number | string;
  Unit?: string;
  LastUpdate?: string;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const cleaned = String(value).replace(/[%$,]/g, '').replace(/([KMB])$/i, '');
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  const suffix = /([KMB])$/i.exec(String(value))?.[1]?.toUpperCase();
  const factor = suffix === 'K' ? 1e3 : suffix === 'M' ? 1e6 : suffix === 'B' ? 1e9 : 1;
  return parsed * factor;
}

function toImportance(value: unknown): EventImportance {
  const numeric = Number(value);
  if (numeric >= 3) return 'high';
  if (numeric === 2) return 'medium';
  return 'low';
}

/** Is this event one that actually moves gold? */
export function isGoldRelevant(name: string, category: string | null): boolean {
  const haystack = `${name} ${category ?? ''}`.toLowerCase();
  return GOLD_RELEVANT.some((needle) => haystack.includes(needle));
}

export class TradingEconomicsProvider implements EconomicDataProvider {
  readonly info: ProviderInfo;

  private readonly baseUrl: string;

  constructor(private readonly config: TradingEconomicsConfig) {
    this.baseUrl = config.baseUrl ?? 'https://api.tradingeconomics.com';
    this.info = {
      id: 'trading-economics',
      name: 'Trading Economics',
      configured: Boolean(config.apiKey),
      website: 'https://docs.tradingeconomics.com/',
      setupHint:
        'Set TRADING_ECONOMICS_API_KEY as client:key from developer.tradingeconomics.com. Paid; the trial is capped at a small number of requests. Manually entered events are the free alternative and behave identically.',
    };
  }

  async getCalendar(request: CalendarRequest): Promise<DataResult<EconomicEvent[]>> {
    if (!this.info.configured) {
      return unavailable(
        'trading-economics',
        'not-configured',
        'TRADING_ECONOMICS_API_KEY is not set.',
      );
    }

    const from = DateTime.fromSeconds(request.from, { zone: 'utc' }).toFormat('yyyy-LL-dd');
    const to = DateTime.fromSeconds(request.to, { zone: 'utc' }).toFormat('yyyy-LL-dd');
    const countries = (request.countries ?? this.config.countries ?? []).join(',');

    // Point-in-time requests use the snapshot endpoint so a historical
    // backtest sees the numbers as they were published, not as later revised.
    const path = request.asOf
      ? `/calendar/snapshot/${DateTime.fromSeconds(request.asOf, { zone: 'utc' }).toFormat('yyyy-LL-dd')}`
      : countries
        ? `/calendar/country/${encodeURIComponent(countries)}/${from}/${to}`
        : `/calendar/all/${from}/${to}`;

    try {
      const rows = await getJson<TeCalendarRow[]>(`${this.baseUrl}${path}`, {
        query: { c: this.config.apiKey, f: 'json', d1: request.asOf ? from : undefined, d2: request.asOf ? to : undefined },
      });

      if (!Array.isArray(rows)) {
        return unavailable('trading-economics', 'provider-error', 'Unexpected calendar payload shape.');
      }

      const minRank = { low: 0, medium: 1, high: 2 } as const;
      const threshold = minRank[request.minImportance ?? 'low'];

      const events: EconomicEvent[] = rows
        .filter((row) => row.Date && row.Event)
        .map((row) => {
          const actual = toNumber(row.Actual);
          const forecast = toNumber(row.Forecast ?? row.TEForecast);
          return {
            id: String(row.CalendarId ?? `${row.Country}-${row.Event}-${row.Date}`),
            name: String(row.Event),
            country: String(row.Country ?? 'Unknown'),
            time: Math.floor(DateTime.fromISO(String(row.Date), { zone: 'utc' }).toSeconds()),
            importance: toImportance(row.Importance),
            category: row.Category ? String(row.Category) : null,
            previous: toNumber(row.Previous),
            forecast,
            actual,
            unit: row.Unit ? String(row.Unit) : null,
            surprise: actual !== null && forecast !== null ? actual - forecast : null,
            source: row.Source ? String(row.Source) : 'Trading Economics',
            pointInTime: Boolean(request.asOf),
            reference: row.Reference ? String(row.Reference) : null,
          };
        })
        .filter((event) => Number.isFinite(event.time))
        .filter((event) => minRank[event.importance] >= threshold)
        .filter((event) => event.time >= request.from && event.time <= request.to)
        .sort((a, b) => a.time - b.time);

      return ok(events, 'trading-economics');
    } catch (error) {
      return toUnavailable('trading-economics', error);
    }
  }
}

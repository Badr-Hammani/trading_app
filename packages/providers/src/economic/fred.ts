import type { DataResult } from '@xau/core';
import { ok, unavailable } from '@xau/core';
import { getJson, toUnavailable } from '../http.js';
import type {
  CalendarRequest,
  EconomicDataProvider,
  EconomicEvent,
  MacroSeries,
  ProviderInfo,
} from '../types.js';
import { DateTime } from 'luxon';

/**
 * FRED provider.
 *
 * FRED is the authority for official US macro series — DXY components, 2Y and
 * 10Y yields, real yields, CPI, PCE, payrolls, unemployment, VIX. It publishes
 * time series, not a calendar, so `getCalendar` reports `not-supported`
 * instead of fabricating scheduled events.
 */

/** The series the Gold macro panel tracks, with the FRED ids behind them. */
export const FRED_SERIES = {
  DXY: { id: 'DTWEXBGS', label: 'US Dollar Index (broad, goods & services)' },
  US2Y: { id: 'DGS2', label: 'US 2-Year Treasury yield' },
  US10Y: { id: 'DGS10', label: 'US 10-Year Treasury yield' },
  REAL10Y: { id: 'DFII10', label: 'US 10-Year TIPS (real) yield' },
  FEDFUNDS: { id: 'DFF', label: 'Effective federal funds rate' },
  CPI: { id: 'CPIAUCSL', label: 'CPI, all urban consumers' },
  CORE_CPI: { id: 'CPILFESL', label: 'Core CPI (ex food & energy)' },
  PCE: { id: 'PCEPI', label: 'PCE price index' },
  CORE_PCE: { id: 'PCEPILFE', label: 'Core PCE price index' },
  NFP: { id: 'PAYEMS', label: 'Total nonfarm payrolls' },
  UNEMPLOYMENT: { id: 'UNRATE', label: 'Unemployment rate' },
  VIX: { id: 'VIXCLS', label: 'CBOE Volatility Index' },
  GOLD: { id: 'IQ12260', label: 'Gold fixing price, London (3pm)' },
  SP500: { id: 'SP500', label: 'S&P 500' },
  NASDAQ: { id: 'NASDAQCOM', label: 'NASDAQ Composite' },
  OIL: { id: 'DCOILWTICO', label: 'WTI crude oil' },
  SILVER: { id: 'SLVPRUSD', label: 'Silver price' },
} as const;

export type FredSeriesKey = keyof typeof FRED_SERIES;

export interface FredConfig {
  apiKey: string;
  baseUrl?: string;
}

export class FredProvider implements EconomicDataProvider {
  readonly info: ProviderInfo;

  private readonly baseUrl: string;

  constructor(private readonly config: FredConfig) {
    this.baseUrl = config.baseUrl ?? 'https://api.stlouisfed.org/fred';
    this.info = {
      id: 'fred',
      name: 'FRED (St. Louis Fed)',
      configured: Boolean(config.apiKey),
      website: 'https://fred.stlouisfed.org/docs/api/fred/',
      setupHint: 'Set FRED_API_KEY in your .env. A key is free.',
    };
  }

  async getCalendar(_request: CalendarRequest): Promise<DataResult<EconomicEvent[]>> {
    return unavailable(
      'fred',
      'not-supported',
      'FRED publishes time series, not a scheduled events calendar. Configure Trading Economics for the calendar.',
    );
  }

  async getSeries(seriesId: string, from?: number, to?: number): Promise<DataResult<MacroSeries>> {
    if (!this.info.configured) {
      return unavailable('fred', 'not-configured', 'FRED_API_KEY is not set.');
    }

    try {
      const [meta, observations] = await Promise.all([
        getJson<{ seriess?: { id: string; title: string; units: string; frequency: string; last_updated: string }[] }>(
          `${this.baseUrl}/series`,
          { query: { series_id: seriesId, api_key: this.config.apiKey, file_type: 'json' } },
        ),
        getJson<{ observations?: { date: string; value: string }[] }>(
          `${this.baseUrl}/series/observations`,
          {
            query: {
              series_id: seriesId,
              api_key: this.config.apiKey,
              file_type: 'json',
              observation_start: from
                ? DateTime.fromSeconds(from, { zone: 'utc' }).toFormat('yyyy-LL-dd')
                : undefined,
              observation_end: to
                ? DateTime.fromSeconds(to, { zone: 'utc' }).toFormat('yyyy-LL-dd')
                : undefined,
            },
          },
        ),
      ]);

      const info = meta.seriess?.[0];
      // FRED writes "." for a missing observation. It is dropped, never zeroed.
      const points = (observations.observations ?? [])
        .filter((row) => row.value !== '.' && Number.isFinite(Number(row.value)))
        .map((row) => ({
          time: Math.floor(DateTime.fromISO(row.date, { zone: 'utc' }).toSeconds()),
          value: Number(row.value),
        }));

      if (points.length === 0) {
        return unavailable('fred', 'no-data', `FRED returned no usable observations for ${seriesId}.`);
      }

      return ok(
        {
          id: seriesId,
          title: info?.title ?? seriesId,
          units: info?.units ?? null,
          frequency: info?.frequency ?? null,
          points,
          lastUpdated: info?.last_updated
            ? Math.floor(DateTime.fromSQL(info.last_updated, { zone: 'utc' }).toSeconds())
            : null,
          source: 'FRED',
        },
        'fred',
      );
    } catch (error) {
      return toUnavailable('fred', error);
    }
  }
}

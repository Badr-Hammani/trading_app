import type {
  Candle,
  CandleSeries,
  DataResult,
  InstrumentSpec,
  Quote,
  Timeframe,
} from '@xau/core';

/**
 * Provider contracts.
 *
 * Every provider is replaceable without touching the application: the app
 * depends on these interfaces, never on a vendor. A provider that cannot
 * answer returns `unavailable` with a reason — it never guesses, and it never
 * returns a stale value without saying so.
 */

export interface ProviderInfo {
  id: string;
  name: string;
  /** Whether the required credentials/settings are present. */
  configured: boolean;
  /** Documentation or signup URL, shown in Settings. */
  website?: string;
  /** Free-text note shown when the provider is not configured. */
  setupHint?: string;
}

export interface CandleRequest {
  symbol: string;
  timeframe: Timeframe;
  /** Inclusive lower bound, epoch seconds. */
  from?: number;
  /** Inclusive upper bound, epoch seconds. */
  to?: number;
  /** Maximum bars to return, newest-last. */
  limit?: number;
}

export interface MarketDataProvider {
  readonly info: ProviderInfo;
  getQuote(symbol: string): Promise<DataResult<Quote>>;
  getCandles(request: CandleRequest): Promise<DataResult<CandleSeries>>;
  /** Symbols the provider can serve, when it can enumerate them. */
  listSymbols?(): Promise<DataResult<string[]>>;
}

export type EventImportance = 'high' | 'medium' | 'low';

export interface EconomicEvent {
  /** Stable id used to de-duplicate across refreshes. */
  id: string;
  name: string;
  country: string;
  /** epoch seconds, UTC. */
  time: number;
  importance: EventImportance;
  category: string | null;
  previous: number | null;
  forecast: number | null;
  actual: number | null;
  unit: string | null;
  /** actual - forecast, when both are known. */
  surprise: number | null;
  source: string;
  /**
   * True when the row came from a point-in-time query, i.e. the values are
   * what was known at that moment rather than later revisions. Backtests must
   * only use point-in-time rows.
   */
  pointInTime: boolean;
  reference: string | null;
}

export interface CalendarRequest {
  from: number;
  to: number;
  countries?: string[];
  /** Minimum importance to include. */
  minImportance?: EventImportance;
  /**
   * Ask for the calendar as it stood at this instant (epoch seconds).
   * Providers that cannot do this must return `not-supported` rather than
   * silently serving revised data into a backtest.
   */
  asOf?: number;
}

export interface MacroSeriesPoint {
  time: number;
  value: number;
}

export interface MacroSeries {
  id: string;
  title: string;
  units: string | null;
  frequency: string | null;
  points: MacroSeriesPoint[];
  lastUpdated: number | null;
  source: string;
}

export interface EconomicDataProvider {
  readonly info: ProviderInfo;
  getCalendar(request: CalendarRequest): Promise<DataResult<EconomicEvent[]>>;
  /** Official macro time series (FRED-style), when the provider offers them. */
  getSeries?(seriesId: string, from?: number, to?: number): Promise<DataResult<MacroSeries>>;
}

export interface NewsItem {
  id: string;
  headline: string;
  summary: string | null;
  url: string | null;
  publishedAt: number;
  source: string;
  symbols: string[];
}

export interface NewsProvider {
  readonly info: ProviderInfo;
  getNews(symbols: string[], limit?: number): Promise<DataResult<NewsItem[]>>;
}

export interface BrokerAccount {
  id: string;
  currency: string;
  balance: number;
  equity: number | null;
  marginAvailable: number | null;
  provider: string;
}

/**
 * Broker access is metadata only in version 1.
 *
 * There is deliberately no order-placement method on this interface. Live
 * execution is out of scope and must arrive, if ever, as a separate isolated
 * module — not by widening this one.
 */
export interface BrokerProvider {
  readonly info: ProviderInfo;
  getAccount(): Promise<DataResult<BrokerAccount>>;
  getInstrumentSpec(symbol: string): Promise<DataResult<InstrumentSpec>>;
}

export interface ProviderBundle {
  marketData: MarketDataProvider;
  economic: EconomicDataProvider;
  news: NewsProvider;
  broker: BrokerProvider;
}

/** Timeframe mapping helper shared by REST providers. */
export function mapTimeframe(
  timeframe: Timeframe,
  table: Partial<Record<Timeframe, string>>,
): string | null {
  return table[timeframe] ?? null;
}

/** Sort, de-duplicate and clip a candle array — applied to every provider result. */
export function normaliseCandles(candles: Candle[], limit?: number): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const candle of candles) {
    if (!Number.isFinite(candle.time)) continue;
    if (![candle.open, candle.high, candle.low, candle.close].every(Number.isFinite)) continue;
    byTime.set(candle.time, candle);
  }
  const sorted = [...byTime.values()].sort((a, b) => a.time - b.time);
  return limit && limit > 0 ? sorted.slice(-limit) : sorted;
}

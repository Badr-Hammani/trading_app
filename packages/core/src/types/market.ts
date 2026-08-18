/**
 * Market primitives.
 *
 * Every datapoint that enters the application carries provenance (see
 * `CandleMeta`). The engines never invent values: a missing field is `null`
 * and must be surfaced to the user as DATA UNAVAILABLE.
 */

export const TIMEFRAMES = ['1M', '5M', '15M', '30M', '1H', '4H', 'D'] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

/** Minutes per timeframe. Daily is treated as 1440 for arithmetic. */
export const TIMEFRAME_MINUTES: Record<Timeframe, number> = {
  '1M': 1,
  '5M': 5,
  '15M': 15,
  '30M': 30,
  '1H': 60,
  '4H': 240,
  D: 1440,
};

export const EXECUTION_TIMEFRAME: Timeframe = '5M';
export const CONFIRMATION_TIMEFRAMES: Timeframe[] = ['5M', '15M'];
export const CONTEXT_TIMEFRAMES: Timeframe[] = ['30M', '1H', '4H'];

export function isTimeframe(value: unknown): value is Timeframe {
  return typeof value === 'string' && (TIMEFRAMES as readonly string[]).includes(value);
}

/** Compare two timeframes by duration. */
export function compareTimeframes(a: Timeframe, b: Timeframe): number {
  return TIMEFRAME_MINUTES[a] - TIMEFRAME_MINUTES[b];
}

/**
 * A single OHLCV bar.
 *
 * `time` is the bar's OPEN time as a Unix epoch in **seconds, UTC**. Storing
 * epoch seconds keeps the engines timezone-free; conversion to the user's
 * timezone happens only at the presentation and session boundary.
 */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Tick volume where real volume is unavailable; `null` when the provider gives none. */
  volume: number | null;
}

/** Provenance attached to every series the app ingests (spec §31 Data Quality). */
export interface CandleMeta {
  provider: string;
  symbol: string;
  timeframe: Timeframe;
  /** Timezone the provider reported timestamps in, before normalisation to UTC. */
  sourceTimezone: string;
  /** Provider-reported timestamp of the newest bar (epoch seconds, UTC). */
  sourceTimestamp: number | null;
  /** When this application received the payload (epoch ms, UTC). */
  receivedAt: number;
}

export interface CandleSeries {
  meta: CandleMeta;
  candles: Candle[];
}

/** A live quote. `ask`/`spread` may be null: many spot feeds publish mid only. */
export interface Quote {
  symbol: string;
  bid: number | null;
  ask: number | null;
  mid: number;
  /** Absolute spread in price units (for XAUUSD: dollars per ounce). */
  spread: number | null;
  /** Previous session close, used for the daily change calculation. */
  previousClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  timestamp: number;
  provider: string;
  /** True when the provider explicitly labels the feed delayed. */
  delayed: boolean;
}

export function dailyChange(quote: Quote): { absolute: number; percent: number } | null {
  if (quote.previousClose === null || quote.previousClose === 0) return null;
  const absolute = quote.mid - quote.previousClose;
  return { absolute, percent: (absolute / quote.previousClose) * 100 };
}

export type Direction = 'long' | 'short';

/** Bias is user-owned. The app never overwrites it without explicit opt-in. */
export const BIASES = ['bullish', 'bearish', 'neutral', 'transitional'] as const;
export type Bias = (typeof BIASES)[number];

/**
 * Instrument contract specification.
 *
 * Never assume a universal Gold lot: brokers differ on contract size and on
 * whether the quote currency matches the account currency.
 */
export interface InstrumentSpec {
  symbol: string;
  displayName: string;
  /** Units of the base asset in one standard lot. XAUUSD is typically 100 oz. */
  contractSize: number;
  /** Smallest price increment the broker quotes. */
  tickSize: number;
  /** Account-currency value of one tick for one standard lot. */
  tickValue: number;
  /** Decimal places used when rendering prices. */
  pricePrecision: number;
  minLot: number;
  maxLot: number;
  lotStep: number;
  quoteCurrency: string;
}

/** A widely used XAUUSD default. Users must confirm it against their broker. */
export const XAUUSD_DEFAULT_SPEC: InstrumentSpec = {
  symbol: 'XAUUSD',
  displayName: 'Gold / US Dollar',
  contractSize: 100,
  tickSize: 0.01,
  tickValue: 1,
  pricePrecision: 2,
  minLot: 0.01,
  maxLot: 100,
  lotStep: 0.01,
  quoteCurrency: 'USD',
};

import type { Candle, CandleSeries, DataResult, Quote, Timeframe } from '@xau/core';
import { ok, unavailable } from '@xau/core';
import { getJson, ProviderError, toUnavailable } from '../http.js';
import { normaliseCandles, type CandleRequest, type MarketDataProvider, type ProviderInfo } from '../types.js';
import { DateTime } from 'luxon';

/**
 * Alpha Vantage provider.
 *
 * Offered as an optional alternative so no single vendor is assumed to be
 * available. Two caveats are surfaced honestly rather than hidden:
 *  - the free tier is heavily rate limited, and the limit arrives as a JSON
 *    "Note" with HTTP 200, which is mapped to a rate-limit result here;
 *  - the endpoints give a mid price only, so the dashboard shows no spread
 *    rather than a made-up one.
 */

const FX_INTERVAL: Partial<Record<Timeframe, string>> = {
  '1M': '1min',
  '5M': '5min',
  '15M': '15min',
  '30M': '30min',
  '1H': '60min',
};

export interface AlphaVantageConfig {
  apiKey: string;
  baseUrl?: string;
}

interface AlphaSeriesPayload {
  Note?: string;
  Information?: string;
  'Error Message'?: string;
  [key: string]: unknown;
}

export class AlphaVantageMarketDataProvider implements MarketDataProvider {
  readonly info: ProviderInfo;

  private readonly baseUrl: string;

  constructor(private readonly config: AlphaVantageConfig) {
    this.baseUrl = config.baseUrl ?? 'https://www.alphavantage.co/query';
    this.info = {
      id: 'alpha-vantage',
      name: 'Alpha Vantage',
      configured: Boolean(config.apiKey),
      website: 'https://www.alphavantage.co/documentation/',
      setupHint: 'Set ALPHA_VANTAGE_API_KEY in your .env. The free tier is rate limited.',
    };
  }

  private guardRateLimit(payload: AlphaSeriesPayload): void {
    // Alpha Vantage answers a throttled request with HTTP 200 and a note.
    const note = payload.Note ?? payload.Information;
    if (typeof note === 'string' && /call frequency|premium|rate limit/i.test(note)) {
      throw new ProviderError(note, 'rate-limited', 60);
    }
    if (typeof payload['Error Message'] === 'string') {
      throw new ProviderError(String(payload['Error Message']), 'provider-error');
    }
  }

  /** XAUUSD is requested as the XAU→USD currency pair. */
  private pair(symbol: string): { from: string; to: string } | null {
    if (symbol.length !== 6) return null;
    return { from: symbol.slice(0, 3), to: symbol.slice(3) };
  }

  async getQuote(symbol: string): Promise<DataResult<Quote>> {
    if (!this.info.configured) {
      return unavailable('alpha-vantage', 'not-configured', 'ALPHA_VANTAGE_API_KEY is not set.');
    }
    const pair = this.pair(symbol);
    if (!pair) {
      return unavailable('alpha-vantage', 'not-supported', `Cannot map ${symbol} to a currency pair.`);
    }

    try {
      const payload = await getJson<AlphaSeriesPayload & {
        'Realtime Currency Exchange Rate'?: Record<string, string>;
      }>(this.baseUrl, {
        query: {
          function: 'CURRENCY_EXCHANGE_RATE',
          from_currency: pair.from,
          to_currency: pair.to,
          apikey: this.config.apiKey,
        },
      });
      this.guardRateLimit(payload);

      const rate = payload['Realtime Currency Exchange Rate'];
      const mid = Number(rate?.['5. Exchange Rate']);
      if (!rate || !Number.isFinite(mid)) {
        return unavailable('alpha-vantage', 'no-data', `No exchange rate returned for ${symbol}.`);
      }

      const bid = Number(rate['8. Bid Price']);
      const ask = Number(rate['9. Ask Price']);
      const hasBook = Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0;

      const daily = await this.getCandles({ symbol, timeframe: 'D', limit: 2 });
      const previousClose =
        daily.status === 'ok' && daily.data.candles.length >= 2
          ? (daily.data.candles[daily.data.candles.length - 2]?.close ?? null)
          : null;

      return ok(
        {
          symbol,
          bid: hasBook ? bid : null,
          ask: hasBook ? ask : null,
          mid,
          spread: hasBook ? ask - bid : null,
          previousClose,
          dayHigh: null,
          dayLow: null,
          timestamp: Math.floor(Date.now() / 1000),
          provider: 'alpha-vantage',
          delayed: true,
        },
        'alpha-vantage',
        { delaySeconds: 60 },
      );
    } catch (error) {
      return toUnavailable('alpha-vantage', error);
    }
  }

  async getCandles(request: CandleRequest): Promise<DataResult<CandleSeries>> {
    if (!this.info.configured) {
      return unavailable('alpha-vantage', 'not-configured', 'ALPHA_VANTAGE_API_KEY is not set.');
    }
    const pair = this.pair(request.symbol);
    if (!pair) {
      return unavailable('alpha-vantage', 'not-supported', `Cannot map ${request.symbol} to a currency pair.`);
    }

    const intraday = FX_INTERVAL[request.timeframe];
    if (!intraday && request.timeframe !== 'D' && request.timeframe !== '4H') {
      return unavailable(
        'alpha-vantage',
        'not-supported',
        `Alpha Vantage does not serve the ${request.timeframe} timeframe for FX pairs.`,
      );
    }
    if (request.timeframe === '4H') {
      return unavailable(
        'alpha-vantage',
        'not-supported',
        'Alpha Vantage has no native 4H FX series. Use OANDA, or import 4H data as CSV.',
      );
    }

    try {
      const fn = intraday ? 'FX_INTRADAY' : 'FX_DAILY';
      const payload = await getJson<AlphaSeriesPayload>(this.baseUrl, {
        query: {
          function: fn,
          from_symbol: pair.from,
          to_symbol: pair.to,
          interval: intraday,
          outputsize: 'full',
          apikey: this.config.apiKey,
        },
      });
      this.guardRateLimit(payload);

      const seriesKey = Object.keys(payload).find((key) => key.startsWith('Time Series'));
      const series = seriesKey ? (payload[seriesKey] as Record<string, Record<string, string>>) : null;
      if (!series) {
        return unavailable('alpha-vantage', 'no-data', `No series returned for ${request.symbol}.`);
      }

      // Intraday timestamps are US/Eastern wall times; daily rows are dates.
      const zone = intraday ? 'America/New_York' : 'UTC';
      const candles: Candle[] = Object.entries(series).map(([timestamp, values]) => ({
        time: Math.floor(DateTime.fromSQL(timestamp, { zone }).toSeconds()),
        open: Number(values['1. open']),
        high: Number(values['2. high']),
        low: Number(values['3. low']),
        close: Number(values['4. close']),
        volume: null,
      }));

      const filtered = candles.filter(
        (candle) =>
          (!request.from || candle.time >= request.from) && (!request.to || candle.time <= request.to),
      );
      const normalised = normaliseCandles(filtered, request.limit);

      if (normalised.length === 0) {
        return unavailable('alpha-vantage', 'no-data', 'No candles matched the requested window.');
      }

      return ok(
        {
          meta: {
            provider: 'alpha-vantage',
            symbol: request.symbol,
            timeframe: request.timeframe,
            sourceTimezone: zone,
            sourceTimestamp: normalised[normalised.length - 1]!.time,
            receivedAt: Date.now(),
          },
          candles: normalised,
        },
        'alpha-vantage',
        { delaySeconds: 60 },
      );
    } catch (error) {
      return toUnavailable('alpha-vantage', error);
    }
  }
}

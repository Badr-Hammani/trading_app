import type { Candle, CandleSeries, DataResult, Quote, Timeframe } from '@xau/core';
import { ok, unavailable } from '@xau/core';
import { getJson, ProviderError, toUnavailable } from '../http.js';
import { normaliseCandles, type CandleRequest, type MarketDataProvider, type ProviderInfo } from '../types.js';
import { cached } from '../cache.js';
import { DateTime } from 'luxon';

/**
 * Twelve Data provider.
 *
 * Provides real-time quotes and intraday/daily OHLCV candles for XAU/USD.
 * Free tier limit is 8 requests/minute — answers are aggressively cached for 60s
 * to prevent rate limit exhaustion.
 */

const INTERVAL_MAP: Record<Timeframe, string> = {
  '1M': '1min',
  '5M': '5min',
  '15M': '15min',
  '30M': '30min',
  '1H': '1h',
  '4H': '4h',
  'D': '1day',
};

export interface TwelveDataConfig {
  apiKey: string;
  baseUrl?: string;
}

interface TwelveDataQuotePayload {
  symbol?: string;
  close?: string;
  open?: string;
  high?: string;
  low?: string;
  previous_close?: string;
  timestamp?: number;
  status?: string;
  message?: string;
  code?: number;
}

interface TwelveDataSeriesPayload {
  status?: string;
  message?: string;
  code?: number;
  values?: Array<{
    datetime: string;
    open: string;
    high: string;
    low: string;
    close: string;
    volume?: string;
  }>;
}

export class TwelveDataMarketDataProvider implements MarketDataProvider {
  readonly info: ProviderInfo;

  private readonly baseUrl: string;

  constructor(private readonly config: TwelveDataConfig) {
    this.baseUrl = config.baseUrl ?? 'https://api.twelvedata.com';
    this.info = {
      id: 'twelve-data',
      name: 'Twelve Data',
      configured: Boolean(config.apiKey),
      website: 'https://twelvedata.com/',
      setupHint: 'Set TWELVE_DATA_API_KEY in your .env.',
    };
  }

  private mapSymbol(symbol: string): string {
    if (symbol.toUpperCase() === 'XAUUSD') return 'XAU/USD';
    return symbol;
  }

  async getQuote(symbol: string): Promise<DataResult<Quote>> {
    const key = `twelve-data:quote:${symbol}`;
    return cached(key, { ttlMs: 30000, maxStaleMs: 600000 }, () => this.fetchQuote(symbol));
  }

  private async fetchQuote(symbol: string): Promise<DataResult<Quote>> {
    if (!this.info.configured) {
      return unavailable('twelve-data', 'not-configured', 'TWELVE_DATA_API_KEY is not set.');
    }

    try {
      const mapped = this.mapSymbol(symbol);
      const payload = await getJson<TwelveDataQuotePayload>(`${this.baseUrl}/quote`, {
        query: {
          symbol: mapped,
          apikey: this.config.apiKey,
        },
      });

      if (payload.status === 'error' || payload.code) {
        const msg = payload.message ?? 'Twelve Data error';
        if (payload.code === 429 || /api limit|rate limit/i.test(msg)) {
          throw new ProviderError(msg, 'rate-limited', 60);
        }
        throw new ProviderError(msg, 'provider-error');
      }

      const mid = Number(payload.close);
      if (!payload.close || !Number.isFinite(mid)) {
        return unavailable('twelve-data', 'no-data', `No quote returned for ${symbol}.`);
      }

      const open = Number(payload.open);
      const high = Number(payload.high);
      const low = Number(payload.low);
      const previousClose = Number(payload.previous_close);

      return ok(
        {
          symbol,
          bid: null,
          ask: null,
          mid,
          spread: null,
          previousClose: Number.isFinite(previousClose) ? previousClose : null,
          dayHigh: Number.isFinite(high) ? high : null,
          dayLow: Number.isFinite(low) ? low : null,
          timestamp: payload.timestamp ?? Math.floor(Date.now() / 1000),
          provider: 'twelve-data',
          delayed: false,
        },
        'twelve-data',
        { delaySeconds: 10 },
      );
    } catch (error) {
      return toUnavailable('twelve-data', error);
    }
  }

  async getCandles(request: CandleRequest): Promise<DataResult<CandleSeries>> {
    const key = `twelve-data:candles:${request.symbol}:${request.timeframe}:${request.limit ?? 500}`;
    return cached(key, { ttlMs: 60000, maxStaleMs: 600000 }, () => this.fetchCandles(request));
  }

  private async fetchCandles(request: CandleRequest): Promise<DataResult<CandleSeries>> {
    if (!this.info.configured) {
      return unavailable('twelve-data', 'not-configured', 'TWELVE_DATA_API_KEY is not set.');
    }

    const interval = INTERVAL_MAP[request.timeframe];
    if (!interval) {
      return unavailable(
        'twelve-data',
        'not-supported',
        `Twelve Data does not support the ${request.timeframe} timeframe.`,
      );
    }

    try {
      const mapped = this.mapSymbol(request.symbol);
      const limit = Math.min(request.limit ?? 500, 500);

      const payload = await getJson<TwelveDataSeriesPayload>(`${this.baseUrl}/time_series`, {
        query: {
          symbol: mapped,
          interval,
          outputsize: String(limit),
          apikey: this.config.apiKey,
        },
      });

      if (payload.status === 'error' || payload.code) {
        const msg = payload.message ?? 'Twelve Data error';
        if (payload.code === 429 || /api limit|rate limit/i.test(msg)) {
          throw new ProviderError(msg, 'rate-limited', 60);
        }
        throw new ProviderError(msg, 'provider-error');
      }

      if (!payload.values || !Array.isArray(payload.values)) {
        return unavailable('twelve-data', 'no-data', `No series returned for ${request.symbol}.`);
      }

      // Twelve Data returns newest first. Parse ISO/SQL timestamps.
      const candles: Candle[] = payload.values.map((v) => {
        const dt = DateTime.fromSQL(v.datetime, { zone: 'UTC' });
        return {
          time: Math.floor(dt.toSeconds()),
          open: Number(v.open),
          high: Number(v.high),
          low: Number(v.low),
          close: Number(v.close),
          volume: v.volume ? Number(v.volume) : null,
        };
      }).reverse(); // Sort oldest first

      const filtered = candles.filter(
        (candle) =>
          (!request.from || candle.time >= request.from) && (!request.to || candle.time <= request.to),
      );
      const normalised = normaliseCandles(filtered, request.limit);

      if (normalised.length === 0) {
        return unavailable('twelve-data', 'no-data', 'No candles matched the requested window.');
      }

      return ok(
        {
          meta: {
            provider: 'twelve-data',
            symbol: request.symbol,
            timeframe: request.timeframe,
            sourceTimezone: 'UTC',
            sourceTimestamp: normalised[normalised.length - 1]!.time,
            receivedAt: Date.now(),
          },
          candles: normalised,
        },
        'twelve-data',
        { delaySeconds: 10 },
      );
    } catch (error) {
      return toUnavailable('twelve-data', error);
    }
  }
}

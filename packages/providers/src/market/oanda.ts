import type { Candle, CandleSeries, DataResult, Quote, Timeframe } from '@xau/core';
import { ok, unavailable } from '@xau/core';
import { getJson, toUnavailable } from '../http.js';
import { normaliseCandles, type CandleRequest, type MarketDataProvider, type ProviderInfo } from '../types.js';

/**
 * OANDA v20 REST provider.
 *
 * Quotes come from the pricing endpoint, which gives a genuine bid and ask —
 * the only way the dashboard can show a real spread rather than inventing one.
 */

const GRANULARITY: Record<Timeframe, string> = {
  '1M': 'M1',
  '5M': 'M5',
  '15M': 'M15',
  '30M': 'M30',
  '1H': 'H1',
  '4H': 'H4',
  D: 'D',
};

export interface OandaConfig {
  apiKey: string;
  accountId: string;
  /** Practice or live host. */
  environment?: 'practice' | 'live';
  /** OANDA names gold XAU_USD; the app speaks XAUUSD. */
  symbolMap?: Record<string, string>;
}

interface OandaCandle {
  time: string;
  volume?: number;
  complete?: boolean;
  mid?: { o: string; h: string; l: string; c: string };
}

export class OandaMarketDataProvider implements MarketDataProvider {
  readonly info: ProviderInfo;

  private readonly host: string;

  constructor(private readonly config: OandaConfig) {
    this.host =
      config.environment === 'live'
        ? 'https://api-fxtrade.oanda.com'
        : 'https://api-fxpractice.oanda.com';

    this.info = {
      id: 'oanda',
      name: 'OANDA v20',
      configured: Boolean(config.apiKey && config.accountId),
      website: 'https://developer.oanda.com/rest-live-v20/introduction/',
      setupHint: 'Set OANDA_API_KEY and OANDA_ACCOUNT_ID in your .env.',
    };
  }

  private instrument(symbol: string): string {
    return this.config.symbolMap?.[symbol] ?? (symbol === 'XAUUSD' ? 'XAU_USD' : symbol);
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.config.apiKey}` };
  }

  async getQuote(symbol: string): Promise<DataResult<Quote>> {
    if (!this.info.configured) {
      return unavailable('oanda', 'not-configured', 'OANDA credentials are not set.');
    }

    try {
      const instrument = this.instrument(symbol);
      const pricing = await getJson<{
        prices?: {
          instrument: string;
          time: string;
          tradeable?: boolean;
          bids?: { price: string }[];
          asks?: { price: string }[];
          closeoutBid?: string;
          closeoutAsk?: string;
        }[];
      }>(`${this.host}/v3/accounts/${this.config.accountId}/pricing`, {
        headers: this.headers(),
        query: { instruments: instrument },
      });

      const price = pricing.prices?.[0];
      if (!price) {
        return unavailable('oanda', 'no-data', `OANDA returned no price for ${instrument}.`);
      }

      const bid = Number(price.bids?.[0]?.price ?? price.closeoutBid);
      const ask = Number(price.asks?.[0]?.price ?? price.closeoutAsk);
      if (!Number.isFinite(bid) || !Number.isFinite(ask)) {
        return unavailable('oanda', 'no-data', 'OANDA price payload had no usable bid/ask.');
      }

      // The daily change needs yesterday's close, which pricing does not carry.
      const daily = await this.getCandles({ symbol, timeframe: 'D', limit: 2 });
      const previousClose =
        daily.status === 'ok' && daily.data.candles.length >= 2
          ? (daily.data.candles[daily.data.candles.length - 2]?.close ?? null)
          : null;
      const today =
        daily.status === 'ok' ? daily.data.candles[daily.data.candles.length - 1] : undefined;

      return ok(
        {
          symbol,
          bid,
          ask,
          mid: (bid + ask) / 2,
          spread: ask - bid,
          previousClose,
          dayHigh: today?.high ?? null,
          dayLow: today?.low ?? null,
          timestamp: Math.floor(new Date(price.time).getTime() / 1000),
          provider: 'oanda',
          delayed: false,
        },
        'oanda',
      );
    } catch (error) {
      return toUnavailable('oanda', error);
    }
  }

  async getCandles(request: CandleRequest): Promise<DataResult<CandleSeries>> {
    if (!this.info.configured) {
      return unavailable('oanda', 'not-configured', 'OANDA credentials are not set.');
    }

    const granularity = GRANULARITY[request.timeframe];
    const instrument = this.instrument(request.symbol);

    try {
      const payload = await getJson<{ candles?: OandaCandle[] }>(
        `${this.host}/v3/instruments/${instrument}/candles`,
        {
          headers: this.headers(),
          query: {
            granularity,
            price: 'M',
            count: request.from ? undefined : (request.limit ?? 500),
            from: request.from ? new Date(request.from * 1000).toISOString() : undefined,
            to: request.to ? new Date(request.to * 1000).toISOString() : undefined,
          },
        },
      );

      const raw = payload.candles ?? [];
      // Incomplete candles are excluded: a forming bar changes under you and
      // would make indicator output non-reproducible.
      const candles: Candle[] = raw
        .filter((candle) => candle.complete !== false && candle.mid)
        .map((candle) => ({
          time: Math.floor(new Date(candle.time).getTime() / 1000),
          open: Number(candle.mid!.o),
          high: Number(candle.mid!.h),
          low: Number(candle.mid!.l),
          close: Number(candle.mid!.c),
          volume: candle.volume ?? null,
        }));

      const normalised = normaliseCandles(candles, request.limit);
      if (normalised.length === 0) {
        return unavailable('oanda', 'no-data', `OANDA returned no candles for ${instrument} ${request.timeframe}.`);
      }

      return ok(
        {
          meta: {
            provider: 'oanda',
            symbol: request.symbol,
            timeframe: request.timeframe,
            sourceTimezone: 'UTC',
            sourceTimestamp: normalised[normalised.length - 1]!.time,
            receivedAt: Date.now(),
          },
          candles: normalised,
        },
        'oanda',
      );
    } catch (error) {
      return toUnavailable('oanda', error);
    }
  }
}

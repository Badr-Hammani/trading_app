import type { Candle, CandleSeries, DataResult, Quote, Timeframe } from '@xau/core';
import { ok, unavailable } from '@xau/core';
import { normaliseCandles, type CandleRequest, type MarketDataProvider, type ProviderInfo } from '../types.js';

/**
 * Locally stored series (CSV imports, saved history).
 *
 * This is what makes the free-first promise real: with no API key at all, the
 * charts, replay, backtesting and statistics run entirely on imported data.
 *
 * The loader is injected so this package stays free of any database
 * dependency — the web app supplies a function that reads from Postgres.
 */

export type LocalSeriesLoader = (
  symbol: string,
  timeframe: Timeframe,
  from?: number,
  to?: number,
  limit?: number,
) => Promise<{ candles: Candle[]; importedFrom: string | null } | null>;

export class LocalSeriesProvider implements MarketDataProvider {
  readonly info: ProviderInfo;

  constructor(private readonly loader: LocalSeriesLoader) {
    this.info = {
      id: 'local',
      name: 'Imported data (CSV / stored history)',
      configured: true,
      setupHint: 'Import OHLCV CSV under Settings → Data. No API key required.',
    };
  }

  /**
   * The most recent stored close, explicitly labelled delayed. Imported
   * history is not a live feed and the UI must not present it as one.
   */
  async getQuote(symbol: string): Promise<DataResult<Quote>> {
    const series = await this.loader(symbol, '5M', undefined, undefined, 2);
    const candles = series?.candles ?? [];
    const last = candles[candles.length - 1];
    if (!last) {
      return unavailable('local', 'no-data', `No imported data stored for ${symbol}.`);
    }

    const daily = await this.loader(symbol, 'D', undefined, undefined, 2);
    const previousClose = daily?.candles[daily.candles.length - 2]?.close ?? null;
    const today = daily?.candles[daily.candles.length - 1];
    const ageSeconds = Math.floor(Date.now() / 1000) - last.time;

    return ok(
      {
        symbol,
        bid: null,
        ask: null,
        mid: last.close,
        spread: null,
        previousClose,
        dayHigh: today?.high ?? null,
        dayLow: today?.low ?? null,
        timestamp: last.time,
        provider: 'local',
        delayed: true,
      },
      'local',
      { delaySeconds: Math.max(0, ageSeconds) },
    );
  }

  async getCandles(request: CandleRequest): Promise<DataResult<CandleSeries>> {
    const series = await this.loader(
      request.symbol,
      request.timeframe,
      request.from,
      request.to,
      request.limit,
    );
    const candles = normaliseCandles(series?.candles ?? [], request.limit);

    if (candles.length === 0) {
      return unavailable(
        'local',
        'no-data',
        `No imported ${request.timeframe} data for ${request.symbol}. Import a CSV under Settings → Data.`,
      );
    }

    return ok(
      {
        meta: {
          provider: 'local',
          symbol: request.symbol,
          timeframe: request.timeframe,
          sourceTimezone: 'UTC',
          sourceTimestamp: candles[candles.length - 1]!.time,
          receivedAt: Date.now(),
        },
        candles,
      },
      'local',
    );
  }
}

/**
 * Try providers in order and return the first that answers.
 *
 * The reasons from every failed attempt are preserved, so the UI can explain
 * exactly why nothing is available instead of a generic error.
 */
export class FallbackMarketDataProvider implements MarketDataProvider {
  readonly info: ProviderInfo;

  constructor(private readonly providers: MarketDataProvider[]) {
    const configured = providers.filter((provider) => provider.info.configured);
    this.info = {
      id: 'chain',
      name: configured.map((provider) => provider.info.name).join(' → ') || 'No provider configured',
      configured: configured.length > 0,
    };
  }

  private async attempt<T>(
    call: (provider: MarketDataProvider) => Promise<DataResult<T>>,
  ): Promise<DataResult<T>> {
    const reasons: string[] = [];
    for (const provider of this.providers) {
      const result = await call(provider);
      if (result.status === 'ok') return result;
      reasons.push(`${provider.info.name}: ${result.message}`);
    }
    return unavailable(
      'chain',
      'no-data',
      reasons.length > 0 ? reasons.join(' | ') : 'No providers are configured.',
    );
  }

  getQuote(symbol: string): Promise<DataResult<Quote>> {
    return this.attempt((provider) => provider.getQuote(symbol));
  }

  getCandles(request: CandleRequest): Promise<DataResult<CandleSeries>> {
    return this.attempt((provider) => provider.getCandles(request));
  }
}

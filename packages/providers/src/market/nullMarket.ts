import type { CandleSeries, DataResult, Quote } from '@xau/core';
import { unavailable } from '@xau/core';
import type { CandleRequest, MarketDataProvider, ProviderInfo } from '../types.js';

/**
 * The provider used when nothing is configured.
 *
 * It exists so the rest of the application has a real object to talk to and
 * so the UI receives a precise reason to display. It never returns a price.
 */
export class NullMarketDataProvider implements MarketDataProvider {
  readonly info: ProviderInfo;

  constructor(private readonly reason = 'No market data provider is configured.') {
    this.info = {
      id: 'none',
      name: 'No provider configured',
      configured: false,
      setupHint:
        'Add OANDA_API_KEY or ALPHA_VANTAGE_API_KEY to your .env, or import a CSV under Settings → Data to work fully offline.',
    };
  }

  async getQuote(): Promise<DataResult<Quote>> {
    return unavailable('none', 'not-configured', this.reason);
  }

  async getCandles(_request: CandleRequest): Promise<DataResult<CandleSeries>> {
    return unavailable('none', 'not-configured', this.reason);
  }
}

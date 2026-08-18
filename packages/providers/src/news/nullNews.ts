import type { DataResult } from '@xau/core';
import { unavailable } from '@xau/core';
import type { NewsItem, NewsProvider, ProviderInfo } from '../types.js';

export class NullNewsProvider implements NewsProvider {
  readonly info: ProviderInfo = {
    id: 'none',
    name: 'No news provider configured',
    configured: false,
    setupHint: 'Headlines are optional. The economic calendar covers scheduled event risk.',
  };

  async getNews(): Promise<DataResult<NewsItem[]>> {
    return unavailable('none', 'not-configured', 'No news provider is configured.');
  }
}

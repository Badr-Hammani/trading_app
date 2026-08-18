import type { DataResult } from '@xau/core';
import { unavailable } from '@xau/core';
import type {
  CalendarRequest,
  EconomicDataProvider,
  EconomicEvent,
  MacroSeries,
  ProviderInfo,
} from '../types.js';

export class NullEconomicProvider implements EconomicDataProvider {
  readonly info: ProviderInfo = {
    id: 'none',
    name: 'No economic provider configured',
    configured: false,
    setupHint:
      'Set TRADING_ECONOMICS_API_KEY for the calendar and FRED_API_KEY for macro series. The rest of the app works without them.',
  };

  async getCalendar(_request: CalendarRequest): Promise<DataResult<EconomicEvent[]>> {
    return unavailable('none', 'not-configured', 'No economic calendar provider is configured.');
  }

  async getSeries(_seriesId: string): Promise<DataResult<MacroSeries>> {
    return unavailable('none', 'not-configured', 'No macro data provider is configured.');
  }
}

/**
 * Calendar events the user entered by hand.
 *
 * Keeps the calendar and the news filter usable with no API key at all: a
 * trader who types in "CPI, Thursday 13:30" gets the same countdown and the
 * same news-window behaviour as an API-fed event.
 */
export type ManualEventLoader = (from: number, to: number) => Promise<EconomicEvent[]>;

export class ManualEconomicProvider implements EconomicDataProvider {
  readonly info: ProviderInfo = {
    id: 'manual',
    name: 'Manually entered events',
    configured: true,
    setupHint: 'Add events under Calendar → Add event. No API key required.',
  };

  constructor(private readonly loader: ManualEventLoader) {}

  async getCalendar(request: CalendarRequest): Promise<DataResult<EconomicEvent[]>> {
    const events = await this.loader(request.from, request.to);
    const rank = { low: 0, medium: 1, high: 2 } as const;
    const threshold = rank[request.minImportance ?? 'low'];

    return {
      status: 'ok',
      data: events
        .filter((event) => rank[event.importance] >= threshold)
        .sort((a, b) => a.time - b.time),
      provider: 'manual',
      fetchedAt: Date.now(),
    };
  }
}

/** Merge several calendar providers, de-duplicating by name and time. */
export class MergedEconomicProvider implements EconomicDataProvider {
  readonly info: ProviderInfo;

  constructor(private readonly providers: EconomicDataProvider[]) {
    const configured = providers.filter((provider) => provider.info.configured);
    this.info = {
      id: 'merged',
      name: configured.map((provider) => provider.info.name).join(' + ') || 'No provider configured',
      configured: configured.length > 0,
    };
  }

  async getCalendar(request: CalendarRequest): Promise<DataResult<EconomicEvent[]>> {
    const events: EconomicEvent[] = [];
    const failures: string[] = [];

    for (const provider of this.providers) {
      const result = await provider.getCalendar(request);
      if (result.status === 'ok') events.push(...result.data);
      else if (result.reason !== 'not-configured' && result.reason !== 'not-supported') {
        failures.push(`${provider.info.name}: ${result.message}`);
      }
    }

    if (events.length === 0) {
      return unavailable(
        'merged',
        failures.length > 0 ? 'provider-error' : 'not-configured',
        failures.length > 0
          ? failures.join(' | ')
          : 'No economic calendar provider is configured. Add events manually or set TRADING_ECONOMICS_API_KEY.',
      );
    }

    const seen = new Set<string>();
    const merged = events
      .filter((event) => {
        // Same event name within five minutes is the same release.
        const key = `${event.country}|${event.name.toLowerCase()}|${Math.round(event.time / 300)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.time - b.time);

    return { status: 'ok', data: merged, provider: 'merged', fetchedAt: Date.now() };
  }

  async getSeries(seriesId: string, from?: number, to?: number): Promise<DataResult<MacroSeries>> {
    for (const provider of this.providers) {
      if (!provider.getSeries) continue;
      const result = await provider.getSeries(seriesId, from, to);
      if (result.status === 'ok') return result;
    }
    return unavailable('merged', 'not-configured', `No configured provider serves the series ${seriesId}.`);
  }
}

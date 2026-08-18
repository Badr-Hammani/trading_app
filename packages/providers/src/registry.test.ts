import { describe, expect, it } from 'vitest';
import { buildEconomicProvider, buildMarketDataProvider, buildProviders, describeProviders } from './registry.js';
import { NullMarketDataProvider } from './market/nullMarket.js';
import { TtlCache, cached } from './cache.js';
import { ok, unavailable } from '@xau/core';

describe('provider registry', () => {
  it('falls back to an explicit null provider when nothing is configured', async () => {
    const provider = buildMarketDataProvider({ env: {} });
    const quote = await provider.getQuote('XAUUSD');

    expect(quote.status).toBe('unavailable');
    if (quote.status === 'unavailable') {
      expect(quote.reason).toBe('not-configured');
      expect(quote.message).toMatch(/no market data provider is configured/i);
    }
  });

  it('never returns a fabricated price', async () => {
    const provider = new NullMarketDataProvider();
    const candles = await provider.getCandles({ symbol: 'XAUUSD', timeframe: '5M' });
    expect(candles.status).toBe('unavailable');
  });

  it('keeps imported data usable with no API keys at all', async () => {
    const provider = buildMarketDataProvider({
      env: {},
      localSeries: async () => ({
        candles: [{ time: 1767600000, open: 2000, high: 2005, low: 1999, close: 2004, volume: 10 }],
        importedFrom: 'test.csv',
      }),
    });

    const result = await provider.getCandles({ symbol: 'XAUUSD', timeframe: '5M' });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.data.candles).toHaveLength(1);
      expect(result.data.meta.provider).toBe('local');
    }
  });

  it('labels imported data as delayed rather than live', async () => {
    const provider = buildMarketDataProvider({
      env: {},
      localSeries: async () => ({
        candles: [{ time: 1767600000, open: 2000, high: 2005, low: 1999, close: 2004, volume: 10 }],
        importedFrom: 'test.csv',
      }),
    });
    const quote = await provider.getQuote('XAUUSD');
    expect(quote.status).toBe('ok');
    if (quote.status === 'ok') {
      expect(quote.data.delayed).toBe(true);
      expect(quote.data.spread).toBeNull();
    }
  });

  it('prefers the configured market provider but keeps the others as fallbacks', () => {
    const provider = buildMarketDataProvider({
      env: {
        OANDA_API_KEY: 'x',
        OANDA_ACCOUNT_ID: 'y',
        ALPHA_VANTAGE_API_KEY: 'z',
        MARKET_DATA_PROVIDER: 'alpha-vantage',
      },
    });
    expect(provider.info.name).toMatch(/^Alpha Vantage/);
    expect(provider.info.name).toMatch(/OANDA/);
  });

  it('serves manually entered calendar events with no API key', async () => {
    const provider = buildEconomicProvider({
      env: {},
      manualEvents: async () => [
        {
          id: '1',
          name: 'Core CPI',
          country: 'United States',
          time: 1767600000,
          importance: 'high',
          category: 'Inflation',
          previous: 0.3,
          forecast: 0.3,
          actual: null,
          unit: '%',
          surprise: null,
          source: 'manual',
          pointInTime: false,
          reference: null,
        },
      ],
    });

    const calendar = await provider.getCalendar({ from: 0, to: 2e9 });
    expect(calendar.status).toBe('ok');
    if (calendar.status === 'ok') expect(calendar.data[0]!.name).toBe('Core CPI');
  });

  it('reports FRED as unable to serve a calendar rather than inventing one', async () => {
    const provider = buildEconomicProvider({ env: { FRED_API_KEY: 'key' } });
    const calendar = await provider.getCalendar({ from: 0, to: 2e9 });
    expect(calendar.status).toBe('unavailable');
    if (calendar.status === 'unavailable') expect(calendar.reason).toBe('not-supported');
  });

  it('exposes provider status without leaking keys', () => {
    const described = describeProviders({ FRED_API_KEY: 'secret-value' });
    const fred = described.find((entry) => entry.id === 'fred')!;
    expect(fred.configured).toBe(true);
    expect(JSON.stringify(described)).not.toContain('secret-value');
  });

  it('builds a complete bundle with a read-only broker', async () => {
    const bundle = buildProviders({ env: {}, account: { balance: 10000, currency: 'USD' } });
    const account = await bundle.broker.getAccount();
    expect(account.status).toBe('ok');
    // Version 1 has no execution surface at all.
    expect('placeOrder' in bundle.broker).toBe(false);
  });
});

describe('cache staleness', () => {
  it('serves a fresh value from cache', async () => {
    const cache = new TtlCache();
    let calls = 0;
    const load = async () => {
      calls += 1;
      return ok({ price: 2000 }, 'test');
    };

    await cached('k', { ttlMs: 10_000 }, load, cache);
    await cached('k', { ttlMs: 10_000 }, load, cache);
    expect(calls).toBe(1);
  });

  it('reports stale rather than silently serving an old value', async () => {
    const cache = new TtlCache();
    cache.set('k', ok({ price: 2000 }, 'test'));

    const result = await cached(
      'k',
      { ttlMs: -1, maxStaleMs: 60_000 },
      async () => unavailable('test', 'network-error', 'feed down'),
      cache,
    );

    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') {
      expect(result.reason).toBe('stale');
      expect(result.message).toMatch(/refresh failed/);
    }
  });

  it('does not cache failures', async () => {
    const cache = new TtlCache();
    await cached('k', { ttlMs: 10_000 }, async () => unavailable('test', 'network-error', 'down'), cache);
    expect(cache.size).toBe(0);
  });
});

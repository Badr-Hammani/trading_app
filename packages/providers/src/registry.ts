import type { InstrumentSpec } from '@xau/core';
import { XAUUSD_DEFAULT_SPEC } from '@xau/core';
import type { BrokerProvider, EconomicDataProvider, MarketDataProvider, NewsProvider, ProviderBundle, ProviderInfo } from './types.js';
import { NullMarketDataProvider } from './market/nullMarket.js';
import { OandaMarketDataProvider } from './market/oanda.js';
import { AlphaVantageMarketDataProvider } from './market/alphaVantage.js';
import { FallbackMarketDataProvider, LocalSeriesProvider, type LocalSeriesLoader } from './market/localSeries.js';
import { TradingEconomicsProvider } from './economic/tradingEconomics.js';
import { FredProvider } from './economic/fred.js';
import {
  ManualEconomicProvider,
  MergedEconomicProvider,
  NullEconomicProvider,
  type ManualEventLoader,
} from './economic/nullEconomic.js';
import { NullNewsProvider } from './news/nullNews.js';
import { ManualBrokerProvider } from './broker/nullBroker.js';

/**
 * Provider registry.
 *
 * Credentials come from the environment and are never hardcoded. Any provider
 * can be swapped by changing this function alone — nothing else in the
 * application knows a vendor name.
 */

export interface ProviderEnv {
  MARKET_DATA_PROVIDER?: string;
  MARKET_DATA_API_KEY?: string;
  TRADING_ECONOMICS_API_KEY?: string;
  FRED_API_KEY?: string;
  ALPHA_VANTAGE_API_KEY?: string;
  OANDA_API_KEY?: string;
  OANDA_ACCOUNT_ID?: string;
  OANDA_ENVIRONMENT?: string;
}

export interface RegistryOptions {
  env: ProviderEnv;
  /** Reads imported CSV / stored candles from the application's database. */
  localSeries?: LocalSeriesLoader;
  /** Reads manually entered calendar events. */
  manualEvents?: ManualEventLoader;
  account?: { balance: number; currency: string } | null;
  instrumentSpecs?: Record<string, InstrumentSpec>;
}

export function buildMarketDataProvider(options: RegistryOptions): MarketDataProvider {
  const { env } = options;
  const chain: MarketDataProvider[] = [];

  const preferred = env.MARKET_DATA_PROVIDER?.toLowerCase();

  const oanda =
    env.OANDA_API_KEY && env.OANDA_ACCOUNT_ID
      ? new OandaMarketDataProvider({
          apiKey: env.OANDA_API_KEY,
          accountId: env.OANDA_ACCOUNT_ID,
          environment: env.OANDA_ENVIRONMENT === 'live' ? 'live' : 'practice',
        })
      : null;

  const alphaKey = env.ALPHA_VANTAGE_API_KEY ?? env.MARKET_DATA_API_KEY;
  const alphaVantage = alphaKey ? new AlphaVantageMarketDataProvider({ apiKey: alphaKey }) : null;

  // An explicit preference goes first; the remaining configured providers stay
  // in the chain as fallbacks so one outage does not blank the dashboard.
  const ordered: (MarketDataProvider | null)[] =
    preferred === 'alpha-vantage' ? [alphaVantage, oanda] : [oanda, alphaVantage];

  for (const provider of ordered) if (provider) chain.push(provider);

  // Imported data is always last: it is real, but it is history, not a feed.
  if (options.localSeries) chain.push(new LocalSeriesProvider(options.localSeries));

  if (chain.length === 0) return new NullMarketDataProvider();
  if (chain.length === 1) return chain[0]!;
  return new FallbackMarketDataProvider(chain);
}

export function buildEconomicProvider(options: RegistryOptions): EconomicDataProvider {
  const { env } = options;
  const providers: EconomicDataProvider[] = [];

  if (options.manualEvents) providers.push(new ManualEconomicProvider(options.manualEvents));
  if (env.TRADING_ECONOMICS_API_KEY) {
    providers.push(new TradingEconomicsProvider({ apiKey: env.TRADING_ECONOMICS_API_KEY }));
  }
  if (env.FRED_API_KEY) providers.push(new FredProvider({ apiKey: env.FRED_API_KEY }));

  if (providers.length === 0) return new NullEconomicProvider();
  if (providers.length === 1) return providers[0]!;
  return new MergedEconomicProvider(providers);
}

export function buildNewsProvider(_options: RegistryOptions): NewsProvider {
  // No headline vendor ships in v1; the interface exists so one can be added
  // without touching the application.
  return new NullNewsProvider();
}

export function buildBrokerProvider(options: RegistryOptions): BrokerProvider {
  return new ManualBrokerProvider(
    options.account ?? null,
    options.instrumentSpecs ?? { XAUUSD: XAUUSD_DEFAULT_SPEC },
  );
}

export function buildProviders(options: RegistryOptions): ProviderBundle {
  return {
    marketData: buildMarketDataProvider(options),
    economic: buildEconomicProvider(options),
    news: buildNewsProvider(options),
    broker: buildBrokerProvider(options),
  };
}

/** Provider status for the Settings page, with no secrets included. */
export function describeProviders(env: ProviderEnv): ProviderInfo[] {
  return [
    {
      id: 'oanda',
      name: 'OANDA v20 (market data)',
      configured: Boolean(env.OANDA_API_KEY && env.OANDA_ACCOUNT_ID),
      website: 'https://developer.oanda.com/rest-live-v20/introduction/',
      setupHint: 'OANDA_API_KEY + OANDA_ACCOUNT_ID',
    },
    {
      id: 'alpha-vantage',
      name: 'Alpha Vantage (market data)',
      configured: Boolean(env.ALPHA_VANTAGE_API_KEY ?? env.MARKET_DATA_API_KEY),
      website: 'https://www.alphavantage.co/documentation/',
      setupHint: 'ALPHA_VANTAGE_API_KEY',
    },
    {
      id: 'trading-economics',
      name: 'Trading Economics (calendar, point-in-time history)',
      configured: Boolean(env.TRADING_ECONOMICS_API_KEY),
      website: 'https://docs.tradingeconomics.com/',
      setupHint: 'TRADING_ECONOMICS_API_KEY as client:key',
    },
    {
      id: 'fred',
      name: 'FRED (official US macro series)',
      configured: Boolean(env.FRED_API_KEY),
      website: 'https://fred.stlouisfed.org/docs/api/fred/',
      setupHint: 'FRED_API_KEY',
    },
    {
      id: 'local',
      name: 'Imported CSV / stored history',
      configured: true,
      setupHint: 'Always available. Import under Settings → Data.',
    },
  ];
}

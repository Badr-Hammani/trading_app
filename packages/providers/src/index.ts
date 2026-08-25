/**
 * @xau/providers — replaceable data sources.
 *
 * The application depends on the interfaces in `types.ts`, never on a vendor.
 * Providers that cannot answer return an explicit `unavailable` result so the
 * UI can show DATA UNAVAILABLE with a real reason instead of a blank or,
 * worse, a stale number presented as current.
 */

export * from './types.js';
export * from './http.js';
export * from './cache.js';

export * from './market/nullMarket.js';
export * from './market/oanda.js';
export * from './market/alphaVantage.js';
export * from './market/twelveData.js';
export * from './market/realtimeGold.js';
export * from './market/localSeries.js';

export * from './economic/tradingEconomics.js';
export * from './economic/fred.js';
export * from './economic/nullEconomic.js';

export * from './news/nullNews.js';
export * from './broker/nullBroker.js';

export * from './registry.js';

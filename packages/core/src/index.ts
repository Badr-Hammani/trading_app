/**
 * @xau/core — the strategy engine and its supporting domain logic.
 *
 * Everything here is pure: no network, no database, no UI. The application
 * renders what these functions return; it never re-implements trading logic.
 */

export * from './types/market.js';
export * from './types/result.js';

export * from './time/clock.js';

export * from './sessions/types.js';
export * from './sessions/engine.js';

export * from './indicators/atr.js';
export * from './indicators/swings.js';
export * from './indicators/structure.js';
export * from './indicators/fvg.js';
export * from './indicators/displacement.js';
export * from './indicators/liquidity.js';

export * from './strategy-engine/types.js';
export * from './strategy-engine/engine.js';
export * from './strategy-engine/signals.js';
export * from './strategy-engine/checklist.js';
export * from './strategy-engine/entryModels.js';
export * from './strategy-engine/news.js';

export * from './risk-engine/calculator.js';

export * from './journal/management.js';
export * from './journal/grading.js';
export * from './journal/review.js';

export * from './backtest-engine/replay.js';
export * from './backtest-engine/simulator.js';
export * from './backtest-engine/experiments.js';

export * from './analytics/types.js';
export * from './analytics/statistics.js';

export * from './io/csv.js';

export * from './ai/guardrails.js';

/** Safety copy the UI is required to surface (spec §36). */
export const SAFETY_NOTICES = {
  purpose:
    'This is an analysis, planning and journaling tool. It does not place orders and it is not financial advice.',
  prediction: 'Nothing here predicts the market. Every projection is a scenario, not a forecast.',
  backtest:
    'Backtested and replayed results are measurements of a past sample under simplified assumptions. They are not a guarantee of future performance.',
  ai: 'AI analysis can be wrong. Treat it as a second opinion that must be checked against the chart.',
  data: 'Market data may be delayed or incomplete depending on the configured provider. Values shown as DATA UNAVAILABLE are genuinely missing, never estimated.',
  execution:
    'No autonomous order execution. Broker execution is deliberately out of scope for version 1.',
} as const;

import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import type { Candle } from '../types/market.js';
import { XAUUSD_DEFAULT_SPEC } from '../types/market.js';
import { DEFAULT_SESSIONS } from '../sessions/types.js';
import { DEFAULT_STRATEGY_RULES } from '../strategy-engine/types.js';
import { activeSessions } from '../sessions/engine.js';
import { backtestTradesToAnalytics, runBacktest, type BacktestConfig } from './simulator.js';
import { computeStatistics } from '../analytics/statistics.js';
import { runExperimentMatrix } from './experiments.js';

/**
 * A deterministic synthetic series that repeats the model's own pattern:
 * drift down -> sweep the low -> displacement up -> pull back into the gap ->
 * continue. Enough structure for the simulator to find trades, with no
 * randomness so the test is stable.
 */
function syntheticSeries(cycles: number): Candle[] {
  const start = Math.floor(DateTime.fromISO('2026-01-05T08:00:00Z', { zone: 'utc' }).toSeconds());
  const candles: Candle[] = [];
  let price = 2000;
  let time = start;

  const push = (open: number, high: number, low: number, close: number): void => {
    candles.push({ time, open, high, low, close, volume: 100 });
    time += 300;
  };

  // Warmup of ordinary bars so the indicators have a baseline.
  for (let i = 0; i < 70; i += 1) {
    const next = price + (i % 2 === 0 ? 0.4 : -0.4);
    push(price, Math.max(price, next) + 0.3, Math.min(price, next) - 0.3, next);
    price = next;
  }

  for (let cycle = 0; cycle < cycles; cycle += 1) {
    // Drift down, building a swing low.
    for (let i = 0; i < 8; i += 1) {
      const next = price - 0.9;
      push(price, price + 0.3, next - 0.3, next);
      price = next;
    }
    const swingLow = price - 0.3;

    // Small bounce, so the low becomes a confirmed pivot.
    for (let i = 0; i < 4; i += 1) {
      const next = price + 0.8;
      push(price, next + 0.3, price - 0.2, next);
      price = next;
    }
    // Return to the low, then sweep it and close back above.
    for (let i = 0; i < 3; i += 1) {
      const next = price - 1.1;
      push(price, price + 0.2, next - 0.2, next);
      price = next;
    }
    push(price, price + 0.4, swingLow - 2.5, price + 0.6);
    price += 0.6;

    // Displacement up: a large body that leaves a gap behind it.
    const displacementOpen = price;
    price += 12;
    push(displacementOpen, price + 0.4, displacementOpen - 0.4, price);
    const gapFloor = displacementOpen + 0.4;
    price += 6;
    push(price - 6, price + 0.5, gapFloor + 3, price);

    // Pull back into the gap, then react out of it.
    price = gapFloor + 1.5;
    push(price + 4, price + 4.2, price - 0.5, price);
    push(price, price + 5, price - 0.4, price + 4.6);
    price += 4.6;

    // Continuation.
    for (let i = 0; i < 14; i += 1) {
      const next = price + 1.4;
      push(price, next + 0.4, price - 0.4, next);
      price = next;
    }
    // Give some of it back so the next cycle starts from a normal state.
    for (let i = 0; i < 6; i += 1) {
      const next = price - 1.0;
      push(price, price + 0.3, next - 0.3, next);
      price = next;
    }
  }

  return candles;
}

const baseConfig = (candles: Candle[]): BacktestConfig => ({
  candles,
  timeframe: '5M',
  instrument: XAUUSD_DEFAULT_SPEC,
  sessions: DEFAULT_SESSIONS,
  rules: DEFAULT_STRATEGY_RULES,
  entryModel: 'C',
  managementModelId: 'A',
  accountBalance: 10000,
  riskPercent: 0.5,
  targetsR: [1, 2, 3],
  stopBufferAtr: 0.05,
  timezone: 'Africa/Casablanca',
  enforceSessionFilter: false,
  warmupBars: 60,
});

describe('backtest simulator', () => {
  const candles = syntheticSeries(12);

  it('produces trades from a series that contains the model pattern', () => {
    const result = runBacktest(baseConfig(candles));
    expect(result.trades.length).toBeGreaterThan(0);
  });

  it('never exits before it enters', () => {
    const result = runBacktest(baseConfig(candles));
    for (const trade of result.trades) {
      expect(trade.exitTime).not.toBeNull();
      expect(trade.exitTime!).toBeGreaterThanOrEqual(trade.entryTime);
      for (const fill of trade.fills) {
        expect(fill.time).toBeGreaterThanOrEqual(trade.entryTime);
      }
    }
  });

  it('places the stop at a genuine invalidation, never through the entry', () => {
    const result = runBacktest(baseConfig(candles));
    for (const trade of result.trades) {
      if (trade.direction === 'long') expect(trade.initialStop).toBeLessThan(trade.entryPrice);
      else expect(trade.initialStop).toBeGreaterThan(trade.entryPrice);
    }
  });

  it('caps a full stop-out at roughly -1R', () => {
    const result = runBacktest(baseConfig(candles));
    for (const trade of result.trades) {
      // Partial exits can only improve on -1R; nothing should be worse.
      expect(trade.resultR).toBeGreaterThanOrEqual(-1.05);
    }
  });

  it('only takes trades inside a permitted session when the filter is on', () => {
    const result = runBacktest({ ...baseConfig(candles), enforceSessionFilter: true });
    for (const trade of result.trades) {
      const permitted = activeSessions(DEFAULT_SESSIONS, trade.entryTime).some(
        (occurrence) => occurrence.definition.tradingPermitted,
      );
      expect(permitted).toBe(true);
    }
    expect(result.skipped.length).toBeGreaterThan(0);
  });

  it('takes fewer or equal trades as the entry model demands more evidence', () => {
    const counts = (['A', 'B', 'C', 'D'] as const).map(
      (entryModel) => runBacktest({ ...baseConfig(candles), entryModel }).trades.length,
    );
    expect(counts[0]!).toBeGreaterThanOrEqual(counts[3]!);
  });

  it('produces different results for different management models', () => {
    const a = runBacktest({ ...baseConfig(candles), managementModelId: 'A' });
    const d = runBacktest({ ...baseConfig(candles), managementModelId: 'D' });
    const statsA = computeStatistics(backtestTradesToAnalytics(a.trades));
    const statsD = computeStatistics(backtestTradesToAnalytics(d.trades));
    expect(statsA.totalR).not.toBe(statsD.totalR);
  });

  it('runs the full experiment matrix and flags small samples', () => {
    const { candles: _ignored, entryModel, managementModelId, ...base } = baseConfig(candles);
    const matrix = runExperimentMatrix({ candles, base, minimumTradesForRanking: 1000 });

    expect(matrix.cells.length).toBe(16);
    expect(matrix.caveat).toMatch(/not a guarantee|should not be treated as an edge/);
  });
});

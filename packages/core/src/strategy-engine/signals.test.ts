import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { detectSignals } from './signals.js';
import { DEFAULT_SESSIONS } from '../sessions/types.js';
import { DEFAULT_STRATEGY_RULES } from './types.js';
import { makeCandles } from '../__testdata__/candles.js';
import { sideForType, type LiquidityLevel } from '../indicators/liquidity.js';
import type { FvgZone } from '../indicators/fvg.js';
import type { StructureEvent } from '../indicators/structure.js';
import type { DisplacementReading } from '../indicators/displacement.js';

// 10:00 UTC on a Thursday — inside London.
const AT = Math.floor(DateTime.fromISO('2026-01-15T10:00:00Z', { zone: 'utc' }).toSeconds());

function level(price: number): LiquidityLevel {
  return {
    id: 'pdl', type: 'PDL', side: sideForType('PDL'), price, timeframe: '5M',
    createdTime: AT - 7200, status: 'swept', eventTime: AT - 3600, eventIndex: 5,
    penetration: 1.2, manual: false, notes: '', label: 'PDL',
  };
}

function zone(low: number, high: number): FvgZone {
  return {
    id: 'z1', direction: 'bullish', timeframe: '5M', createdIndex: 1, createdTime: AT - 1200,
    sourceCandleTimes: [AT - 1800, AT - 1500, AT - 1200], high, low, midpoint: (high + low) / 2,
    size: high - low, relativeSize: 1.4, status: 'fresh', mitigation: 0,
    firstTouchIndex: null, firstTouchTime: null,
    history: [{ index: 1, time: AT - 1200, status: 'fresh', mitigation: 0 }], overlaps: [],
  };
}

const breakEvent: StructureEvent = {
  kind: 'CHoCH', direction: 'bullish', scope: 'major', index: 1, time: AT - 1500,
  brokenLevel: 2005, brokenSwingTime: AT - 1800, closePrice: 2008, timeframe: '5M', review: 'detected',
};

const displacement: DisplacementReading = {
  index: 1, time: AT - 1800, timeframe: '5M', direction: 'bullish', score: 78, qualifies: true,
  reasons: ['Range expansion'],
  metrics: { bodyMultiple: 3, rangeMultiple: 2.4, closeLocation: 0.95, consecutive: 2, brokeStructure: true, createdFvg: true },
};

function signalsFor() {
  return detectSignals({
    at: AT,
    price: 2002.5,
    bias: { '4H': 'bullish', '1H': 'bullish', '30M': 'bullish' },
    candles: makeCandles([
      [2004, 2006, 2003, 2005],
      [2005, 2006, 2002, 2004],
      [2003, 2005.5, 2001.2, 2005],
    ]),
    executionTimeframe: '5M',
    liquidity: [level(2002.5)],
    fvgZones: [zone(2001, 2003)],
    structureEvents: [breakEvent],
    displacement: [displacement],
    sessions: DEFAULT_SESSIONS,
    rules: DEFAULT_STRATEGY_RULES,
  });
}

describe('trading signals', () => {
  it('emits a signal for a forming setup', () => {
    expect(signalsFor().length).toBeGreaterThan(0);
  });

  /**
   * The card renders TP1 next to `riskRewardRatio`. It used to be derived from
   * TP2, so a 2R target was advertised as 3:1 — a 50% overstatement of reward
   * on the only target shown.
   */
  it('reports a reward-to-risk that matches the target it labels', () => {
    for (const signal of signalsFor()) {
      const risk = Math.abs(signal.entryPrice - signal.stopLoss);
      expect(risk).toBeGreaterThan(0);

      const actualTp1 = Math.abs(signal.takeProfit1 - signal.entryPrice) / risk;
      expect(signal.riskRewardTp1).toBeCloseTo(actualTp1, 1);
      // The headline ratio is TP1's, because TP1 is what gets displayed.
      expect(signal.riskRewardRatio).toBeCloseTo(signal.riskRewardTp1, 5);
    }
  });

  it('reports a distinct, correct ratio for every target', () => {
    for (const signal of signalsFor()) {
      const risk = Math.abs(signal.entryPrice - signal.stopLoss);
      expect(signal.riskRewardTp2).toBeCloseTo(Math.abs(signal.takeProfit2 - signal.entryPrice) / risk, 1);
      expect(signal.riskRewardTp3).toBeCloseTo(Math.abs(signal.takeProfit3 - signal.entryPrice) / risk, 1);
      // Targets must climb, or they are not targets. TP3 used to be taken from
      // the nearest opposite liquidity pool without checking it was beyond
      // TP2, which produced a "third" target closer than the second.
      expect(signal.riskRewardTp2).toBeGreaterThan(signal.riskRewardTp1);
      expect(signal.riskRewardTp3).toBeGreaterThan(signal.riskRewardTp2);
    }
  });

  it('ignores a liquidity pool nearer than TP2 when choosing TP3', () => {
    // A buy-side pool close above entry must not become TP3; TP3 has to stay
    // beyond TP2 or the targets are out of order.
    const near = { ...level(2002.5), type: 'EQUAL_HIGHS' as const, side: 'buy-side' as const, price: 2003.2, status: 'intact' as const };
    const signals = detectSignals({
      at: AT, price: 2002.5,
      bias: { '4H': 'bullish', '1H': 'bullish', '30M': 'bullish' },
      candles: makeCandles([[2004, 2006, 2003, 2005], [2005, 2006, 2002, 2004], [2003, 2005.5, 2001.2, 2005]]),
      executionTimeframe: '5M',
      liquidity: [level(2002.5), near],
      fvgZones: [zone(2001, 2003)],
      structureEvents: [breakEvent],
      displacement: [displacement],
      sessions: DEFAULT_SESSIONS,
      rules: DEFAULT_STRATEGY_RULES,
    });

    for (const signal of signals.filter((s) => s.direction === 'long')) {
      expect(signal.takeProfit3).toBeGreaterThan(signal.takeProfit2);
      expect(signal.takeProfit3).not.toBeCloseTo(2003.2, 2);
    }
  });

  it('places the stop on the losing side of the entry', () => {
    for (const signal of signalsFor()) {
      if (signal.direction === 'long') expect(signal.stopLoss).toBeLessThan(signal.entryPrice);
      else expect(signal.stopLoss).toBeGreaterThan(signal.entryPrice);
    }
  });

  it('places every target on the winning side of the entry', () => {
    for (const signal of signalsFor()) {
      for (const target of [signal.takeProfit1, signal.takeProfit2, signal.takeProfit3]) {
        if (signal.direction === 'long') expect(target).toBeGreaterThan(signal.entryPrice);
        else expect(target).toBeLessThan(signal.entryPrice);
      }
    }
  });
});

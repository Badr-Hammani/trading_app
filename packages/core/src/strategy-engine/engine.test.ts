import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { makeCandles } from '../__testdata__/candles.js';
import { DEFAULT_SESSIONS } from '../sessions/types.js';
import { evaluateSetup, type EvaluateSetupInput } from './engine.js';
import { DEFAULT_STRATEGY_RULES } from './types.js';
import { buildNewsRisk } from './news.js';
import { sideForType, type LiquidityLevel } from '../indicators/liquidity.js';
import type { FvgZone } from '../indicators/fvg.js';
import type { StructureEvent } from '../indicators/structure.js';
import type { DisplacementReading } from '../indicators/displacement.js';

// 10:00 UTC on a Thursday: inside the London session.
const IN_LONDON = Math.floor(DateTime.fromISO('2026-01-15T10:00:00Z', { zone: 'utc' }).toSeconds());
// 02:00 UTC: Asian hours, which the plan does not permit for execution.
const IN_ASIA = Math.floor(DateTime.fromISO('2026-01-15T02:00:00Z', { zone: 'utc' }).toSeconds());

function sweptLow(price: number, at: number): LiquidityLevel {
  return {
    id: 'pdl',
    type: 'PDL',
    side: sideForType('PDL'),
    price,
    timeframe: '5M',
    createdTime: at - 7200,
    status: 'swept',
    eventTime: at - 3600,
    eventIndex: 5,
    penetration: 1.2,
    manual: false,
    notes: '',
    label: 'PDL',
  };
}

function bullishZone(low: number, high: number, createdIndex: number, createdTime: number): FvgZone {
  return {
    id: 'zone-1',
    direction: 'bullish',
    timeframe: '5M',
    createdIndex,
    createdTime,
    sourceCandleTimes: [createdTime - 600, createdTime - 300, createdTime],
    high,
    low,
    midpoint: (high + low) / 2,
    size: high - low,
    relativeSize: 1.4,
    status: 'fresh',
    mitigation: 0,
    firstTouchIndex: null,
    firstTouchTime: null,
    history: [{ index: createdIndex, time: createdTime, status: 'fresh', mitigation: 0 }],
    overlaps: [],
  };
}

function bullishBreak(index: number, time: number): StructureEvent {
  return {
    kind: 'CHoCH',
    direction: 'bullish',
    scope: 'major',
    index,
    time,
    brokenLevel: 2005,
    brokenSwingTime: time - 1800,
    closePrice: 2008,
    timeframe: '5M',
    review: 'detected',
  };
}

function bullishDisplacement(index: number, time: number, score: number): DisplacementReading {
  return {
    index,
    time,
    timeframe: '5M',
    direction: 'bullish',
    score,
    qualifies: score >= 60,
    reasons: ['Range expansion 2.4x', 'Strong close'],
    metrics: {
      bodyMultiple: 3,
      rangeMultiple: 2.4,
      closeLocation: 0.95,
      consecutive: 2,
      brokeStructure: true,
      createdFvg: true,
    },
  };
}

/** A complete long scenario: sweep -> displacement -> CHoCH -> fresh FVG -> retrace -> reaction. */
function qualifyingLong(at: number): EvaluateSetupInput {
  // The last bar rejects from inside the 2001-2003 zone and closes up.
  const candles = makeCandles([
    [2004, 2006, 2003, 2005],
    [2005, 2006, 2002, 2004],
    [2003, 2005.5, 2001.2, 2005],
  ]);

  return {
    at,
    direction: 'long',
    price: 2002.5,
    bias: { '4H': 'bullish', '1H': 'bullish', '30M': 'bullish' },
    candles,
    executionTimeframe: '5M',
    liquidity: [sweptLow(2002.5, at)],
    fvgZones: [bullishZone(2001, 2003, 1, at - 1200)],
    structureEvents: [bullishBreak(1, at - 1500)],
    displacement: [bullishDisplacement(1, at - 1800, 78)],
    sessions: DEFAULT_SESSIONS,
    rules: DEFAULT_STRATEGY_RULES,
  };
}

describe('strategy engine', () => {
  it('qualifies a complete setup inside a permitted session', () => {
    const result = evaluateSetup(qualifyingLong(IN_LONDON));

    expect(result.liquiditySweep.detected).toBe(true);
    expect(result.displacement.detected).toBe(true);
    expect(result.structureBreak.detected).toBe(true);
    expect(result.fvg.detected).toBe(true);
    expect(result.retracement.detected).toBe(true);
    expect(result.sessionValid).toBe(true);
    expect(result.setupStatus).toBe('qualified');
    expect(result.summary).toMatch(/SETUP QUALIFIED/);
  });

  it('never treats an FVG touch on its own as a setup', () => {
    const input = qualifyingLong(IN_LONDON);
    // Same price inside the same zone, but no sweep, no displacement, no break.
    const result = evaluateSetup({
      ...input,
      liquidity: [],
      structureEvents: [],
      displacement: [],
    });

    expect(result.setupStatus).not.toBe('qualified');
    expect(result.missingConditions.join(' ')).toMatch(/liquidity/i);
    expect(result.missingConditions.join(' ')).toMatch(/displacement/i);
  });

  it('separates a technically valid setup from a permitted session', () => {
    const result = evaluateSetup(qualifyingLong(IN_ASIA));

    // The technical work is still recognised...
    expect(result.liquiditySweep.detected).toBe(true);
    expect(result.fvg.detected).toBe(true);
    // ...but execution is not.
    expect(result.sessionValid).toBe(false);
    expect(result.setupStatus).toBe('valid_out_of_session');
    expect(result.summary).toMatch(/NO EXECUTION WINDOW/);
  });

  it('reports caution rather than blocking when news is near and the filter is off', () => {
    const input = qualifyingLong(IN_LONDON);
    const news = buildNewsRisk(
      [{ id: 'cpi', name: 'Core CPI', country: 'US', time: IN_LONDON + 20 * 60, importance: 'high' }],
      IN_LONDON,
      { windowMinutes: 30, filterEnabled: false },
    );

    const result = evaluateSetup({ ...input, news });
    expect(result.newsRisk.eventNearby).toBe(true);
    expect(result.newsRisk.filterBlocks).toBe(false);
    expect(result.setupStatus).toBe('caution');
  });

  it('blocks only when the user has switched the news filter on', () => {
    const input = qualifyingLong(IN_LONDON);
    const news = buildNewsRisk(
      [{ id: 'cpi', name: 'Core CPI', country: 'US', time: IN_LONDON + 20 * 60, importance: 'high' }],
      IN_LONDON,
      { windowMinutes: 30, filterEnabled: true },
    );

    const result = evaluateSetup({ ...input, news });
    expect(result.setupStatus).toBe('blocked');
  });

  it('honours a manual block', () => {
    const result = evaluateSetup({
      ...qualifyingLong(IN_LONDON),
      manualBlock: { active: true, reason: 'Tired, not trading today' },
    });
    expect(result.setupStatus).toBe('blocked');
    expect(result.missingConditions.join(' ')).toMatch(/Tired/);
  });

  it('does not overwrite the user bias', () => {
    const input = qualifyingLong(IN_LONDON);
    const result = evaluateSetup({ ...input, bias: { '4H': 'bearish', '1H': 'bearish', '30M': 'neutral' } });
    expect(result.bias['4H']).toBe('bearish');
    expect(result.htfAligned).toBe(false);
    expect(result.setupStatus).not.toBe('qualified');
  });

  it('rejects a displacement below the configured score', () => {
    const input = qualifyingLong(IN_LONDON);
    const result = evaluateSetup({
      ...input,
      displacement: [bullishDisplacement(1, IN_LONDON - 1800, 35)],
    });
    expect(result.displacement.detected).toBe(false);
    expect(result.setupStatus).toBe('forming');
  });

  it('ignores a level that was broken rather than swept', () => {
    const input = qualifyingLong(IN_LONDON);
    const broken = { ...sweptLow(2002.5, IN_LONDON), status: 'broken' as const };
    const result = evaluateSetup({ ...input, liquidity: [broken] });
    expect(result.liquiditySweep.detected).toBe(false);
  });
});

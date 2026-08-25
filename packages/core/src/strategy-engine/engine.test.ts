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

// 10:00 UTC on a Thursday: inside the permitted London session (08:00-16:30 UTC).
const IN_LONDON = Math.floor(DateTime.fromISO('2026-01-15T10:00:00Z', { zone: 'utc' }).toSeconds());
// 04:00 UTC: Asian hours (00:00-09:00 UTC), which the plan does not permit for execution.
const IN_ASIA = Math.floor(DateTime.fromISO('2026-01-15T04:00:00Z', { zone: 'utc' }).toSeconds());

function sweptLow(price: number, at: number, eventTime?: number, eventIndex = 0): LiquidityLevel {
  const time = eventTime ?? at - 3600;
  return {
    id: 'pdl',
    type: 'PDL',
    side: sideForType('PDL'),
    price,
    timeframe: '5M',
    createdTime: time - 3600,
    status: 'swept',
    eventTime: time,
    eventIndex,
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
    liquidity: [sweptLow(2002.5, at, at - 2000, 0)],
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

  it('TEST CASE 1: rejects stale distant FVG scenario (4626 price vs 4665 FVG, 35 bars old) as no_setup', () => {
    // Generate 40 candles ending at 4626
    const baseCandles: [number, number, number, number][] = [];
    for (let i = 0; i < 40; i++) {
      baseCandles.push([4650 - i * 0.6, 4652 - i * 0.6, 4648 - i * 0.6, 4650 - i * 0.6]);
    }
    // Set last candle to close around 4626
    baseCandles[39] = [4628, 4630, 4625, 4626];
    const candles = makeCandles(baseCandles);

    const input: EvaluateSetupInput = {
      at: IN_LONDON,
      direction: 'long',
      price: 4626.0,
      bias: { '4H': 'bullish', '1H': 'bullish', '30M': 'bullish' },
      candles,
      executionTimeframe: '5M',
      liquidity: [sweptLow(4630.0, IN_LONDON, IN_LONDON - 38 * 300, 1)],
      displacement: [bullishDisplacement(2, IN_LONDON - 36 * 300, 85)],
      structureEvents: [bullishBreak(3, IN_LONDON - 35 * 300)],
      fvgZones: [bullishZone(4664.91, 4666.4, 3, IN_LONDON - 35 * 300)],
      sessions: DEFAULT_SESSIONS,
      rules: DEFAULT_STRATEGY_RULES,
    };

    const result = evaluateSetup(input);
    // Must NOT be forming or qualified; must be no_setup because structure is expired and FVG is > 3 ATR away
    expect(result.setupStatus).toBe('no_setup');
    expect(result.fvg.detected).toBe(false);
    expect(result.summary).toMatch(/NO SETUP/);
  });

  it('TEST CASE 2: accepts valid nearby fresh FVG within ATR distance and age limit', () => {
    const input = qualifyingLong(IN_LONDON);
    const result = evaluateSetup(input);

    expect(result.setupStatus).toBe('qualified');
    expect(result.fvg.detected).toBe(true);
  });

  it('TEST CASE 3: invalidates setup when structure break age exceeds maxBarsFromStructureBreak', () => {
    const baseCandles: [number, number, number, number][] = [];
    for (let i = 0; i < 30; i++) {
      baseCandles.push([2003, 2005, 2002, 2004]);
    }
    const candles = makeCandles(baseCandles);

    const input: EvaluateSetupInput = {
      at: IN_LONDON,
      direction: 'long',
      price: 2002.5,
      bias: { '4H': 'bullish', '1H': 'bullish', '30M': 'bullish' },
      candles,
      executionTimeframe: '5M',
      liquidity: [sweptLow(2002.5, IN_LONDON, IN_LONDON - 30 * 300, 0)],
      displacement: [bullishDisplacement(1, IN_LONDON - 29 * 300, 80)],
      structureEvents: [bullishBreak(1, IN_LONDON - 28 * 300)], // 29 bars ago > 24
      fvgZones: [bullishZone(2001, 2003, 1, IN_LONDON - 28 * 300)],
      sessions: DEFAULT_SESSIONS,
      rules: { ...DEFAULT_STRATEGY_RULES, maxBarsFromStructureBreak: 24 },
    };

    const result = evaluateSetup(input);
    expect(result.setupStatus).toBe('no_setup');
    expect(result.structureBreak.detected).toBe(false);
    expect(result.missingConditions.join(' ')).toMatch(/expired/i);
  });

  it('TEST CASE 4: invalidates bullish setup when opposing bearish structure break occurs after setup break', () => {
    const input = qualifyingLong(IN_LONDON);
    const opposingBearishBreak: StructureEvent = {
      kind: 'CHoCH',
      direction: 'bearish',
      scope: 'major',
      index: 2,
      time: IN_LONDON - 600, // After bullishBreak at IN_LONDON - 1500
      brokenLevel: 2001,
      brokenSwingTime: IN_LONDON - 1200,
      closePrice: 2000,
      timeframe: '5M',
      review: 'detected',
    };

    const result = evaluateSetup({
      ...input,
      structureEvents: [...input.structureEvents, opposingBearishBreak],
    });

    expect(result.setupStatus).toBe('no_setup');
    expect(result.structureBreak.detected).toBe(false);
    expect(result.missingConditions.join(' ')).toMatch(/opposing/i);
  });

  it('TEST CASE 5: invalidates bullish setup when price breaks below originating protected swing low', () => {
    // 4 candles: candle 1 is break at 2005, candle 3 drops and closes below protected low (1999 < 2001.2)
    const candles = makeCandles([
      [2004, 2006, 2003, 2005],
      [2005, 2006, 2002, 2005.5], // break index 1
      [2003, 2004, 2000, 2001],
      [2001, 2002, 1998, 1999], // breaches below protected low (2001.2)
    ]);

    const input: EvaluateSetupInput = {
      at: IN_LONDON,
      direction: 'long',
      price: 1999.0,
      bias: { '4H': 'bullish', '1H': 'bullish', '30M': 'bullish' },
      candles,
      executionTimeframe: '5M',
      liquidity: [sweptLow(2002.5, IN_LONDON)],
      fvgZones: [bullishZone(2001, 2003, 1, IN_LONDON - 600)],
      structureEvents: [bullishBreak(1, IN_LONDON - 600)],
      displacement: [bullishDisplacement(1, IN_LONDON - 900, 78)],
      sessions: DEFAULT_SESSIONS,
      rules: DEFAULT_STRATEGY_RULES,
    };

    const result = evaluateSetup(input);
    expect(result.setupStatus).toBe('no_setup');
    expect(result.missingConditions.join(' ')).toMatch(/protected low/i);
  });

  it('TEST CASE 6: prefers displacement-associated FVG over unrelated later FVG', () => {
    const input = qualifyingLong(IN_LONDON);
    const associatedFvg = bullishZone(2001, 2003, 1, IN_LONDON - 1200); // created on displacement (index 1)
    associatedFvg.id = 'associated-zone';

    const unrelatedLaterFvg = bullishZone(2001.5, 2002.5, 2, IN_LONDON - 300); // created later (index 2)
    unrelatedLaterFvg.id = 'unrelated-later-zone';

    const result = evaluateSetup({
      ...input,
      fvgZones: [unrelatedLaterFvg, associatedFvg],
    });

    expect(result.fvg.detected).toBe(true);
    expect(result.fvg.id).toBe('associated-zone');
  });
});

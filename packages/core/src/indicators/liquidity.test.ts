import { describe, expect, it } from 'vitest';
import { makeCandles } from '../__testdata__/candles.js';
import {
  evaluateLiquidity,
  nearestLiquidity,
  sideForType,
  type LiquidityLevel,
} from './liquidity.js';

const config = { minPenetrationAtr: 0, minPenetrationAbsolute: 0.5, reclaimBars: 3, atrPeriod: 14 };

function level(price: number, type: LiquidityLevel['type'], createdTime = 0): LiquidityLevel {
  return {
    id: `${type}-${price}`,
    type,
    side: sideForType(type),
    price,
    timeframe: '5M',
    createdTime,
    status: 'intact',
    eventTime: null,
    eventIndex: null,
    penetration: null,
    manual: false,
    notes: '',
    label: `${type} ${price}`,
  };
}

describe('liquidity sweeps', () => {
  it('marks a level swept when price pierces it and closes back through', () => {
    const candles = makeCandles([
      [99, 99.5, 98.5, 99],
      [99, 101.2, 98.8, 99.4], // pierces 100 by 1.2, closes back below
      [99.4, 99.8, 99, 99.5],
    ]);

    const [result] = evaluateLiquidity([level(100, 'PDH')], candles, config);
    expect(result!.status).toBe('swept');
    expect(result!.penetration).toBeCloseTo(1.2, 5);
  });

  it('marks a level broken when price closes beyond and stays there', () => {
    const candles = makeCandles([
      [99, 99.5, 98.5, 99],
      [99, 101.2, 98.8, 101], // closes above and holds
      [101, 102, 100.5, 101.8],
      [101.8, 102.5, 101, 102],
      [102, 103, 101.5, 102.5],
    ]);

    const [result] = evaluateLiquidity([level(100, 'PDH')], candles, config);
    expect(result!.status).toBe('broken');
  });

  it('does not treat a shallow wick as a sweep', () => {
    const candles = makeCandles([
      [99, 99.5, 98.5, 99],
      [99, 100.1, 98.8, 99.4], // only 0.1 beyond the level
      [99.4, 99.8, 99, 99.5],
    ]);

    const [result] = evaluateLiquidity([level(100, 'PDH')], candles, config);
    expect(result!.status).toBe('intact');
  });

  it('handles sell-side levels symmetrically', () => {
    const candles = makeCandles([
      [101, 101.5, 100.5, 101],
      [101, 101.2, 98.5, 100.4], // pierces 100 to the downside, closes back above
      [100.4, 101, 100.2, 100.8],
    ]);

    const [result] = evaluateLiquidity([level(100, 'PDL')], candles, config);
    expect(result!.status).toBe('swept');
    expect(result!.side).toBe('sell-side');
  });

  it('ignores candles that predate the level', () => {
    const candles = makeCandles([
      [99, 101.5, 98.5, 99], // would sweep, but happens before the level exists
      [99, 99.5, 98.8, 99.2],
    ]);
    const created = candles[1]!.time;

    const [result] = evaluateLiquidity([level(100, 'PDH', created)], candles, config);
    expect(result!.status).toBe('intact');
  });

  it('finds the nearest intact level on a given side', () => {
    const levels = [level(105, 'PDH'), level(102, 'SWING_HIGH'), level(95, 'PDL')];
    const nearest = nearestLiquidity(levels, 100, 'buy-side');
    expect(nearest!.price).toBe(102);
  });
});

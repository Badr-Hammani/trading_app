import { describe, expect, it } from 'vitest';
import { makeCandles } from '../__testdata__/candles.js';
import { scoreDisplacement } from './displacement.js';

/** Ordinary bars: a small body inside a modest range. */
function baseline(count: number): [number, number, number, number][] {
  return Array.from({ length: count }, () => [100, 100.3, 99.7, 100.1] as [number, number, number, number]);
}

describe('displacement scoring', () => {
  it('returns null before there is enough history', () => {
    const candles = makeCandles(baseline(2));
    expect(scoreDisplacement(candles, 1, '5M')).toBeNull();
  });

  it('scores a large expansion candle closing on its high highly', () => {
    const candles = makeCandles([...baseline(25), [100, 105, 99.9, 104.9]]);
    const reading = scoreDisplacement(candles, 25, '5M');

    expect(reading).not.toBeNull();
    expect(reading!.direction).toBe('bullish');
    expect(reading!.score).toBeGreaterThan(50);
    expect(reading!.metrics.bodyMultiple!).toBeGreaterThan(3);
    expect(reading!.reasons.join(' ')).toMatch(/Range expansion/);
  });

  it('does not score a small green candle as displacement', () => {
    const candles = makeCandles([...baseline(25), [100, 100.3, 99.9, 100.1]]);
    const reading = scoreDisplacement(candles, 25, '5M');

    expect(reading!.direction).toBe('bullish');
    expect(reading!.qualifies).toBe(false);
    expect(reading!.score).toBeLessThan(40);
  });

  it('adds weight for a structure break and a created FVG', () => {
    const candles = makeCandles([...baseline(25), [100, 105, 99.9, 104.9]]);

    const plain = scoreDisplacement(candles, 25, '5M')!;
    const enriched = scoreDisplacement(candles, 25, '5M', {
      structureEvents: [
        {
          kind: 'BOS',
          direction: 'bullish',
          scope: 'major',
          index: 25,
          time: candles[25]!.time,
          brokenLevel: 100.5,
          brokenSwingTime: candles[10]!.time,
          closePrice: 104.9,
          timeframe: '5M',
          review: 'detected',
        },
      ],
      fvgZones: [
        {
          id: 'z1',
          direction: 'bullish',
          timeframe: '5M',
          createdIndex: 26,
          createdTime: candles[25]!.time + 300,
          sourceCandleTimes: [0, 0, 0],
          high: 103,
          low: 101,
          midpoint: 102,
          size: 2,
          relativeSize: 2,
          status: 'fresh',
          mitigation: 0,
          firstTouchIndex: null,
          firstTouchTime: null,
          history: [],
          overlaps: [],
        },
      ],
    })!;

    expect(enriched.score).toBeGreaterThan(plain.score);
    expect(enriched.reasons).toContain('Broke structure on this candle');
    expect(enriched.reasons).toContain('Created a fair value gap');
  });
});

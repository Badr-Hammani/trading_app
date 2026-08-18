import { describe, expect, it } from 'vitest';
import { makeCandles } from '../__testdata__/candles.js';
import { buildFvgZones, freshFvgsAt, fvgStatusAt } from './fvg.js';

describe('FVG detection', () => {
  it('finds a bullish gap between candle 1 high and candle 3 low', () => {
    const candles = makeCandles([
      [100, 101, 99, 100],
      [100, 110, 100, 109],
      [109, 112, 105, 111],
    ]);

    const zones = buildFvgZones(candles, '5M');
    expect(zones).toHaveLength(1);

    const zone = zones[0]!;
    expect(zone.direction).toBe('bullish');
    expect(zone.low).toBe(101);
    expect(zone.high).toBe(105);
    expect(zone.midpoint).toBe(103);
    expect(zone.status).toBe('fresh');
    expect(zone.createdIndex).toBe(2);
  });

  it('finds a bearish gap between candle 1 low and candle 3 high', () => {
    const candles = makeCandles([
      [110, 111, 109, 110],
      [109, 109, 100, 101],
      [101, 105, 98, 99],
    ]);

    const zones = buildFvgZones(candles, '5M');
    expect(zones).toHaveLength(1);
    expect(zones[0]!.direction).toBe('bearish');
    expect(zones[0]!.low).toBe(105);
    expect(zones[0]!.high).toBe(109);
  });

  it('tracks partial then full mitigation of a bullish gap', () => {
    const candles = makeCandles([
      [100, 101, 99, 100],
      [100, 110, 100, 109],
      [109, 112, 105, 111],
      [111, 112, 103, 104], // taps into the 101-105 zone, no close through
      [104, 106, 101, 105], // reaches the far edge: the gap is filled
    ]);

    const zones = buildFvgZones(candles, '5M');
    const zone = zones[0]!;

    expect(fvgStatusAt(zone, 3)!.status).toBe('partially_mitigated');
    expect(fvgStatusAt(zone, 3)!.mitigation).toBeCloseTo(0.5, 5);
    expect(fvgStatusAt(zone, 4)!.status).toBe('fully_mitigated');
    expect(zone.status).toBe('fully_mitigated');
  });

  it('invalidates a bullish gap when a candle closes below it', () => {
    const candles = makeCandles([
      [100, 101, 99, 100],
      [100, 110, 100, 109],
      [109, 112, 105, 111],
      [111, 112, 98, 99], // closes under the 101 floor
    ]);

    const zone = buildFvgZones(candles, '5M')[0]!;
    expect(zone.status).toBe('invalidated');
  });

  it('never revives a violated zone when a new gap forms over the same prices', () => {
    const candles = makeCandles([
      [100, 101, 99, 100],
      [100, 110, 100, 109],
      [109, 112, 105, 111], // zone 1: 101-105
      [111, 112, 98, 99], // violates zone 1
      [99, 100, 98, 99],
      [99, 108, 99, 107], // displacement back up
      [107, 110, 103, 109], // zone 2: 100-103, overlapping the dead zone's area
    ]);

    const zones = buildFvgZones(candles, '5M');
    expect(zones.length).toBeGreaterThanOrEqual(2);

    const first = zones[0]!;
    const second = zones[zones.length - 1]!;

    // The old zone stays dead...
    expect(first.status).toBe('invalidated');
    // ...and the new one is a separate object, not a resurrection.
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe('fresh');
    expect(second.createdIndex).toBeGreaterThan(first.createdIndex);

    const fresh = freshFvgsAt(zones, candles.length - 1, 'bullish');
    expect(fresh.map((zone) => zone.id)).not.toContain(first.id);
    expect(fresh.map((zone) => zone.id)).toContain(second.id);
  });

  it('stacks overlapping zones instead of replacing them', () => {
    const candles = makeCandles([
      [100, 101, 99, 100],
      [100, 110, 100, 109],
      [109, 112, 105, 111], // zone 1: 101-105
      [111, 118, 110, 117],
      [117, 120, 113, 119], // zone 2: 112-113
    ]);

    const zones = buildFvgZones(candles, '5M');
    expect(zones.length).toBe(2);
    // Both survive; nothing is merged away.
    expect(new Set(zones.map((zone) => zone.id)).size).toBe(2);
  });

  it('reports no state for a zone that did not exist yet at that bar', () => {
    const candles = makeCandles([
      [100, 101, 99, 100],
      [100, 110, 100, 109],
      [109, 112, 105, 111],
    ]);
    const zone = buildFvgZones(candles, '5M')[0]!;
    expect(fvgStatusAt(zone, 1)).toBeNull();
    expect(fvgStatusAt(zone, 2)).not.toBeNull();
  });
});

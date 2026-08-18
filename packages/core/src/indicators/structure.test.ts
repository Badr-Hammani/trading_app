import { describe, expect, it } from 'vitest';
import { makeCandles } from '../__testdata__/candles.js';
import { detectSwings, SWING_PRESETS } from './swings.js';
import { detectStructureEvents, labelSwings, suggestBias } from './structure.js';

const sensitive = SWING_PRESETS.sensitive;

describe('swing detection', () => {
  it('finds the obvious pivot high and pivot low', () => {
    const candles = makeCandles([
      [10, 10.5, 9.5, 10],
      [10, 11.5, 10, 11],
      [11, 12.5, 11, 12],
      [12, 13.5, 12, 13], // pivot high
      [13, 12.5, 11.5, 12],
      [12, 11.5, 10.5, 11],
      [11, 10.5, 9.5, 10], // pivot low
      [10, 11.5, 10, 11],
      [11, 12.5, 11, 12],
      [12, 14.5, 12, 14],
    ]);

    const swings = detectSwings(candles, '5M', sensitive);
    const highs = swings.filter((swing) => swing.type === 'high');
    const lows = swings.filter((swing) => swing.type === 'low');

    expect(highs.map((swing) => swing.index)).toContain(3);
    expect(lows.map((swing) => swing.index)).toContain(6);
  });

  it('is less eager at conservative sensitivity than at sensitive', () => {
    const rows: [number, number, number, number][] = [];
    for (let i = 0; i < 60; i += 1) {
      const wobble = Math.sin(i / 2) * 0.4;
      const base = 100 + wobble;
      rows.push([base, base + 0.3, base - 0.3, base + wobble / 2]);
    }
    const candles = makeCandles(rows);

    const eager = detectSwings(candles, '5M', SWING_PRESETS.sensitive);
    const cautious = detectSwings(candles, '5M', SWING_PRESETS.conservative);

    expect(cautious.length).toBeLessThanOrEqual(eager.length);
    // Micro-wobble should not be promoted to major structure.
    expect(cautious.filter((swing) => swing.major).length).toBeLessThan(eager.length);
  });
});

describe('structure events', () => {
  it('labels the first break as BOS and the reversal as CHoCH', () => {
    const candles = makeCandles([
      [10, 10.5, 9.5, 10],
      [10, 11.5, 10, 11],
      [11, 12.5, 11, 12],
      [12, 13.0, 12, 12.8], // pivot high at 13.0
      [12.8, 12.9, 11.5, 12],
      [12, 11.9, 10.5, 11],
      [11, 11.0, 9.5, 10], // pivot low at 9.5
      [10, 11.5, 10, 11],
      [11, 12.5, 11, 12],
      [12, 14.0, 12, 13.5], // closes above 13.0 -> bullish BOS
      [13.5, 14.5, 13, 14], // pivot high forming
      [14, 15.0, 13.5, 14.5],
      [14.5, 15.5, 14, 15], // pivot high at 15.5
      [15, 15.2, 14, 14.2],
      [14.2, 14.5, 13, 13.2],
      [13.2, 13.5, 12, 12.2],
      [12.2, 12.5, 9.0, 9.2], // closes below the 9.5 low -> bearish CHoCH
      [9.2, 9.5, 8.5, 9],
      [9, 9.4, 8.2, 8.6],
      [8.6, 9.0, 8.0, 8.4],
    ]);

    const swings = detectSwings(candles, '5M', sensitive);
    const events = detectStructureEvents(candles, swings, '5M');

    const bullish = events.find((event) => event.direction === 'bullish');
    expect(bullish).toBeDefined();
    expect(bullish!.kind).toBe('BOS');

    const bearish = events.find(
      (event) => event.direction === 'bearish' && event.index > bullish!.index,
    );
    expect(bearish).toBeDefined();
    expect(bearish!.kind).toBe('CHoCH');
  });

  it('requires a close beyond the level by default', () => {
    const candles = makeCandles([
      [10, 10.5, 9.5, 10],
      [10, 11.5, 10, 11],
      [11, 12.5, 11, 12],
      [12, 13.0, 12, 12.8], // pivot high 13.0
      [12.8, 12.9, 11.5, 12],
      [12, 11.9, 10.5, 11],
      [11, 11.0, 10.0, 10.5],
      [10.5, 11.5, 10, 11],
      [11, 13.5, 11, 12.5], // wick through 13.0, closes below it
      [12.5, 12.9, 12, 12.4],
    ]);

    const swings = detectSwings(candles, '5M', sensitive);
    const withClose = detectStructureEvents(candles, swings, '5M', {
      requireClose: true,
      majorOnly: false,
    });
    const withWick = detectStructureEvents(candles, swings, '5M', {
      requireClose: false,
      majorOnly: false,
    });

    expect(withClose.filter((event) => event.direction === 'bullish')).toHaveLength(0);
    expect(withWick.filter((event) => event.direction === 'bullish').length).toBeGreaterThan(0);
  });

  it('labels swings HH / HL / LH / LL', () => {
    const candles = makeCandles([
      [10, 10.5, 9.5, 10],
      [10, 11.5, 10, 11],
      [11, 12.5, 11, 12], // high
      [12, 12.0, 11, 11.5],
      [11.5, 11.4, 10.0, 10.5], // low
      [10.5, 12.0, 10.5, 11.5],
      [11.5, 13.5, 11.5, 13], // higher high
      [13, 13.0, 12.0, 12.5],
      [12.5, 12.4, 11.0, 11.5], // higher low
      [11.5, 12.5, 11.5, 12],
      [12, 12.6, 11.8, 12.2],
    ]);

    const labelled = labelSwings(detectSwings(candles, '5M', sensitive));
    const labels = labelled.map((swing) => swing.label).filter(Boolean);
    expect(labels).toContain('HH');
  });

  it('suggests transitional bias when the last two events disagree', () => {
    const bias = suggestBias([
      {
        kind: 'BOS',
        direction: 'bullish',
        scope: 'major',
        index: 5,
        time: 1,
        brokenLevel: 10,
        brokenSwingTime: 0,
        closePrice: 11,
        timeframe: '5M',
        review: 'detected',
      },
      {
        kind: 'CHoCH',
        direction: 'bearish',
        scope: 'major',
        index: 9,
        time: 2,
        brokenLevel: 9,
        brokenSwingTime: 1,
        closePrice: 8,
        timeframe: '5M',
        review: 'detected',
      },
    ]);
    expect(bias.bias).toBe('transitional');
  });
});

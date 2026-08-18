import { describe, expect, it } from 'vitest';
import { makeCandles, flat } from '../__testdata__/candles.js';
import { ReplaySession } from './replay.js';

const candles = makeCandles(Array.from({ length: 20 }, (_, i) => flat(100 + i)));

describe('replay session', () => {
  it('never exposes a candle beyond the cursor', () => {
    const session = new ReplaySession(candles, '5M', 5);
    const visible = session.visible();

    expect(visible).toHaveLength(6);
    expect(visible[visible.length - 1]!.time).toBe(candles[5]!.time);
    expect(visible.some((candle) => candle.time > session.now())).toBe(false);
  });

  it('steps forward and backward by whole bars', () => {
    const session = new ReplaySession(candles, '5M', 0);
    session.step(5);
    expect(session.cursor).toBe(5);
    session.step();
    expect(session.cursor).toBe(6);
    session.stepBack(2);
    expect(session.cursor).toBe(4);
  });

  it('clamps at both ends of the data', () => {
    const session = new ReplaySession(candles, '5M', 0);
    session.stepBack(10);
    expect(session.cursor).toBe(0);
    session.step(1000);
    expect(session.cursor).toBe(candles.length - 1);
    expect(session.atEnd).toBe(true);
  });

  it('seeks to a timestamp', () => {
    const session = new ReplaySession(candles, '5M', 0);
    session.seekTime(candles[7]!.time);
    expect(session.cursor).toBe(7);
    expect(session.visible()).toHaveLength(8);
  });

  it('sorts unordered input before replaying it', () => {
    const shuffled = [candles[3]!, candles[0]!, candles[2]!, candles[1]!];
    const session = new ReplaySession(shuffled, '5M', 3);
    const times = session.visible().map((candle) => candle.time);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

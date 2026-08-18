import type { Candle } from '../types/market.js';

/** Build a candle series from explicit OHLC tuples, five minutes apart. */
export function makeCandles(
  rows: [open: number, high: number, low: number, close: number][],
  options: { start?: number; stepSeconds?: number } = {},
): Candle[] {
  const start = options.start ?? Date.UTC(2026, 0, 5, 8, 0, 0) / 1000;
  const step = options.stepSeconds ?? 300;
  return rows.map(([open, high, low, close], index) => ({
    time: start + index * step,
    open,
    high,
    low,
    close,
    volume: 100,
  }));
}

/** A flat filler bar, used to pad a series without disturbing the pattern. */
export function flat(price: number): [number, number, number, number] {
  return [price, price + 0.2, price - 0.2, price];
}

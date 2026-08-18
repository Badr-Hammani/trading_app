import type { Candle } from '../types/market.js';

/** True range of `candles[index]`, using the previous close when available. */
export function trueRange(candles: Candle[], index: number): number {
  const current = candles[index];
  if (!current) return 0;
  const previous = index > 0 ? candles[index - 1] : undefined;
  if (!previous) return current.high - current.low;
  return Math.max(
    current.high - current.low,
    Math.abs(current.high - previous.close),
    Math.abs(current.low - previous.close),
  );
}

/**
 * Wilder-smoothed ATR at `index` over `period` bars.
 * Returns null until there are enough bars — never a guessed value.
 */
export function atrAt(candles: Candle[], index: number, period = 14): number | null {
  if (index < period) return null;
  let sum = 0;
  for (let i = index - period + 1; i <= index; i += 1) sum += trueRange(candles, i);
  return sum / period;
}

/** Mean candle body over the `period` bars ending at `index - 1` (excludes the bar itself). */
export function averageBody(candles: Candle[], index: number, period = 20): number | null {
  const start = index - period;
  if (start < 0) return null;
  let sum = 0;
  for (let i = start; i < index; i += 1) {
    const candle = candles[i];
    if (!candle) return null;
    sum += Math.abs(candle.close - candle.open);
  }
  return sum / period;
}

/** Mean candle range over the `period` bars ending at `index - 1`. */
export function averageRange(candles: Candle[], index: number, period = 20): number | null {
  const start = index - period;
  if (start < 0) return null;
  let sum = 0;
  for (let i = start; i < index; i += 1) {
    const candle = candles[i];
    if (!candle) return null;
    sum += candle.high - candle.low;
  }
  return sum / period;
}

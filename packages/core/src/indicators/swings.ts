import type { Candle, Timeframe } from '../types/market.js';
import { atrAt } from './atr.js';

/**
 * Swing detection.
 *
 * Sensitivity is deliberately configurable: treating every candle high as
 * structure is the single most common way a market-structure model produces
 * noise, so the default requires a real fractal plus a minimum displacement
 * from the neighbouring swing.
 */

export type Sensitivity = 'conservative' | 'balanced' | 'sensitive';

export interface SwingConfig {
  /** Bars required on each side of the pivot. */
  lookback: number;
  /**
   * Minimum distance from the previous opposite swing, as a multiple of ATR.
   * Filters micro-pivots inside consolidation.
   */
  minAtrMultiple: number;
  atrPeriod: number;
}

export const SWING_PRESETS: Record<Sensitivity, SwingConfig> = {
  conservative: { lookback: 5, minAtrMultiple: 1.0, atrPeriod: 14 },
  balanced: { lookback: 3, minAtrMultiple: 0.5, atrPeriod: 14 },
  sensitive: { lookback: 2, minAtrMultiple: 0.0, atrPeriod: 14 },
};

export interface SwingPoint {
  type: 'high' | 'low';
  /** Index into the candle array the swing was detected from. */
  index: number;
  time: number;
  price: number;
  timeframe: Timeframe;
  /** True for swings that also clear the ATR filter — i.e. major structure. */
  major: boolean;
}

function isPivotHigh(candles: Candle[], index: number, lookback: number): boolean {
  const pivot = candles[index];
  if (!pivot) return false;
  for (let offset = 1; offset <= lookback; offset += 1) {
    const left = candles[index - offset];
    const right = candles[index + offset];
    if (!left || !right) return false;
    // Strictly greater to the right prevents equal-high plateaus from
    // registering twice; the left side allows equality so the first bar of a
    // double top is the pivot.
    if (left.high > pivot.high) return false;
    if (right.high >= pivot.high) return false;
  }
  return true;
}

function isPivotLow(candles: Candle[], index: number, lookback: number): boolean {
  const pivot = candles[index];
  if (!pivot) return false;
  for (let offset = 1; offset <= lookback; offset += 1) {
    const left = candles[index - offset];
    const right = candles[index + offset];
    if (!left || !right) return false;
    if (left.low < pivot.low) return false;
    if (right.low <= pivot.low) return false;
  }
  return true;
}

/**
 * Detect swing points. A swing is only confirmed once `lookback` bars have
 * printed after it — the returned points are therefore never based on
 * information unavailable at the time, which matters for replay.
 */
function isPivotHighAdaptive(candles: Candle[], index: number, lookback: number): boolean {
  const pivot = candles[index];
  if (!pivot) return false;
  const rightAvailable = Math.min(lookback, candles.length - 1 - index);
  if (rightAvailable < 1) return false;

  for (let offset = 1; offset <= lookback; offset += 1) {
    const left = candles[index - offset];
    if (!left || left.high > pivot.high) return false;
  }
  for (let offset = 1; offset <= rightAvailable; offset += 1) {
    const right = candles[index + offset];
    if (!right || right.high >= pivot.high) return false;
  }
  return true;
}

function isPivotLowAdaptive(candles: Candle[], index: number, lookback: number): boolean {
  const pivot = candles[index];
  if (!pivot) return false;
  const rightAvailable = Math.min(lookback, candles.length - 1 - index);
  if (rightAvailable < 1) return false;

  for (let offset = 1; offset <= lookback; offset += 1) {
    const left = candles[index - offset];
    if (!left || left.low < pivot.low) return false;
  }
  for (let offset = 1; offset <= rightAvailable; offset += 1) {
    const right = candles[index + offset];
    if (!right || right.low <= pivot.low) return false;
  }
  return true;
}

/**
 * Detect swing points. A swing is confirmed once `lookback` bars have
 * printed after it (or adaptively for recent bars).
 */
export function detectSwings(
  candles: Candle[],
  timeframe: Timeframe,
  config: SwingConfig = SWING_PRESETS.balanced,
): SwingPoint[] {
  const { lookback, minAtrMultiple, atrPeriod } = config;
  const swings: SwingPoint[] = [];

  for (let index = lookback; index < candles.length - 1; index += 1) {
    const candle = candles[index];
    if (!candle) continue;

    const high = isPivotHighAdaptive(candles, index, lookback);
    const low = isPivotLowAdaptive(candles, index, lookback);
    if (!high && !low) continue;

    const type = high ? 'high' : 'low';
    const price = high ? candle.high : candle.low;

    let major = true;
    if (minAtrMultiple > 0) {
      const atr = atrAt(candles, index, atrPeriod);
      const previousOpposite = [...swings].reverse().find((s) => s.type !== type);
      if (atr !== null && previousOpposite) {
        major = Math.abs(price - previousOpposite.price) >= atr * minAtrMultiple;
      }
    }

    swings.push({ type, index, time: candle.time, price, timeframe, major });
  }

  return swings;
}

/** The most recent swing of each kind at or before `index`. */
export function lastSwings(
  swings: SwingPoint[],
  index: number,
): { high: SwingPoint | null; low: SwingPoint | null } {
  let high: SwingPoint | null = null;
  let low: SwingPoint | null = null;
  for (const swing of swings) {
    if (swing.index > index) break;
    if (swing.type === 'high') high = swing;
    else low = swing;
  }
  return { high, low };
}

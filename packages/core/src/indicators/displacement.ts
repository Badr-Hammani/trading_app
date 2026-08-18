import type { Candle, Timeframe } from '../types/market.js';
import { averageBody, averageRange } from './atr.js';
import type { StructureEvent } from './structure.js';
import type { FvgZone } from './fvg.js';

/**
 * Displacement detector.
 *
 * "Green candle = bullish displacement" is exactly the shortcut this module
 * exists to avoid. Displacement is scored from several independent
 * measurements and always reports WHY it scored what it did.
 *
 * The score is an analytical aid. It is not an entry signal.
 */

export interface DisplacementWeights {
  bodyExpansion: number;
  rangeExpansion: number;
  closeLocation: number;
  consecutive: number;
  structureBreak: number;
  fvgCreated: number;
}

export const DEFAULT_DISPLACEMENT_WEIGHTS: DisplacementWeights = {
  bodyExpansion: 25,
  rangeExpansion: 20,
  closeLocation: 15,
  consecutive: 10,
  structureBreak: 15,
  fvgCreated: 15,
};

export interface DisplacementConfig {
  weights: DisplacementWeights;
  /** Bars used for the "recent" baselines. */
  lookback: number;
  /** Body must be at least this multiple of the average body to score at all. */
  minBodyMultiple: number;
  /** Score at or above which the candle is labelled displacement. */
  threshold: number;
}

export const DEFAULT_DISPLACEMENT_CONFIG: DisplacementConfig = {
  weights: DEFAULT_DISPLACEMENT_WEIGHTS,
  lookback: 20,
  minBodyMultiple: 1.3,
  threshold: 60,
};

export interface DisplacementReading {
  index: number;
  time: number;
  timeframe: Timeframe;
  direction: 'bullish' | 'bearish';
  /** 0…100. */
  score: number;
  /** True when `score >= config.threshold`. */
  qualifies: boolean;
  reasons: string[];
  metrics: {
    bodyMultiple: number | null;
    rangeMultiple: number | null;
    closeLocation: number;
    consecutive: number;
    brokeStructure: boolean;
    createdFvg: boolean;
  };
}

/** Score a single candle. Returns null when there is not enough history. */
export function scoreDisplacement(
  candles: Candle[],
  index: number,
  timeframe: Timeframe,
  options: {
    structureEvents?: StructureEvent[];
    fvgZones?: FvgZone[];
    config?: DisplacementConfig;
  } = {},
): DisplacementReading | null {
  const config = options.config ?? DEFAULT_DISPLACEMENT_CONFIG;
  const candle = candles[index];
  if (!candle) return null;

  const avgBody = averageBody(candles, index, config.lookback);
  const avgRange = averageRange(candles, index, config.lookback);
  if (avgBody === null || avgRange === null) return null;

  const body = Math.abs(candle.close - candle.open);
  const range = candle.high - candle.low;
  const direction: 'bullish' | 'bearish' = candle.close >= candle.open ? 'bullish' : 'bearish';

  const bodyMultiple = avgBody > 0 ? body / avgBody : null;
  const rangeMultiple = avgRange > 0 ? range / avgRange : null;

  // Where the candle closed inside its own range: 1 = at the extreme in the
  // candle's direction, 0 = at the opposite extreme.
  const closeLocation =
    range > 0
      ? direction === 'bullish'
        ? (candle.close - candle.low) / range
        : (candle.high - candle.close) / range
      : 0;

  let consecutive = 0;
  for (let i = index; i >= 0; i -= 1) {
    const c = candles[i];
    if (!c) break;
    const isSame = direction === 'bullish' ? c.close > c.open : c.close < c.open;
    if (!isSame) break;
    consecutive += 1;
  }

  const brokeStructure = (options.structureEvents ?? []).some(
    (event) => event.index === index && event.direction === direction && event.review !== 'rejected',
  );

  // A gap becomes visible on the third candle, so a candle "creates" an FVG
  // whose formation completes on the bar itself or the bar after it.
  const createdFvg = (options.fvgZones ?? []).some(
    (zone) =>
      zone.direction === direction &&
      (zone.createdIndex === index || zone.createdIndex === index + 1),
  );

  const { weights } = config;
  const reasons: string[] = [];
  let score = 0;

  if (bodyMultiple !== null) {
    const ratio = clamp01((bodyMultiple - 1) / 2);
    score += ratio * weights.bodyExpansion;
    if (bodyMultiple >= config.minBodyMultiple) {
      reasons.push(`Body ${bodyMultiple.toFixed(1)}x the recent average`);
    } else {
      reasons.push(`Body only ${bodyMultiple.toFixed(1)}x the recent average`);
    }
  }

  if (rangeMultiple !== null) {
    const ratio = clamp01((rangeMultiple - 1) / 2);
    score += ratio * weights.rangeExpansion;
    if (rangeMultiple >= 1.5) reasons.push(`Range expansion ${rangeMultiple.toFixed(1)}x`);
  }

  score += clamp01((closeLocation - 0.5) * 2) * weights.closeLocation;
  if (closeLocation >= 0.75) {
    reasons.push(`Closed in the top ${Math.round((1 - closeLocation) * 100)}% of its range`);
  }

  score += clamp01((consecutive - 1) / 3) * weights.consecutive;
  if (consecutive >= 3) reasons.push(`${consecutive} consecutive ${direction} candles`);

  if (brokeStructure) {
    score += weights.structureBreak;
    reasons.push('Broke structure on this candle');
  }

  if (createdFvg) {
    score += weights.fvgCreated;
    reasons.push('Created a fair value gap');
  }

  const rounded = Math.round(Math.max(0, Math.min(100, score)));

  return {
    index,
    time: candle.time,
    timeframe,
    direction,
    score: rounded,
    qualifies: rounded >= config.threshold && (bodyMultiple ?? 0) >= config.minBodyMultiple,
    reasons,
    metrics: { bodyMultiple, rangeMultiple, closeLocation, consecutive, brokeStructure, createdFvg },
  };
}

/** Score every candle that has enough history behind it. */
export function scanDisplacement(
  candles: Candle[],
  timeframe: Timeframe,
  options: {
    structureEvents?: StructureEvent[];
    fvgZones?: FvgZone[];
    config?: DisplacementConfig;
  } = {},
): DisplacementReading[] {
  const readings: DisplacementReading[] = [];
  for (let index = 0; index < candles.length; index += 1) {
    const reading = scoreDisplacement(candles, index, timeframe, options);
    if (reading) readings.push(reading);
  }
  return readings;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

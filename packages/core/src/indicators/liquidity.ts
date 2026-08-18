import type { Candle, Timeframe } from '../types/market.js';
import { atrAt } from './atr.js';
import { dayKey, startOfLocalDay, startOfLocalWeek } from '../time/clock.js';
import type { SessionDefinition } from '../sessions/types.js';
import { sessionOccurrences } from '../sessions/engine.js';
import type { SwingPoint } from './swings.js';

/**
 * Liquidity map.
 *
 * Levels are where resting orders plausibly sit. The engine derives the
 * obvious ones (session and period extremes, equal highs/lows, swings) and
 * the user may add or edit any level by hand.
 *
 * Sweep detection is deliberately strict: a wick past a level is not a sweep.
 * Price must penetrate meaningfully AND close back on the original side.
 */

export const LIQUIDITY_TYPES = [
  'PDH',
  'PDL',
  'PWH',
  'PWL',
  'ASIAN_HIGH',
  'ASIAN_LOW',
  'LONDON_HIGH',
  'LONDON_LOW',
  'EQUAL_HIGHS',
  'EQUAL_LOWS',
  'SWING_HIGH',
  'SWING_LOW',
  'INTERNAL',
  'EXTERNAL',
] as const;

export type LiquidityType = (typeof LIQUIDITY_TYPES)[number];

export type LiquiditySide = 'buy-side' | 'sell-side';

export type LiquidityStatus = 'intact' | 'swept' | 'broken';

export interface LiquidityLevel {
  id: string;
  type: LiquidityType;
  side: LiquiditySide;
  price: number;
  timeframe: Timeframe;
  /** When the level came into existence (epoch seconds). */
  createdTime: number;
  status: LiquidityStatus;
  /** Set when the level was swept or broken. */
  eventTime: number | null;
  eventIndex: number | null;
  /** How far beyond the level price traded, in price units. */
  penetration: number | null;
  /** True when the user created the level by hand. */
  manual: boolean;
  notes: string;
  label: string;
}

/** Highs are buy-side liquidity (stops of shorts rest above); lows are sell-side. */
export function sideForType(type: LiquidityType): LiquiditySide {
  const buySide: LiquidityType[] = ['PDH', 'PWH', 'ASIAN_HIGH', 'LONDON_HIGH', 'EQUAL_HIGHS', 'SWING_HIGH'];
  return buySide.includes(type) ? 'buy-side' : 'sell-side';
}

export interface SweepConfig {
  /** Minimum penetration beyond the level, as a multiple of ATR. */
  minPenetrationAtr: number;
  /** Absolute minimum penetration in price units; 0 disables the floor. */
  minPenetrationAbsolute: number;
  /** Bars allowed for price to close back on the original side. */
  reclaimBars: number;
  atrPeriod: number;
}

export const DEFAULT_SWEEP_CONFIG: SweepConfig = {
  minPenetrationAtr: 0.15,
  minPenetrationAbsolute: 0,
  reclaimBars: 3,
  atrPeriod: 14,
};

/**
 * Classify what price did to each level.
 *
 * - `swept`   — penetrated meaningfully, then closed back through the level.
 * - `broken`  — closed beyond and stayed beyond for the reclaim window.
 * - `intact`  — untouched, or touched without a qualifying penetration.
 */
export function evaluateLiquidity(
  levels: LiquidityLevel[],
  candles: Candle[],
  config: SweepConfig = DEFAULT_SWEEP_CONFIG,
): LiquidityLevel[] {
  return levels.map((level) => {
    if (level.status !== 'intact') return level;

    for (let index = 0; index < candles.length; index += 1) {
      const candle = candles[index];
      if (!candle || candle.time < level.createdTime) continue;

      const isBuySide = level.side === 'buy-side';
      const extreme = isBuySide ? candle.high : candle.low;
      const penetration = isBuySide ? extreme - level.price : level.price - extreme;
      if (penetration <= 0) continue;

      const atr = atrAt(candles, index, config.atrPeriod);
      const required = Math.max(
        config.minPenetrationAbsolute,
        atr !== null ? atr * config.minPenetrationAtr : 0,
      );
      // A shallow wick through the level is noise, not a liquidity event.
      if (penetration < required) continue;

      // Look for a close back on the original side inside the reclaim window.
      let reclaimed = false;
      let eventIndex = index;
      for (let ahead = 0; ahead <= config.reclaimBars; ahead += 1) {
        const future = candles[index + ahead];
        if (!future) break;
        const backInside = isBuySide ? future.close < level.price : future.close > level.price;
        if (backInside) {
          reclaimed = true;
          eventIndex = index + ahead;
          break;
        }
      }

      const eventCandle = candles[eventIndex];
      return {
        ...level,
        status: reclaimed ? 'swept' : 'broken',
        eventIndex,
        eventTime: eventCandle ? eventCandle.time : candle.time,
        penetration,
      };
    }

    return level;
  });
}

function extremes(candles: Candle[]): { high: number; low: number } | null {
  if (candles.length === 0) return null;
  let high = -Infinity;
  let low = Infinity;
  for (const candle of candles) {
    if (candle.high > high) high = candle.high;
    if (candle.low < low) low = candle.low;
  }
  return { high, low };
}

function makeLevel(
  partial: Omit<LiquidityLevel, 'id' | 'side' | 'status' | 'eventTime' | 'eventIndex' | 'penetration' | 'manual' | 'notes'>,
): LiquidityLevel {
  return {
    ...partial,
    id: `${partial.type}:${partial.createdTime}:${partial.price.toFixed(3)}`,
    side: sideForType(partial.type),
    status: 'intact',
    eventTime: null,
    eventIndex: null,
    penetration: null,
    manual: false,
    notes: '',
  };
}

/**
 * Derive the standard reference levels for the day containing `at`.
 * Returns only the levels the data actually supports — a missing previous day
 * yields no PDH/PDL rather than a fabricated one.
 */
export function derivePeriodLevels(
  candles: Candle[],
  timeframe: Timeframe,
  at: number,
  timezone: string,
): LiquidityLevel[] {
  const levels: LiquidityLevel[] = [];

  const todayStart = startOfLocalDay(at, timezone);
  const previousDayStart = startOfLocalDay(todayStart - 1, timezone);
  const previousDay = candles.filter((c) => c.time >= previousDayStart && c.time < todayStart);
  const pd = extremes(previousDay);
  if (pd) {
    const label = dayKey(previousDayStart, timezone);
    levels.push(
      makeLevel({ type: 'PDH', price: pd.high, timeframe, createdTime: todayStart, label: `PDH ${label}` }),
      makeLevel({ type: 'PDL', price: pd.low, timeframe, createdTime: todayStart, label: `PDL ${label}` }),
    );
  }

  const weekStart = startOfLocalWeek(at, timezone);
  const previousWeekStart = startOfLocalWeek(weekStart - 1, timezone);
  const previousWeek = candles.filter((c) => c.time >= previousWeekStart && c.time < weekStart);
  const pw = extremes(previousWeek);
  if (pw) {
    levels.push(
      makeLevel({ type: 'PWH', price: pw.high, timeframe, createdTime: weekStart, label: 'PWH' }),
      makeLevel({ type: 'PWL', price: pw.low, timeframe, createdTime: weekStart, label: 'PWL' }),
    );
  }

  return levels;
}

/** Session range extremes (Asian high/low, London high/low) for the day containing `at`. */
export function deriveSessionLevels(
  candles: Candle[],
  timeframe: Timeframe,
  at: number,
  sessions: SessionDefinition[],
): LiquidityLevel[] {
  const levels: LiquidityLevel[] = [];
  const map: Partial<Record<string, [LiquidityType, LiquidityType]>> = {
    asian: ['ASIAN_HIGH', 'ASIAN_LOW'],
    london: ['LONDON_HIGH', 'LONDON_LOW'],
  };

  for (const definition of sessions) {
    const pair = map[definition.kind];
    if (!pair) continue;

    const occurrences = sessionOccurrences(definition, at - 36 * 3600, at);
    const occurrence = occurrences.filter((o) => o.start <= at).pop();
    if (!occurrence) continue;

    const window = candles.filter((c) => c.time >= occurrence.start && c.time < Math.min(occurrence.end, at));
    const range = extremes(window);
    if (!range) continue;

    // Only publish the level once the session has closed; a live session's
    // extreme is not yet a level, it is still forming.
    const createdTime = Math.min(occurrence.end, at);
    levels.push(
      makeLevel({ type: pair[0], price: range.high, timeframe, createdTime, label: `${definition.name} high` }),
      makeLevel({ type: pair[1], price: range.low, timeframe, createdTime, label: `${definition.name} low` }),
    );
  }

  return levels;
}

export interface EqualLevelConfig {
  /** Prices within this multiple of ATR count as equal. */
  toleranceAtr: number;
  /** Minimum number of touches. */
  minTouches: number;
  atrPeriod: number;
}

export const DEFAULT_EQUAL_CONFIG: EqualLevelConfig = {
  toleranceAtr: 0.1,
  minTouches: 2,
  atrPeriod: 14,
};

/** Cluster swing points into equal-highs / equal-lows pools. */
export function deriveEqualLevels(
  swings: SwingPoint[],
  candles: Candle[],
  timeframe: Timeframe,
  config: EqualLevelConfig = DEFAULT_EQUAL_CONFIG,
): LiquidityLevel[] {
  const levels: LiquidityLevel[] = [];

  for (const type of ['high', 'low'] as const) {
    const pool = swings.filter((swing) => swing.type === type);
    const used = new Set<number>();

    for (let i = 0; i < pool.length; i += 1) {
      if (used.has(i)) continue;
      const anchor = pool[i]!;
      const atr = atrAt(candles, anchor.index, config.atrPeriod);
      if (atr === null) continue;
      const tolerance = atr * config.toleranceAtr;

      const cluster = [anchor];
      for (let j = i + 1; j < pool.length; j += 1) {
        const other = pool[j]!;
        if (used.has(j)) continue;
        if (Math.abs(other.price - anchor.price) <= tolerance) {
          cluster.push(other);
          used.add(j);
        }
      }

      if (cluster.length >= config.minTouches) {
        used.add(i);
        const price = cluster.reduce((sum, s) => sum + s.price, 0) / cluster.length;
        const last = cluster[cluster.length - 1]!;
        levels.push(
          makeLevel({
            type: type === 'high' ? 'EQUAL_HIGHS' : 'EQUAL_LOWS',
            price,
            timeframe,
            createdTime: last.time,
            label: `${cluster.length}x equal ${type}s`,
          }),
        );
      }
    }
  }

  return levels;
}

/**
 * Split levels into external (beyond the current range) and internal
 * (inside it) liquidity relative to a reference price.
 */
export function classifyLiquidity(
  levels: LiquidityLevel[],
  rangeHigh: number,
  rangeLow: number,
): { external: LiquidityLevel[]; internal: LiquidityLevel[] } {
  const external: LiquidityLevel[] = [];
  const internal: LiquidityLevel[] = [];
  for (const level of levels) {
    if (level.price >= rangeHigh || level.price <= rangeLow) external.push(level);
    else internal.push(level);
  }
  return { external, internal };
}

/** Nearest intact level on a given side of `price`. */
export function nearestLiquidity(
  levels: LiquidityLevel[],
  price: number,
  side: LiquiditySide,
): LiquidityLevel | null {
  const candidates = levels.filter(
    (level) =>
      level.status === 'intact' &&
      level.side === side &&
      (side === 'buy-side' ? level.price > price : level.price < price),
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((closest, level) =>
    Math.abs(level.price - price) < Math.abs(closest.price - price) ? level : closest,
  );
}

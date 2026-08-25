import type { Candle, Timeframe } from '../types/market.js';
import { averageRange } from './atr.js';

/**
 * Fair Value Gap manager.
 *
 * Two rules drive this module and both come straight from the trading model:
 *
 *  1. An FVG is a LOCATION, never an entry. Nothing here emits a signal.
 *  2. A violated FVG is dead. If a later candle prints another gap over the
 *     same prices, that is a NEW zone with its own identity — the old one is
 *     never revived. Overlapping zones stack rather than replacing each other.
 */

export type FvgDirection = 'bullish' | 'bearish';

export type FvgStatus =
  | 'fresh'
  | 'partially_mitigated'
  | 'fully_mitigated'
  | 'invalidated';

export interface FvgStateChange {
  index: number;
  time: number;
  status: FvgStatus;
  /** Fraction of the gap consumed, 0…1. */
  mitigation: number;
}

export interface FvgZone {
  /** Stable identity: timeframe + creation time + direction. */
  id: string;
  direction: FvgDirection;
  timeframe: Timeframe;
  /** Index and time of the third candle, i.e. when the gap became visible. */
  createdIndex: number;
  createdTime: number;
  /** Times of the three candles that formed the gap. */
  sourceCandleTimes: [number, number, number];
  high: number;
  low: number;
  midpoint: number;
  size: number;
  /** Gap size relative to the average range of the prior 20 bars, or null. */
  relativeSize: number | null;
  status: FvgStatus;
  /** Fraction of the gap consumed at the latest evaluated bar. */
  mitigation: number;
  firstTouchIndex: number | null;
  firstTouchTime: number | null;
  history: FvgStateChange[];
  /** Ids of earlier zones this one overlaps. They are kept, never merged. */
  overlaps: string[];
}

export interface FvgConfig {
  /** Discard gaps smaller than this multiple of the average range. */
  minRelativeSize: number;
  /** Absolute minimum gap in price units; 0 disables the floor. */
  minAbsoluteSize: number;
  /** A close beyond the far edge invalidates the zone. */
  invalidateOnClose: boolean;
  averagePeriod: number;
}

export const DEFAULT_FVG_CONFIG: FvgConfig = {
  minRelativeSize: 0.15,
  minAbsoluteSize: 0.3,
  invalidateOnClose: true,
  averagePeriod: 20,
};

function makeId(timeframe: Timeframe, direction: FvgDirection, time: number, seq: number): string {
  return `${timeframe}:${direction}:${time}:${seq}`;
}

/**
 * Detect every FVG in the series and evolve each zone's state bar by bar.
 *
 * The returned zones carry a full `history`, so `fvgStatusAt` can answer
 * "what did this zone look like at bar N?" without re-scanning — the property
 * replay depends on.
 */
export function buildFvgZones(
  candles: Candle[],
  timeframe: Timeframe,
  config: FvgConfig = DEFAULT_FVG_CONFIG,
): FvgZone[] {
  const zones: FvgZone[] = [];
  let sequence = 0;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    if (!candle) continue;

    // Evolve zones created before this bar.
    for (const zone of zones) {
      if (zone.createdIndex >= index) continue;
      evolveZone(zone, candle, index, config);
    }

    // A gap becomes visible on the third candle.
    const first = candles[index - 2];
    const middle = candles[index - 1];
    if (!first || !middle) continue;

    const reference = averageRange(candles, index, config.averagePeriod);

    const bullishGap = candle.low - first.high;
    const bearishGap = first.low - candle.high;

    if (bullishGap > 0 && passesSize(bullishGap, reference, config)) {
      sequence += 1;
      zones.push(
        newZone({
          direction: 'bullish',
          timeframe,
          index,
          candle,
          low: first.high,
          high: candle.low,
          sourceTimes: [first.time, middle.time, candle.time],
          reference,
          sequence,
          existing: zones,
        }),
      );
    }

    if (bearishGap > 0 && passesSize(bearishGap, reference, config)) {
      sequence += 1;
      zones.push(
        newZone({
          direction: 'bearish',
          timeframe,
          index,
          candle,
          low: candle.high,
          high: first.low,
          sourceTimes: [first.time, middle.time, candle.time],
          reference,
          sequence,
          existing: zones,
        }),
      );
    }
  }

  return zones;
}

function passesSize(gap: number, reference: number | null, config: FvgConfig): boolean {
  if (gap <= 0) return false;
  if (config.minAbsoluteSize > 0 && gap < config.minAbsoluteSize) return false;
  if (reference !== null && reference > 0 && gap / reference < config.minRelativeSize) return false;
  return true;
}

function newZone(args: {
  direction: FvgDirection;
  timeframe: Timeframe;
  index: number;
  candle: Candle;
  low: number;
  high: number;
  sourceTimes: [number, number, number];
  reference: number | null;
  sequence: number;
  existing: FvgZone[];
}): FvgZone {
  const size = args.high - args.low;
  const id = makeId(args.timeframe, args.direction, args.candle.time, args.sequence);

  // Record overlaps for display ordering. Overlapping zones STACK: a dead zone
  // in the same price area is never resurrected by a new one forming over it.
  const overlaps = args.existing
    .filter((zone) => zone.high >= args.low && zone.low <= args.high)
    .map((zone) => zone.id);

  return {
    id,
    direction: args.direction,
    timeframe: args.timeframe,
    createdIndex: args.index,
    createdTime: args.candle.time,
    sourceCandleTimes: args.sourceTimes,
    high: args.high,
    low: args.low,
    midpoint: (args.high + args.low) / 2,
    size,
    relativeSize: args.reference && args.reference > 0 ? size / args.reference : null,
    status: 'fresh',
    mitigation: 0,
    firstTouchIndex: null,
    firstTouchTime: null,
    history: [{ index: args.index, time: args.candle.time, status: 'fresh', mitigation: 0 }],
    overlaps,
  };
}

/**
 * Advance one zone by one candle.
 *
 * Terminal states are terminal. Once a zone is fully mitigated or invalidated
 * it stops evolving, which is exactly the "do not revive the old FVG" rule.
 */
function evolveZone(zone: FvgZone, candle: Candle, index: number, config: FvgConfig): void {
  if (zone.status === 'fully_mitigated' || zone.status === 'invalidated') return;

  const touched = candle.low <= zone.high && candle.high >= zone.low;
  if (touched && zone.firstTouchIndex === null) {
    zone.firstTouchIndex = index;
    zone.firstTouchTime = candle.time;
  }

  // Mitigation is measured from the edge price first reaches when returning
  // into the zone: bullish gaps are consumed from the top down.
  let mitigation = zone.mitigation;
  if (touched && zone.size > 0) {
    const penetration =
      zone.direction === 'bullish'
        ? (zone.high - Math.max(candle.low, zone.low)) / zone.size
        : (Math.min(candle.high, zone.high) - zone.low) / zone.size;
    mitigation = Math.max(mitigation, Math.min(1, Math.max(0, penetration)));
  }

  let status: FvgStatus = zone.status;

  if (config.invalidateOnClose) {
    const closedThrough =
      zone.direction === 'bullish' ? candle.close < zone.low : candle.close > zone.high;
    if (closedThrough) {
      status = 'invalidated';
      mitigation = 1;
    }
  }

  if (status !== 'invalidated') {
    const filled = zone.direction === 'bullish' ? candle.low <= zone.low : candle.high >= zone.high;
    if (filled) {
      status = 'fully_mitigated';
      mitigation = 1;
    } else if (mitigation > 0) {
      status = 'partially_mitigated';
    }
  }

  if (status !== zone.status || mitigation !== zone.mitigation) {
    zone.status = status;
    zone.mitigation = mitigation;
    zone.history.push({ index, time: candle.time, status, mitigation });
  }
}

/** The zone's state as of `index` — the basis of lookahead-free replay. */
export function fvgStatusAt(zone: FvgZone, index: number): FvgStateChange | null {
  if (zone.createdIndex > index) return null;
  let current: FvgStateChange | null = null;
  for (const change of zone.history) {
    if (change.index > index) break;
    current = change;
  }
  return current;
}

/** Zones that exist and are still tradeable locations at `index`. */
export function freshFvgsAt(zones: FvgZone[], index: number, direction?: FvgDirection): FvgZone[] {
  return zones.filter((zone) => {
    if (direction && zone.direction !== direction) return false;
    const state = fvgStatusAt(zone, index);
    if (!state) return false;
    return state.status === 'fresh' || state.status === 'partially_mitigated';
  });
}

/**
 * Quality score for an execution FVG, 0…100.
 *
 * This grades the LOCATION only. It is an analytical aid, never a signal, and
 * a high score alone must never be presented as a reason to enter.
 */
export function scoreFvgQuality(
  zone: FvgZone,
  context: { displacementScore?: number | null; createdByStructureBreak?: boolean },
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  if (zone.relativeSize !== null) {
    if (zone.relativeSize >= 1) {
      score += 30;
      reasons.push('Gap larger than the average recent range');
    } else if (zone.relativeSize >= 0.5) {
      score += 20;
      reasons.push('Gap is a meaningful fraction of recent range');
    } else {
      score += 8;
      reasons.push('Small gap relative to recent range');
    }
  }

  if (zone.status === 'fresh') {
    score += 25;
    reasons.push('Untouched since creation');
  } else if (zone.status === 'partially_mitigated' && zone.mitigation < 0.5) {
    score += 12;
    reasons.push('Only shallowly mitigated');
  } else {
    reasons.push('Already substantially mitigated');
  }

  if (context.createdByStructureBreak) {
    score += 25;
    reasons.push('Formed on the structure break');
  }

  const displacement = context.displacementScore ?? null;
  if (displacement !== null) {
    score += Math.round((displacement / 100) * 20);
    reasons.push(`Formed by displacement scoring ${displacement}/100`);
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

/**
 * Filter out fully mitigated, invalidated, or micro noise gaps.
 */
export function filterCleanFvgs(
  zones: FvgZone[],
  options: { maxMitigation?: number; minSize?: number } = {},
): FvgZone[] {
  const maxMitigation = options.maxMitigation ?? 0.75;
  const minSize = options.minSize ?? 0.3;

  return zones.filter((zone) => {
    if (zone.status === 'fully_mitigated' || zone.status === 'invalidated') return false;
    if (zone.mitigation >= maxMitigation) return false;
    if (zone.size < minSize) return false;
    return true;
  });
}

/**
 * Consolidate contiguous or overlapping unmitigated FVG zones in the same direction.
 * Reduces multiple 0.5-point boxes into 1 clean Fair Value Zone.
 */
export function consolidateFvgZones(zones: FvgZone[]): FvgZone[] {
  if (zones.length <= 1) return zones;

  const result: FvgZone[] = [];
  const sorted = [...zones].sort((a, b) => a.low - b.low);

  for (const zone of sorted) {
    if (result.length === 0) {
      result.push({ ...zone });
      continue;
    }

    const prev = result[result.length - 1]!;
    if (prev.direction === zone.direction && zone.low <= prev.high + 0.1 && zone.high >= prev.low - 0.1) {
      prev.high = Math.max(prev.high, zone.high);
      prev.low = Math.min(prev.low, zone.low);
      prev.midpoint = (prev.high + prev.low) / 2;
      prev.size = prev.high - prev.low;
      prev.mitigation = Math.min(prev.mitigation, zone.mitigation);
      if (prev.status === 'fresh' || zone.status === 'fresh') {
        prev.status = 'fresh';
      }
    } else {
      result.push({ ...zone });
    }
  }

  return result;
}

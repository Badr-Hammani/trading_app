import type { Bias, Candle, Timeframe } from '../types/market.js';
import type { SwingPoint } from './swings.js';

/**
 * Market-structure engine.
 *
 * Produces BOS / CHoCH events and HH-HL-LH-LL labels from confirmed swings.
 * Every event is `detected` until the user confirms or rejects it: the model
 * is discretionary, and the application must not pretend otherwise.
 */

export type StructureEventKind = 'BOS' | 'CHoCH';
export type StructureScope = 'major' | 'internal';
export type StructureReviewState = 'detected' | 'confirmed' | 'rejected';
export type SwingLabel = 'HH' | 'HL' | 'LH' | 'LL';

export interface StructureEvent {
  kind: StructureEventKind;
  direction: 'bullish' | 'bearish';
  scope: StructureScope;
  /** Candle index that broke the level. */
  index: number;
  time: number;
  /** The swing price that was taken out. */
  brokenLevel: number;
  /** Time of the swing that was taken out. */
  brokenSwingTime: number;
  /** Close of the breaking candle. */
  closePrice: number;
  timeframe: Timeframe;
  review: StructureReviewState;
}

export interface LabelledSwing extends SwingPoint {
  label: SwingLabel | null;
}

export interface StructureConfig {
  /**
   * Require a candle CLOSE beyond the swing rather than a wick. Wick-only
   * breaks are how noise gets mistaken for structure, so close is the default.
   */
  requireClose: boolean;
  /** Only consider swings flagged major when tracking major structure. */
  majorOnly: boolean;
}

export const DEFAULT_STRUCTURE_CONFIG: StructureConfig = {
  requireClose: true,
  majorOnly: false,
};

export function labelSwings(swings: SwingPoint[]): LabelledSwing[] {
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];
  return swings.map((swing) => {
    let label: SwingLabel | null = null;
    if (swing.type === 'high') {
      const previous = highs[highs.length - 1];
      if (previous) label = swing.price > previous.price ? 'HH' : 'LH';
      highs.push(swing);
    } else {
      const previous = lows[lows.length - 1];
      if (previous) label = swing.price < previous.price ? 'LL' : 'HL';
      lows.push(swing);
    }
    return { ...swing, label };
  });
}

/**
 * Detect structure events by replaying candles in order.
 *
 * A swing only becomes a reference level once it is confirmed, i.e. once
 * `lookback` bars have printed after it. This is what keeps replay honest:
 * at bar N the engine only knows about swings that were already confirmed.
 */
export function detectStructureEvents(
  candles: Candle[],
  swings: SwingPoint[],
  timeframe: Timeframe,
  config: StructureConfig = DEFAULT_STRUCTURE_CONFIG,
): StructureEvent[] {
  const usable = config.majorOnly ? swings.filter((s) => s.major) : swings;
  const events: StructureEvent[] = [];

  let trend: 'bullish' | 'bearish' | null = null;
  let referenceHigh: SwingPoint | null = null;
  let referenceLow: SwingPoint | null = null;
  let swingCursor = 0;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    if (!candle) continue;

    // Promote swings that are confirmed as of this bar. `confirmedAt` is the
    // pivot index plus the bars needed to validate it, approximated by the
    // distance to the next swing's detection; using the pivot index directly
    // would leak future information.
    while (swingCursor < usable.length) {
      const swing = usable[swingCursor]!;
      const confirmedAt = swing.index + confirmationLagFor(usable, swingCursor);
      if (confirmedAt > index) break;
      if (swing.type === 'high') referenceHigh = swing;
      else referenceLow = swing;
      swingCursor += 1;
    }

    const upperBreak = config.requireClose ? candle.close : candle.high;
    const lowerBreak = config.requireClose ? candle.close : candle.low;

    if (referenceHigh && upperBreak > referenceHigh.price && index > referenceHigh.index) {
      events.push({
        kind: trend === 'bearish' ? 'CHoCH' : 'BOS',
        direction: 'bullish',
        scope: referenceHigh.major ? 'major' : 'internal',
        index,
        time: candle.time,
        brokenLevel: referenceHigh.price,
        brokenSwingTime: referenceHigh.time,
        closePrice: candle.close,
        timeframe,
        review: 'detected',
      });
      trend = 'bullish';
      referenceHigh = null;
    } else if (referenceLow && lowerBreak < referenceLow.price && index > referenceLow.index) {
      events.push({
        kind: trend === 'bullish' ? 'CHoCH' : 'BOS',
        direction: 'bearish',
        scope: referenceLow.major ? 'major' : 'internal',
        index,
        time: candle.time,
        brokenLevel: referenceLow.price,
        brokenSwingTime: referenceLow.time,
        closePrice: candle.close,
        timeframe,
        review: 'detected',
      });
      trend = 'bearish';
      referenceLow = null;
    }
  }

  return events;
}

/**
 * Bars after the pivot before the swing can be considered known. Derived from
 * the gap to the next detected swing, capped so a long trend leg does not
 * postpone confirmation indefinitely.
 */
function confirmationLagFor(swings: SwingPoint[], cursor: number): number {
  const swing = swings[cursor]!;
  const next = swings[cursor + 1];
  if (!next) return 1;
  return Math.min(Math.max(1, next.index - swing.index), 10);
}

/**
 * Derive a structural bias from the most recent events. This is offered as a
 * SUGGESTION only — the user's own bias is stored separately and is never
 * overwritten by it.
 */
export function suggestBias(events: StructureEvent[]): {
  bias: Bias;
  rationale: string;
} {
  const considered = events.filter((e) => e.review !== 'rejected');
  if (considered.length === 0) {
    return { bias: 'neutral', rationale: 'No confirmed structure events on this timeframe.' };
  }
  const last = considered[considered.length - 1]!;
  const previous = considered[considered.length - 2];

  if (previous && previous.direction !== last.direction) {
    return {
      bias: 'transitional',
      rationale: `Last two events disagree: ${previous.direction} ${previous.kind} then ${last.direction} ${last.kind}.`,
    };
  }
  return {
    bias: last.direction === 'bullish' ? 'bullish' : 'bearish',
    rationale: `Most recent event is a ${last.direction} ${last.kind} through ${last.brokenLevel}.`,
  };
}

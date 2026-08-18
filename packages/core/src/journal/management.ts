import type { Direction, InstrumentSpec } from '../types/market.js';
import { profitFor, valuePerPricePerLot } from '../risk-engine/calculator.js';

/**
 * Trade management models.
 *
 * No management style is assumed superior. Each is expressed as data so the
 * Strategy Lab can run the same trade list through all of them and compare
 * the outcomes instead of arguing about them.
 */

export type StopBehaviour = 'breakeven' | 'original' | 'trail_structure';

export interface ManagementLeg {
  /** Target the partial is taken at. */
  target: 'TP1' | 'TP2' | 'TP3' | 'R';
  /** For `R` targets, the R multiple at which to exit. */
  rMultiple?: number;
  /** Percentage of the ORIGINAL position closed at this leg. */
  closePercent: number;
}

export interface ManagementModel {
  id: string;
  name: string;
  description: string;
  legs: ManagementLeg[];
  /** What happens to the stop once the first partial is taken. */
  stopAfterFirstPartial: StopBehaviour;
  /** Whether the final portion is trailed by structure rather than a fixed TP. */
  runnerTrailsStructure: boolean;
}

export const MANAGEMENT_MODELS: ManagementModel[] = [
  {
    id: 'A',
    name: 'A — 50% TP1, runner to breakeven',
    description:
      'Close half at TP1, move the remainder to breakeven, hold toward TP2. The current default in the trading plan.',
    legs: [
      { target: 'TP1', closePercent: 50 },
      { target: 'TP2', closePercent: 50 },
    ],
    stopAfterFirstPartial: 'breakeven',
    runnerTrailsStructure: false,
  },
  {
    id: 'B',
    name: 'B — 50% TP1, runner keeps original stop',
    description:
      'Close half at TP1 but leave the stop where it was. Gives the runner room at the cost of giving back the partial.',
    legs: [
      { target: 'TP1', closePercent: 50 },
      { target: 'TP2', closePercent: 50 },
    ],
    stopAfterFirstPartial: 'original',
    runnerTrailsStructure: false,
  },
  {
    id: 'C',
    name: 'C — 50% TP1, runner trailed by structure',
    description: 'Close half at TP1, then trail the remainder behind each new confirmed swing.',
    legs: [
      { target: 'TP1', closePercent: 50 },
      { target: 'TP3', closePercent: 50 },
    ],
    stopAfterFirstPartial: 'breakeven',
    runnerTrailsStructure: true,
  },
  {
    id: 'D',
    name: 'D — full position at fixed 2R',
    description: 'No partials. The whole position exits at 2R or at the stop.',
    legs: [{ target: 'R', rMultiple: 2, closePercent: 100 }],
    stopAfterFirstPartial: 'original',
    runnerTrailsStructure: false,
  },
  {
    id: 'FULL',
    name: 'Full position to target',
    description: 'Hold the entire position to a single take-profit.',
    legs: [{ target: 'TP1', closePercent: 100 }],
    stopAfterFirstPartial: 'original',
    runnerTrailsStructure: false,
  },
  {
    id: 'SCALE',
    name: 'Scale out 50 / 25 / 25',
    description: 'Take 50% at TP1, 25% at TP2, 25% at TP3.',
    legs: [
      { target: 'TP1', closePercent: 50 },
      { target: 'TP2', closePercent: 25 },
      { target: 'TP3', closePercent: 25 },
    ],
    stopAfterFirstPartial: 'breakeven',
    runnerTrailsStructure: false,
  },
  {
    id: 'RUNNER',
    name: 'Runner managed by structure',
    description: 'Small partial at TP1, remainder trailed behind structure with no fixed target.',
    legs: [
      { target: 'TP1', closePercent: 30 },
      { target: 'TP3', closePercent: 70 },
    ],
    stopAfterFirstPartial: 'breakeven',
    runnerTrailsStructure: true,
  },
];

export function managementModelById(id: string): ManagementModel | null {
  return MANAGEMENT_MODELS.find((model) => model.id === id) ?? null;
}

export type ManagementEventType =
  | 'partial_close'
  | 'stop_moved'
  | 'target_moved'
  | 'full_close'
  | 'note';

export interface ManagementEvent {
  id: string;
  type: ManagementEventType;
  time: number;
  price: number | null;
  /** Percentage of the original position affected. */
  percent: number | null;
  /** New stop after a `stop_moved` event. */
  newStop: number | null;
  realisedPnl: number | null;
  note: string;
}

export interface LiveTradeInput {
  direction: Direction;
  entry: number;
  originalStop: number;
  currentStop: number;
  takeProfit1: number | null;
  takeProfit2: number | null;
  takeProfit3: number | null;
  originalLots: number;
  remainingLots: number;
  realisedPnl: number;
  currentPrice: number;
  instrument: InstrumentSpec;
}

export interface LiveTradeState {
  unrealisedPnl: number;
  totalPnl: number;
  currentR: number | null;
  distanceToStop: number;
  distanceToStopR: number | null;
  nextTarget: { label: string; price: number; distance: number; r: number } | null;
  remainingPercent: number;
  /** True when the stop is at or beyond the entry in the trade's favour. */
  riskFree: boolean;
  openRisk: number;
}

/** Live metrics for the trade-management panel. */
export function liveTradeState(input: LiveTradeInput): LiveTradeState {
  const risk = Math.abs(input.entry - input.originalStop);
  const perPrice = valuePerPricePerLot(input.instrument);

  const unrealisedPnl = profitFor(
    input.entry,
    input.currentPrice,
    input.remainingLots,
    input.direction,
    input.instrument,
  );

  const move =
    input.direction === 'long'
      ? input.currentPrice - input.entry
      : input.entry - input.currentPrice;

  const distanceToStop =
    input.direction === 'long'
      ? input.currentPrice - input.currentStop
      : input.currentStop - input.currentPrice;

  const targets: [string, number | null][] = [
    ['TP1', input.takeProfit1],
    ['TP2', input.takeProfit2],
    ['TP3', input.takeProfit3],
  ];

  const pending = targets
    .filter((entry): entry is [string, number] => entry[1] !== null)
    .filter(([, price]) =>
      input.direction === 'long' ? price > input.currentPrice : price < input.currentPrice,
    )
    .sort(([, a], [, b]) =>
      input.direction === 'long' ? a - b : b - a,
    );

  const next = pending[0];
  const riskFree =
    input.direction === 'long'
      ? input.currentStop >= input.entry
      : input.currentStop <= input.entry;

  return {
    unrealisedPnl,
    totalPnl: unrealisedPnl + input.realisedPnl,
    currentR: risk > 0 ? move / risk : null,
    distanceToStop,
    distanceToStopR: risk > 0 ? distanceToStop / risk : null,
    nextTarget: next
      ? {
          label: next[0],
          price: next[1],
          distance: Math.abs(next[1] - input.currentPrice),
          r: risk > 0 ? Math.abs(next[1] - input.entry) / risk : 0,
        }
      : null,
    remainingPercent:
      input.originalLots > 0 ? (input.remainingLots / input.originalLots) * 100 : 0,
    riskFree,
    openRisk: riskFree ? 0 : Math.abs(distanceToStop) * perPrice * input.remainingLots,
  };
}

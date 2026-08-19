import type {
  Bias,
  Candle,
  FvgZone,
  LiquidityLevel,
  StructureEvent,
  Timeframe,
} from '@xau/core';
import type { EconomicEvent } from '@xau/providers';

/**
 * Database rows <-> domain objects.
 *
 * The engines work in UTC epoch seconds; Postgres stores timestamps. All the
 * conversion lives here so no engine ever sees a Date and no route invents a
 * timezone.
 */

export const toEpoch = (date: Date | null | undefined): number =>
  date ? Math.floor(date.getTime() / 1000) : 0;

export const toEpochOrNull = (date: Date | null | undefined): number | null =>
  date ? Math.floor(date.getTime() / 1000) : null;

export const fromEpoch = (seconds: number): Date => new Date(seconds * 1000);

export interface CandleRow {
  time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export function rowsToCandles(rows: CandleRow[]): Candle[] {
  return rows.map((row) => ({
    time: toEpoch(row.time),
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
  }));
}

export interface LiquidityRow {
  id: string;
  type: string;
  side: string;
  price: number;
  timeframe: string;
  status: string;
  createdTime: Date;
  eventTime: Date | null;
  penetration: number | null;
  manual: boolean;
  label: string;
  notes: string;
}

export function rowToLiquidity(row: LiquidityRow): LiquidityLevel {
  return {
    id: row.id,
    type: row.type as LiquidityLevel['type'],
    side: row.side as LiquidityLevel['side'],
    price: row.price,
    timeframe: row.timeframe as Timeframe,
    status: row.status as LiquidityLevel['status'],
    createdTime: toEpoch(row.createdTime),
    eventTime: toEpochOrNull(row.eventTime),
    eventIndex: null,
    penetration: row.penetration,
    manual: row.manual,
    label: row.label,
    notes: row.notes,
  };
}

export interface FvgRow {
  id: string;
  direction: string;
  timeframe: string;
  high: number;
  low: number;
  midpoint: number;
  size: number;
  relativeSize: number | null;
  status: string;
  mitigation: number;
  createdTime: Date;
  firstTouchTime: Date | null;
  overlaps: string[];
}

export function rowToFvg(row: FvgRow): FvgZone {
  const createdTime = toEpoch(row.createdTime);
  return {
    id: row.id,
    direction: row.direction as FvgZone['direction'],
    timeframe: row.timeframe as Timeframe,
    createdIndex: 0,
    createdTime,
    sourceCandleTimes: [createdTime, createdTime, createdTime],
    high: row.high,
    low: row.low,
    midpoint: row.midpoint,
    size: row.size,
    relativeSize: row.relativeSize,
    status: row.status as FvgZone['status'],
    mitigation: row.mitigation,
    firstTouchIndex: null,
    firstTouchTime: toEpochOrNull(row.firstTouchTime),
    history: [{ index: 0, time: createdTime, status: row.status as FvgZone['status'], mitigation: row.mitigation }],
    overlaps: row.overlaps,
  };
}

export interface StructureRow {
  id: string;
  kind: string;
  direction: string;
  scope: string;
  timeframe: string;
  time: Date;
  brokenLevel: number;
  brokenSwingTime: Date;
  closePrice: number;
  review: string;
}

export function rowToStructure(row: StructureRow): StructureEvent {
  return {
    kind: row.kind as StructureEvent['kind'],
    direction: row.direction as StructureEvent['direction'],
    scope: row.scope as StructureEvent['scope'],
    index: 0,
    time: toEpoch(row.time),
    brokenLevel: row.brokenLevel,
    brokenSwingTime: toEpoch(row.brokenSwingTime),
    closePrice: row.closePrice,
    timeframe: row.timeframe as Timeframe,
    review: row.review as StructureEvent['review'],
  };
}

export interface EventRow {
  id: string;
  externalId: string | null;
  name: string;
  country: string;
  time: Date;
  importance: string;
  category: string | null;
  previous: number | null;
  forecast: number | null;
  actual: number | null;
  unit: string | null;
  surprise: number | null;
  source: string;
  pointInTime: boolean;
  reference: string | null;
}

export function rowToEvent(row: EventRow): EconomicEvent {
  return {
    id: row.externalId ?? row.id,
    name: row.name,
    country: row.country,
    time: toEpoch(row.time),
    importance: row.importance as EconomicEvent['importance'],
    category: row.category,
    previous: row.previous,
    forecast: row.forecast,
    actual: row.actual,
    unit: row.unit,
    surprise: row.surprise,
    source: row.source,
    pointInTime: row.pointInTime,
    reference: row.reference,
  };
}

export function isBias(value: unknown): value is Bias {
  return value === 'bullish' || value === 'bearish' || value === 'neutral' || value === 'transitional';
}

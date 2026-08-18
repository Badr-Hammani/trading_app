import type { Candle, Direction, InstrumentSpec, Timeframe } from '../types/market.js';
import { XAUUSD_DEFAULT_SPEC } from '../types/market.js';
import { detectSwings, SWING_PRESETS, type SwingPoint } from '../indicators/swings.js';
import { detectStructureEvents, type StructureEvent } from '../indicators/structure.js';
import { buildFvgZones, fvgStatusAt, type FvgZone } from '../indicators/fvg.js';
import { scanDisplacement, type DisplacementReading } from '../indicators/displacement.js';
import type { SessionDefinition } from '../sessions/types.js';
import { DEFAULT_SESSIONS } from '../sessions/types.js';
import { activeSessions, sessionLabelAt } from '../sessions/engine.js';
import { DEFAULT_STRATEGY_RULES, type StrategyRules } from '../strategy-engine/types.js';
import { ENTRY_MODELS, type EntryModelId } from '../strategy-engine/entryModels.js';
import { managementModelById, type ManagementModel } from '../journal/management.js';
import { profitFor, valuePerPricePerLot } from '../risk-engine/calculator.js';
import { weekdayInZone } from '../time/clock.js';
import { DateTime } from 'luxon';
import type { AnalyticsTrade } from '../analytics/types.js';
import type { CalendarEventLike } from '../strategy-engine/news.js';

/**
 * Backtest simulator.
 *
 * Deliberately mechanical: it exists to compare variants of ONE model under
 * identical assumptions, not to prove the model works. Its numbers are a
 * relative measurement between entry/management variants, and the app says so
 * wherever they are displayed.
 *
 * Lookahead safety:
 *  - swings become usable only `lookback` bars after the pivot;
 *  - structure and FVG state are read at the current index only;
 *  - a bar's own high/low resolves fills, and the stop is checked before the
 *    target when both fall inside the same bar (the pessimistic assumption).
 */

export interface BacktestConfig {
  candles: Candle[];
  timeframe: Timeframe;
  instrument: InstrumentSpec;
  sessions: SessionDefinition[];
  rules: StrategyRules;
  entryModel: EntryModelId;
  managementModelId: string;
  /** Account size used for currency results. */
  accountBalance: number;
  riskPercent: number;
  /** R multiples for TP1/TP2/TP3, so every variant is measured identically. */
  targetsR: [number, number, number];
  /** Stop is placed this fraction of the stop distance beyond the invalidation. */
  stopBufferAtr: number;
  timezone: string;
  /** Only take trades inside a permitted session. */
  enforceSessionFilter: boolean;
  /** Historical calendar events, as known at the time (point-in-time). */
  events?: CalendarEventLike[];
  newsWindowMinutes?: number;
  /** Bars to skip before trading, so indicators have history. */
  warmupBars?: number;
  strategyVersion?: string;
}

export interface BacktestFill {
  time: number;
  price: number;
  percent: number;
  reason: 'TP1' | 'TP2' | 'TP3' | 'R-target' | 'stop' | 'end-of-data' | 'trail';
  pnl: number;
}

export interface BacktestTrade {
  id: string;
  direction: Direction;
  entryTime: number;
  entryPrice: number;
  entryIndex: number;
  stopLoss: number;
  initialStop: number;
  takeProfits: [number, number, number];
  lots: number;
  exitTime: number | null;
  averageExit: number | null;
  fills: BacktestFill[];
  resultR: number;
  resultCurrency: number;
  maeR: number;
  mfeR: number;
  session: string;
  entryModel: EntryModelId;
  managementModel: string;
  fvgId: string | null;
  fvgTimeframe: Timeframe | null;
  liquidityContext: string | null;
  structureKind: 'BOS' | 'CHoCH' | null;
  displacementScore: number | null;
  newsPresent: boolean;
  dayOfWeek: number | null;
  hourOfDay: number | null;
  barsInTrade: number;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  /** Bars processed after the warmup. */
  barsProcessed: number;
  config: Omit<BacktestConfig, 'candles' | 'events'>;
  /** Setups that qualified technically but were skipped by a filter. */
  skipped: { time: number; reason: string }[];
}

export const DEFAULT_BACKTEST_TARGETS: [number, number, number] = [1, 2, 3];

interface OpenTrade extends BacktestTrade {
  remainingPercent: number;
  realised: number;
  riskDistance: number;
  firstPartialTaken: boolean;
}

export function runBacktest(config: BacktestConfig): BacktestResult {
  const {
    candles,
    timeframe,
    instrument,
    sessions,
    rules,
    entryModel: entryModelId,
    managementModelId,
  } = config;

  const model = ENTRY_MODELS[entryModelId];
  const management = managementModelById(managementModelId) ?? managementModelById('A')!;
  const warmup = config.warmupBars ?? 60;
  const perPrice = valuePerPricePerLot(instrument);

  const swingConfig = SWING_PRESETS[rules.sensitivity];
  const swings = detectSwings(candles, timeframe, swingConfig);
  const structureEvents = detectStructureEvents(candles, swings, timeframe);
  const fvgZones = buildFvgZones(candles, timeframe);
  const displacement = scanDisplacement(candles, timeframe, { structureEvents, fvgZones });

  const displacementByIndex = new Map<number, DisplacementReading>();
  for (const reading of displacement) displacementByIndex.set(reading.index, reading);

  const trades: BacktestTrade[] = [];
  const skipped: { time: number; reason: string }[] = [];
  let open: OpenTrade | null = null;
  let sequence = 0;

  for (let index = warmup; index < candles.length; index += 1) {
    const candle = candles[index];
    if (!candle) continue;

    if (open) {
      manageOpenTrade(open, candle, index, management, config, swings, perPrice);
      if (open.remainingPercent <= 0.0001) {
        finaliseTrade(open, instrument);
        trades.push(stripOpenFields(open));
        open = null;
      }
      // One position at a time: the comparison is between models, not between
      // position-stacking schemes.
      continue;
    }

    for (const direction of ['long', 'short'] as Direction[]) {
      const signal = findEntry({
        direction,
        index,
        candles,
        timeframe,
        swings,
        swingLookback: swingConfig.lookback,
        structureEvents,
        fvgZones,
        displacementByIndex,
        model: entryModelId,
        rules,
      });
      if (!signal) continue;

      const inSession = activeSessions(sessions, candle.time).some(
        (occurrence) => occurrence.definition.tradingPermitted,
      );
      if (config.enforceSessionFilter && !inSession) {
        skipped.push({ time: candle.time, reason: 'Outside a permitted execution window' });
        continue;
      }

      const riskDistance = Math.abs(signal.entryPrice - signal.stopLoss);
      if (riskDistance <= 0) continue;

      const riskAmount = (config.accountBalance * config.riskPercent) / 100;
      const rawLots = riskAmount / (riskDistance * perPrice);
      const lots = Math.max(
        0,
        Math.floor(rawLots / instrument.lotStep + 1e-9) * instrument.lotStep,
      );
      if (lots < instrument.minLot) {
        skipped.push({ time: candle.time, reason: 'Position size below the broker minimum' });
        continue;
      }

      const sign = direction === 'long' ? 1 : -1;
      const takeProfits: [number, number, number] = [
        signal.entryPrice + sign * riskDistance * config.targetsR[0],
        signal.entryPrice + sign * riskDistance * config.targetsR[1],
        signal.entryPrice + sign * riskDistance * config.targetsR[2],
      ];

      const local = DateTime.fromSeconds(candle.time, { zone: 'utc' }).setZone(config.timezone);
      sequence += 1;

      open = {
        id: `bt-${sequence}`,
        direction,
        entryTime: candle.time,
        entryPrice: signal.entryPrice,
        entryIndex: index,
        stopLoss: signal.stopLoss,
        initialStop: signal.stopLoss,
        takeProfits,
        lots,
        exitTime: null,
        averageExit: null,
        fills: [],
        resultR: 0,
        resultCurrency: 0,
        maeR: 0,
        mfeR: 0,
        session: sessionLabelAt(sessions, candle.time),
        entryModel: entryModelId,
        managementModel: management.id,
        fvgId: signal.fvgId,
        fvgTimeframe: timeframe,
        liquidityContext: signal.liquidityContext,
        structureKind: signal.structureKind,
        displacementScore: signal.displacementScore,
        newsPresent: hasNewsNearby(config, candle.time),
        dayOfWeek: weekdayInZone(candle.time, config.timezone),
        hourOfDay: local.hour,
        barsInTrade: 0,
        remainingPercent: 100,
        realised: 0,
        riskDistance,
        firstPartialTaken: false,
      };
      break;
    }
  }

  // Close anything still running at the end of the data, marked as such so it
  // is never mistaken for a target being hit.
  if (open) {
    const last = candles[candles.length - 1];
    if (last) {
      closePortion(open, last.close, open.remainingPercent, last.time, 'end-of-data', config.instrument);
      finaliseTrade(open, instrument);
      trades.push(stripOpenFields(open));
    }
  }

  const { candles: _candles, events: _events, ...configEcho } = config;

  return {
    trades,
    barsProcessed: Math.max(0, candles.length - warmup),
    config: configEcho,
    skipped,
  };
}

interface EntrySignal {
  entryPrice: number;
  stopLoss: number;
  fvgId: string | null;
  liquidityContext: string | null;
  structureKind: 'BOS' | 'CHoCH' | null;
  displacementScore: number | null;
}

function findEntry(args: {
  direction: Direction;
  index: number;
  candles: Candle[];
  timeframe: Timeframe;
  swings: SwingPoint[];
  swingLookback: number;
  structureEvents: StructureEvent[];
  fvgZones: FvgZone[];
  displacementByIndex: Map<number, DisplacementReading>;
  model: EntryModelId;
  rules: StrategyRules;
}): EntrySignal | null {
  const { direction, index, candles, rules } = args;
  const model = ENTRY_MODELS[args.model];
  const candle = candles[index];
  if (!candle) return null;

  const bullish = direction === 'long';
  const wanted = bullish ? 'bullish' : 'bearish';

  // Structure break inside the allowed lookback window.
  const breaks = args.structureEvents.filter(
    (event) =>
      event.direction === wanted &&
      event.index < index &&
      index - event.index <= rules.maxBarsFromStructureBreak,
  );
  const structureBreak = breaks[breaks.length - 1] ?? null;

  if (model.requiresStructureBreak && !structureBreak) return null;

  // A liquidity sweep before the break: the prior swing on the opposite side
  // must have been taken and reclaimed.
  const sweep = findRecentSweep(candles, args.swings, args.swingLookback, index, bullish, rules);
  if (!sweep) return null;

  // Displacement leading into the zone.
  const displacementWindowStart = structureBreak ? structureBreak.index : sweep.index;
  let bestDisplacement: DisplacementReading | null = null;
  for (let i = displacementWindowStart; i < index; i += 1) {
    const reading = args.displacementByIndex.get(i);
    if (!reading || reading.direction !== wanted) continue;
    if (!bestDisplacement || reading.score > bestDisplacement.score) bestDisplacement = reading;
  }
  if (!bestDisplacement || bestDisplacement.score < rules.minDisplacementScore) return null;

  // The execution FVG: created after the break (when required) and still live.
  const minCreated = model.requiresStructureBreak && structureBreak ? structureBreak.index : sweep.index;
  const zones = args.fvgZones
    .filter((zone) => zone.direction === wanted)
    .filter((zone) => zone.createdIndex >= minCreated && zone.createdIndex < index)
    .filter((zone) => {
      const state = fvgStatusAt(zone, index - 1);
      return state !== null && (state.status === 'fresh' || state.status === 'partially_mitigated');
    })
    .sort((a, b) => b.createdIndex - a.createdIndex);

  const zone = zones[0];
  if (!zone) return null;

  // The retracement: this bar must trade into the zone.
  const touched = candle.low <= zone.high && candle.high >= zone.low;
  if (!touched) return null;

  if (model.requiresSecondBreak) {
    const secondBreak = args.structureEvents.some(
      (event) =>
        event.direction === wanted &&
        structureBreak !== null &&
        event.index > structureBreak.index &&
        event.index <= index,
    );
    if (!secondBreak) return null;
  }

  let entryPrice: number;

  if (model.requiresReaction) {
    // Require the bar to react out of the zone in the trade's direction.
    const closedRight = bullish ? candle.close > candle.open : candle.close < candle.open;
    const closedOut = bullish ? candle.close > zone.high : candle.close < zone.low;
    const range = candle.high - candle.low;
    const wick = bullish ? candle.open - candle.low : candle.high - candle.open;
    const rejection = range > 0 && wick / range >= 0.4;
    if (!closedRight || (!closedOut && !rejection)) return null;
    entryPrice = candle.close;
  } else {
    // Model A: a limit at the proximal edge, filled the moment price arrives.
    entryPrice = bullish ? zone.high : zone.low;
  }

  // Stop at structural invalidation: beyond the zone and beyond the swing that
  // created the leg, whichever is further, plus a small buffer.
  const structuralSwing = bullish ? sweep.price : sweep.price;
  const invalidation = bullish
    ? Math.min(zone.low, structuralSwing)
    : Math.max(zone.high, structuralSwing);
  const buffer = Math.abs(entryPrice - invalidation) * 0.05;
  const stopLoss = bullish ? invalidation - buffer : invalidation + buffer;

  if (bullish ? stopLoss >= entryPrice : stopLoss <= entryPrice) return null;

  return {
    entryPrice,
    stopLoss,
    fvgId: zone.id,
    liquidityContext: sweep.label,
    structureKind: structureBreak?.kind ?? null,
    displacementScore: bestDisplacement.score,
  };
}

/**
 * Look for a swing on the opposite side that was pierced and then reclaimed
 * within the recent window — the sweep the model requires before displacement.
 */
function findRecentSweep(
  candles: Candle[],
  swings: SwingPoint[],
  swingLookback: number,
  index: number,
  bullish: boolean,
  rules: StrategyRules,
): { index: number; price: number; label: string } | null {
  const window = rules.maxBarsFromStructureBreak * 2;
  const type = bullish ? 'low' : 'high';

  const candidates = swings.filter(
    (swing) => swing.type === type && swing.index + swingLookback < index && index - swing.index <= window,
  );

  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const swing = candidates[i]!;
    const from = swing.index + swingLookback;
    for (let bar = from; bar < index; bar += 1) {
      const c = candles[bar];
      if (!c) continue;
      const pierced = bullish ? c.low < swing.price : c.high > swing.price;
      if (!pierced) continue;
      const reclaimed = bullish ? c.close > swing.price : c.close < swing.price;
      const laterReclaim =
        reclaimed ||
        candles
          .slice(bar + 1, Math.min(bar + 4, index + 1))
          .some((next) => (bullish ? next.close > swing.price : next.close < swing.price));
      if (laterReclaim) {
        return {
          index: bar,
          price: swing.price,
          label: bullish ? 'Sell-side swing low swept' : 'Buy-side swing high swept',
        };
      }
    }
  }
  return null;
}

function manageOpenTrade(
  trade: OpenTrade,
  candle: Candle,
  index: number,
  management: ManagementModel,
  config: BacktestConfig,
  swings: SwingPoint[],
  perPrice: number,
): void {
  trade.barsInTrade = index - trade.entryIndex;
  const bullish = trade.direction === 'long';

  // Excursions, in R.
  const favourable = bullish
    ? candle.high - trade.entryPrice
    : trade.entryPrice - candle.low;
  const adverse = bullish ? trade.entryPrice - candle.low : candle.high - trade.entryPrice;
  trade.mfeR = Math.max(trade.mfeR, favourable / trade.riskDistance);
  trade.maeR = Math.max(trade.maeR, adverse / trade.riskDistance);

  // Stop first: when a bar contains both the stop and a target, assume the
  // worse sequence. Optimism here is how backtests lie.
  const stopHit = bullish ? candle.low <= trade.stopLoss : candle.high >= trade.stopLoss;
  if (stopHit) {
    closePortion(trade, trade.stopLoss, trade.remainingPercent, candle.time, 'stop', config.instrument);
    return;
  }

  for (const leg of management.legs) {
    if (trade.remainingPercent <= 0.0001) break;

    const targetPrice = resolveLegPrice(trade, leg.target, leg.rMultiple);
    if (targetPrice === null) continue;

    const alreadyTaken = trade.fills.some((fill) => fill.reason === legReason(leg.target));
    if (alreadyTaken) continue;

    const hit = bullish ? candle.high >= targetPrice : candle.low <= targetPrice;
    if (!hit) continue;

    const percent = Math.min(leg.closePercent, trade.remainingPercent);
    closePortion(trade, targetPrice, percent, candle.time, legReason(leg.target), config.instrument);

    if (!trade.firstPartialTaken) {
      trade.firstPartialTaken = true;
      if (management.stopAfterFirstPartial === 'breakeven') {
        trade.stopLoss = trade.entryPrice;
      }
    }
  }

  // Structure trailing for the runner.
  if (management.runnerTrailsStructure && trade.firstPartialTaken) {
    const confirmed = swings.filter(
      (swing) => swing.type === (bullish ? 'low' : 'high') && swing.index < index - 2,
    );
    const last = confirmed[confirmed.length - 1];
    if (last) {
      const improved = bullish ? last.price > trade.stopLoss : last.price < trade.stopLoss;
      if (improved) trade.stopLoss = last.price;
    }
  }
}

function legReason(target: 'TP1' | 'TP2' | 'TP3' | 'R'): BacktestFill['reason'] {
  return target === 'R' ? 'R-target' : target;
}

function resolveLegPrice(
  trade: OpenTrade,
  target: 'TP1' | 'TP2' | 'TP3' | 'R',
  rMultiple?: number,
): number | null {
  if (target === 'R') {
    if (rMultiple === undefined) return null;
    const sign = trade.direction === 'long' ? 1 : -1;
    return trade.entryPrice + sign * trade.riskDistance * rMultiple;
  }
  const map = { TP1: 0, TP2: 1, TP3: 2 } as const;
  return trade.takeProfits[map[target]] ?? null;
}

function closePortion(
  trade: OpenTrade,
  price: number,
  percent: number,
  time: number,
  reason: BacktestFill['reason'],
  instrument: InstrumentSpec,
): void {
  const portionLots = trade.lots * (percent / 100);
  const pnl = profitFor(trade.entryPrice, price, portionLots, trade.direction, instrument);
  trade.fills.push({ time, price, percent, reason, pnl });
  trade.realised += pnl;
  trade.remainingPercent -= percent;
  trade.exitTime = time;
}

function finaliseTrade(trade: OpenTrade, instrument: InstrumentSpec): void {
  const totalPercent = trade.fills.reduce((sum, fill) => sum + fill.percent, 0);
  trade.averageExit =
    totalPercent > 0
      ? trade.fills.reduce((sum, fill) => sum + fill.price * fill.percent, 0) / totalPercent
      : null;

  trade.resultCurrency = trade.realised;

  // R is computed from the weighted exits so partials are reflected honestly.
  const weightedR = trade.fills.reduce((sum, fill) => {
    const move =
      trade.direction === 'long' ? fill.price - trade.entryPrice : trade.entryPrice - fill.price;
    return sum + (move / trade.riskDistance) * (fill.percent / 100);
  }, 0);
  trade.resultR = weightedR;
}

function stripOpenFields(trade: OpenTrade): BacktestTrade {
  const { remainingPercent, realised, riskDistance, firstPartialTaken, ...rest } = trade;
  return rest;
}

function hasNewsNearby(config: BacktestConfig, time: number): boolean {
  const events = config.events ?? [];
  const window = (config.newsWindowMinutes ?? 30) * 60;
  return events.some(
    (event) => event.importance === 'high' && Math.abs(event.time - time) <= window,
  );
}

/** Project simulated trades into the shared analytics shape. */
export function backtestTradesToAnalytics(trades: BacktestTrade[]): AnalyticsTrade[] {
  return trades.map((trade) => ({
    id: trade.id,
    openTime: trade.entryTime,
    closeTime: trade.exitTime,
    direction: trade.direction,
    session: trade.session,
    setupType: trade.structureKind ? `${trade.structureKind} continuation` : 'Model setup',
    entryModel: trade.entryModel,
    managementModel: trade.managementModel,
    liquidityType: trade.liquidityContext,
    fvgTimeframe: trade.fvgTimeframe,
    fvgQuality: null,
    grade: null,
    ruleViolation: false,
    resultR: trade.resultR,
    resultCurrency: trade.resultCurrency,
    maeR: -trade.maeR,
    mfeR: trade.mfeR,
    newsPresent: trade.newsPresent,
    riskPercent: null,
    dayOfWeek: trade.dayOfWeek,
    hourOfDay: trade.hourOfDay,
  }));
}

export const DEFAULT_BACKTEST_CONFIG: Omit<BacktestConfig, 'candles'> = {
  timeframe: '5M',
  instrument: XAUUSD_DEFAULT_SPEC,
  sessions: DEFAULT_SESSIONS,
  rules: DEFAULT_STRATEGY_RULES,
  entryModel: 'C',
  managementModelId: 'A',
  accountBalance: 10000,
  riskPercent: 0.5,
  targetsR: DEFAULT_BACKTEST_TARGETS,
  stopBufferAtr: 0.05,
  timezone: 'Africa/Casablanca',
  enforceSessionFilter: true,
  warmupBars: 60,
  strategyVersion: 'v1.0',
};

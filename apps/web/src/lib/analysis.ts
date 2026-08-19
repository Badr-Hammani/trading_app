import {
  buildFvgZones,
  buildNewsRisk,
  detectStructureEvents,
  detectSwings,
  derivePeriodLevels,
  deriveSessionLevels,
  deriveEqualLevels,
  evaluateLiquidity,
  evaluateSetup,
  labelSwings,
  scanDisplacement,
  sessionStatus,
  suggestBias,
  suggestChecklist,
  summariseChecklist,
  marketStatus,
  SWING_PRESETS,
  type Bias,
  type Candle,
  type Direction,
  type FvgZone,
  type LiquidityLevel,
  type SetupEvaluation,
  type StructureEvent,
  type Timeframe,
} from '@xau/core';
import type { EconomicEvent } from '@xau/providers';
import type { UserContext } from './context';

/**
 * The analysis pipeline.
 *
 * One place derives structure, FVGs, liquidity and displacement from candles,
 * so the dashboard, the setup builder, the Telegram bot and the AI mentor all
 * describe the same market rather than each computing their own version of it.
 */

export interface AnalysisInput {
  context: UserContext;
  candles: Candle[];
  timeframe: Timeframe;
  /** Reference instant. In replay this is the cursor bar, not wall-clock now. */
  at: number;
  /** Levels the trader marked by hand; merged with the derived ones. */
  manualLevels?: LiquidityLevel[];
  events?: EconomicEvent[];
  bias?: Partial<Record<Timeframe, Bias>>;
}

export interface AnalysisResult {
  candles: Candle[];
  swings: ReturnType<typeof labelSwings>;
  structureEvents: StructureEvent[];
  fvgZones: FvgZone[];
  displacement: ReturnType<typeof scanDisplacement>;
  liquidity: LiquidityLevel[];
  price: number;
  suggestedBias: { bias: Bias; rationale: string };
  session: ReturnType<typeof sessionStatus>;
  market: ReturnType<typeof marketStatus>;
  long: SetupEvaluation;
  short: SetupEvaluation;
}

export function analyse(input: AnalysisInput): AnalysisResult {
  const { context, candles, timeframe, at } = input;
  const last = candles[candles.length - 1];
  const price = last?.close ?? 0;

  const swingConfig = SWING_PRESETS[context.rules.sensitivity];
  const rawSwings = detectSwings(candles, timeframe, swingConfig);
  const swings = labelSwings(rawSwings);
  const structureEvents = detectStructureEvents(candles, rawSwings, timeframe);
  const fvgZones = buildFvgZones(candles, timeframe);
  const displacement = scanDisplacement(candles, timeframe, { structureEvents, fvgZones });

  // Derived levels plus the trader's own, then sweep classification over the
  // whole set so a manual level is treated exactly like a derived one.
  const derived: LiquidityLevel[] = [
    ...derivePeriodLevels(candles, timeframe, at, context.timezone),
    ...deriveSessionLevels(candles, timeframe, at, context.sessions),
    ...deriveEqualLevels(rawSwings, candles, timeframe),
  ];
  const liquidity = evaluateLiquidity([...derived, ...(input.manualLevels ?? [])], candles);

  const news = buildNewsRisk(input.events ?? [], at, {
    windowMinutes: context.rules.newsWindowMinutes,
    filterEnabled: context.rules.newsFilterEnabled,
  });

  const common = {
    at,
    price,
    bias: input.bias ?? {},
    candles,
    executionTimeframe: timeframe,
    liquidity,
    fvgZones,
    structureEvents,
    displacement,
    sessions: context.sessions,
    news,
    rules: context.rules,
    strategyVersion: context.strategyVersion,
    manualBlock: context.manualBlock,
  };

  return {
    candles,
    swings,
    structureEvents,
    fvgZones,
    displacement,
    liquidity,
    price,
    suggestedBias: suggestBias(structureEvents),
    session: sessionStatus(context.sessions, at),
    market: marketStatus(at),
    long: evaluateSetup({ ...common, direction: 'long' }),
    short: evaluateSetup({ ...common, direction: 'short' }),
  };
}

/**
 * Pick the side worth showing on the dashboard: whichever evaluation has
 * progressed further. When neither has begun, the long side is shown as the
 * neutral default rather than the app implying a direction.
 */
export function dominantSide(result: AnalysisResult): {
  direction: Direction;
  evaluation: SetupEvaluation;
} {
  const score = (evaluation: SetupEvaluation): number =>
    evaluation.stages.filter((stage) => stage.state === 'met').length;
  return score(result.short) > score(result.long)
    ? { direction: 'short', evaluation: result.short }
    : { direction: 'long', evaluation: result.long };
}

/** Checklist state pre-filled from an evaluation, plus its summary. */
export function checklistFromEvaluation(direction: Direction, evaluation: SetupEvaluation) {
  const state = suggestChecklist(direction, evaluation);
  return { state, summary: summariseChecklist(direction, state) };
}

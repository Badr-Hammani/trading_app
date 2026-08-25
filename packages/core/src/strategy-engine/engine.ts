import type { Bias, Candle, Direction, Timeframe } from '../types/market.js';
import type { LiquidityLevel } from '../indicators/liquidity.js';
import type { FvgZone } from '../indicators/fvg.js';
import { fvgStatusAt, scoreFvgQuality } from '../indicators/fvg.js';
import type { StructureEvent } from '../indicators/structure.js';
import type { DisplacementReading } from '../indicators/displacement.js';
import { atrAt, averageRange } from '../indicators/atr.js';
import type { SessionDefinition } from '../sessions/types.js';
import { activeSessions, sessionLabelAt } from '../sessions/engine.js';
import {
  DEFAULT_STRATEGY_RULES,
  SETUP_STAGES,
  STAGE_LABELS,
  type NewsRisk,
  type SetupEvaluation,
  type SetupStage,
  type StageResult,
  type StageState,
  type StrategyRules,
  type SetupStatus,
} from './types.js';

/**
 * StrategyEngine.
 *
 * Pure and UI-free: given market observations it returns a structured
 * evaluation. It reports what is present and what is missing. It never
 * decides to trade, and it never converts an FVG touch into a signal.
 */

export interface EvaluateSetupInput {
  /** Reference instant, epoch seconds. In replay this is the current bar. */
  at: number;
  direction: Direction;
  price: number;
  /** User-owned bias per timeframe. The engine reads it; it never writes it. */
  bias: Partial<Record<Timeframe, Bias>>;
  /** Execution-timeframe candles up to and including `at`. Nothing beyond. */
  candles: Candle[];
  executionTimeframe: Timeframe;
  liquidity: LiquidityLevel[];
  fvgZones: FvgZone[];
  structureEvents: StructureEvent[];
  displacement: DisplacementReading[];
  sessions: SessionDefinition[];
  news?: NewsRisk;
  rules?: StrategyRules;
  strategyVersion?: string;
  /** A manual block set by the user (e.g. "no trading today"). */
  manualBlock?: { active: boolean; reason: string };
}

const NO_NEWS: NewsRisk = {
  nextEventName: null,
  nextEventTime: null,
  minutesToEvent: null,
  impact: null,
  filterBlocks: false,
  eventNearby: false,
  message: 'No economic calendar data loaded.',
};

/** Calculate distance from current price to the FVG boundary in price units. */
export function calculateFvgDistance(price: number, zone: FvgZone, direction: Direction): number {
  if (direction === 'long') {
    if (price > zone.high) return price - zone.high;
    if (price < zone.low) return zone.low - price;
    return 0;
  } else {
    if (price < zone.low) return zone.low - price;
    if (price > zone.high) return price - zone.high;
    return 0;
  }
}

export function evaluateSetup(input: EvaluateSetupInput): SetupEvaluation {
  const rules = input.rules ?? DEFAULT_STRATEGY_RULES;
  const news = input.news ?? NO_NEWS;
  const bullish = input.direction === 'long';
  const currentIndex = input.candles.length - 1;
  const atr = (currentIndex >= 0
    ? atrAt(input.candles, currentIndex, 14) ?? averageRange(input.candles, currentIndex, 14)
    : null) ?? 1.0;

  const stages = {} as Record<SetupStage, StageResult>;
  for (const stage of SETUP_STAGES) {
    stages[stage] = {
      stage,
      label: STAGE_LABELS[stage],
      state: 'not_met' as StageState,
      evidence: [],
      missing: [],
      at: null,
    };
  }

  // ---------------------------------------------------------------- stage 1
  // HTF context and location. Bias is the user's; the engine only checks
  // whether the direction being considered agrees with it.
  const contextTimeframes: Timeframe[] = ['4H', '1H', '30M'];
  const wanted: Bias = bullish ? 'bullish' : 'bearish';
  const contextBias = contextTimeframes.map((tf) => ({ tf, bias: input.bias[tf] ?? 'neutral' }));
  const aligned = contextBias.filter((entry) => entry.bias === wanted);
  const opposed = contextBias.filter(
    (entry) => entry.bias === (bullish ? 'bearish' : 'bullish'),
  );

  const htfAligned = aligned.length >= 2 && opposed.length === 0;
  const locationLevel = nearestRelevantLocation(input, bullish);

  if (aligned.length === 0) {
    stages.htf_location.state = 'not_met';
    stages.htf_location.missing.push(`No higher-timeframe ${wanted} context set.`);
  } else {
    stages.htf_location.evidence.push(
      `${aligned.map((entry) => entry.tf).join(', ')} marked ${wanted}`,
    );
    if (opposed.length > 0) {
      stages.htf_location.missing.push(
        `${opposed.map((entry) => entry.tf).join(', ')} still marked ${opposed[0]!.bias}`,
      );
    }
    if (locationLevel) {
      stages.htf_location.evidence.push(
        `Price at ${locationLevel.label} (${locationLevel.price.toFixed(2)})`,
      );
    } else {
      stages.htf_location.missing.push('Price is not at a marked HTF location.');
    }
    stages.htf_location.state = htfAligned && locationLevel ? 'met' : 'partial';
    stages.htf_location.at = input.at;
  }

  // ---------------------------------------------------------------- stage 2
  // Liquidity event. A long needs sell-side liquidity taken; a short needs
  // buy-side taken. Only a level classified `swept` counts — a level merely
  // broken is continuation, not a sweep.
  const wantedSide = bullish ? 'sell-side' : 'buy-side';
  const sweeps = input.liquidity
    .filter((level) => level.side === wantedSide && level.status === 'swept' && level.eventTime !== null)
    .filter((level) => level.eventTime! <= input.at)
    .sort((a, b) => (b.eventTime ?? 0) - (a.eventTime ?? 0));
  const sweep = sweeps[0] ?? null;

  if (sweep) {
    stages.liquidity_event.state = 'met';
    stages.liquidity_event.at = sweep.eventTime;
    stages.liquidity_event.evidence.push(
      `${sweep.label} (${sweep.type}) at ${sweep.price.toFixed(2)} swept, price closed back through`,
    );
  } else {
    const pending = input.liquidity.filter(
      (level) => level.side === wantedSide && level.status === 'intact',
    );
    stages.liquidity_event.missing.push(
      pending.length > 0
        ? `${wantedSide} liquidity identified (${pending.length} level(s)) but not yet swept.`
        : `No ${wantedSide} liquidity marked.`,
    );
  }

  // ---------------------------------------------------------------- stage 3
  // Displacement, scored rather than assumed from candle colour.
  const displacementDirection = bullish ? 'bullish' : 'bearish';
  const afterSweep = sweep?.eventTime ?? 0;
  const displacements = input.displacement
    .filter((reading) => reading.direction === displacementDirection)
    .filter((reading) => reading.time <= input.at && reading.time >= afterSweep)
    .sort((a, b) => b.score - a.score);
  const bestDisplacement = displacements[0] ?? null;

  if (bestDisplacement && bestDisplacement.score >= rules.minDisplacementScore) {
    stages.displacement.state = 'met';
    stages.displacement.at = bestDisplacement.time;
    stages.displacement.evidence.push(
      `Displacement score ${bestDisplacement.score}/100`,
      ...bestDisplacement.reasons,
    );
  } else if (bestDisplacement) {
    stages.displacement.state = 'partial';
    stages.displacement.at = bestDisplacement.time;
    stages.displacement.evidence.push(`Best displacement score ${bestDisplacement.score}/100`);
    stages.displacement.missing.push(
      `Below the configured minimum of ${rules.minDisplacementScore}.`,
    );
  } else {
    stages.displacement.missing.push(`No ${displacementDirection} displacement since the sweep.`);
  }

  // ---------------------------------------------------------------- stage 4
  // Structure break on the execution timeframe, after the displacement.
  const structureAfter = Math.max(afterSweep, bestDisplacement?.time ?? 0);
  const breaks = input.structureEvents
    .filter((event) => event.direction === displacementDirection)
    .filter((event) => event.review !== 'rejected')
    .filter((event) => event.time <= input.at && event.time >= structureAfter)
    .sort((a, b) => b.time - a.time);
  let structureBreak = breaks.find((event) => !rules.requireChoch || event.kind === 'CHoCH') ?? null;

  let structureInvalidated = false;
  let structureInvalidationReason: string | null = null;

  if (structureBreak) {
    // Check 1: Setup age / expiration
    const barsSinceBreak = currentIndex - structureBreak.index;
    if (rules.maxBarsFromStructureBreak > 0 && barsSinceBreak > rules.maxBarsFromStructureBreak) {
      structureInvalidated = true;
      structureInvalidationReason = `Setup expired: ${barsSinceBreak} bars since structure break (max ${rules.maxBarsFromStructureBreak}).`;
    }

    // Check 2: Opposing structure break occurring AFTER the setup structure break
    if (!structureInvalidated && rules.invalidateOnOpposingStructure) {
      const opposingDirection = bullish ? 'bearish' : 'bullish';
      const opposingBreaks = input.structureEvents.filter(
        (event) =>
          event.direction === opposingDirection &&
          event.review !== 'rejected' &&
          event.time <= input.at &&
          event.time >= structureBreak!.time,
      );
      if (opposingBreaks.length > 0) {
        const latestOpposing = opposingBreaks.sort((a, b) => b.time - a.time)[0]!;
        structureInvalidated = true;
        structureInvalidationReason = `Invalidated by opposing ${latestOpposing.direction} ${latestOpposing.kind} at ${latestOpposing.brokenLevel.toFixed(2)}.`;
      }
    }

    // Check 3: Originating / protected swing invalidation
    if (!structureInvalidated && rules.requireOriginatingSwingIntact && sweep) {
      const preBreakCandles = input.candles.slice(0, structureBreak.index + 1);
      const legLow = preBreakCandles.length > 0 ? Math.min(...preBreakCandles.map((c) => c.low)) : sweep.price;
      const legHigh = preBreakCandles.length > 0 ? Math.max(...preBreakCandles.map((c) => c.high)) : sweep.price;
      const protectedExtreme = bullish
        ? Math.min(sweep.price - (sweep.penetration ?? 0), legLow)
        : Math.max(sweep.price + (sweep.penetration ?? 0), legHigh);

      const subsequentCandles = input.candles.slice(structureBreak.index + 1);
      const breached = subsequentCandles.some((c) =>
        bullish ? c.close < protectedExtreme || c.low < protectedExtreme - 0.5 : c.close > protectedExtreme || c.high > protectedExtreme + 0.5,
      );
      if (breached) {
        structureInvalidated = true;
        structureInvalidationReason = `Invalidated: price broke through protected ${bullish ? 'low' : 'high'} (${protectedExtreme.toFixed(2)}).`;
      }
    }
  }

  if (structureInvalidated) {
    stages.structure_break.state = 'not_met';
    stages.structure_break.missing.push(structureInvalidationReason!);
    structureBreak = null;
  } else if (structureBreak) {
    stages.structure_break.state = structureBreak.scope === 'major' ? 'met' : 'partial';
    stages.structure_break.at = structureBreak.time;
    stages.structure_break.evidence.push(
      `${structureBreak.scope} ${structureBreak.kind} through ${structureBreak.brokenLevel.toFixed(2)}`,
    );
    if (structureBreak.scope === 'internal') {
      stages.structure_break.missing.push('Break is internal structure only, not a major swing.');
      stages.structure_break.state = 'partial';
    } else {
      stages.structure_break.state = 'met';
    }
  } else if (breaks.length > 0) {
    stages.structure_break.state = 'partial';
    stages.structure_break.missing.push('A BOS printed but your rules require a CHoCH.');
  } else {
    stages.structure_break.missing.push('No meaningful structure break since displacement.');
  }

  // ---------------------------------------------------------------- stage 5
  // Fresh execution FVG. Formed by this rejection/displacement leg directly after the sweep.
  const fvgAfter = rules.requireFvgAfterStructure && structureBreak
    ? structureBreak.time
    : afterSweep;

  const candidateZones = structureInvalidated
    ? []
    : input.fvgZones
        .filter((zone) => zone.direction === displacementDirection)
        .filter((zone) => zone.createdTime <= input.at && zone.createdTime >= fvgAfter)
        .map((zone) => {
          const state = fvgStatusAt(zone, currentIndex);
          const ageBars = currentIndex - zone.createdIndex;
          const distance = calculateFvgDistance(input.price, zone, input.direction);
          const distanceAtr = atr > 0 ? distance / atr : 0;
          const displacementDistance = bestDisplacement
            ? Math.abs(zone.createdIndex - bestDisplacement.index)
            : 999;
          return {
            zone,
            state,
            ageBars,
            distance,
            distanceAtr,
            displacementDistance,
          };
        })
        .filter((entry) => {
          if (!entry.state) return false;
          if (entry.state.status !== 'fresh' && entry.state.status !== 'partially_mitigated') return false;
          if (entry.state.mitigation > rules.maxFvgMitigation) return false;
          // Age limit
          if (rules.maxFvgAgeBars > 0 && entry.ageBars > rules.maxFvgAgeBars) return false;
          // Distance limit in ATR
          if (rules.maxFvgDistanceAtr > 0 && entry.distanceAtr > rules.maxFvgDistanceAtr) return false;
          return true;
        })
        .sort((a, b) => {
          // Prefer FVG created immediately by displacement leg (smallest displacementDistance)
          const aClose = a.displacementDistance <= 2;
          const bClose = b.displacementDistance <= 2;
          if (aClose && !bClose) return -1;
          if (!aClose && bClose) return 1;
          if (aClose && bClose && a.displacementDistance !== b.displacementDistance) {
            return a.displacementDistance - b.displacementDistance;
          }
          // Tie-breaker: newest creation time
          return b.zone.createdTime - a.zone.createdTime;
        });

  const chosen = candidateZones[0] ?? null;
  let fvgQuality: number | null = null;

  if (chosen) {
    const quality = scoreFvgQuality(chosen.zone, {
      displacementScore: bestDisplacement?.score ?? null,
      createdByStructureBreak:
        structureBreak !== null &&
        Math.abs(chosen.zone.createdIndex - structureBreak.index) <= 2,
    });
    fvgQuality = quality.score;
    stages.execution_fvg.state = 'met';
    stages.execution_fvg.at = chosen.zone.createdTime;
    stages.execution_fvg.evidence.push(
      `${chosen.zone.timeframe} ${chosen.zone.direction} FVG ${chosen.zone.low.toFixed(2)}–${chosen.zone.high.toFixed(2)} (${chosen.state!.status}, quality ${quality.score}/100, dist ${chosen.distanceAtr.toFixed(1)} ATR)`,
      ...quality.reasons,
    );
  } else {
    stages.execution_fvg.missing.push(
      structureInvalidated
        ? 'No valid execution FVG (setup structure was invalidated or expired).'
        : rules.requireFvgAfterStructure
        ? 'No fresh, nearby FVG created after the structure break.'
        : 'No fresh, nearby FVG available in this leg.',
    );
  }

  // ---------------------------------------------------------------- stage 6
  // Retracement into the chosen FVG. Reaching the zone is the SETUP arriving
  // at its location — it is explicitly not the entry.
  let retracementDepth: number | null = null;
  let retracementAt: number | null = null;

  if (chosen) {
    const zone = chosen.zone;
    const inZone = input.price <= zone.high && input.price >= zone.low;
    retracementDepth = chosen.state?.mitigation ?? 0;

    if (inZone) {
      stages.retracement.state = 'met';
      retracementAt = input.at;
      stages.retracement.at = input.at;
      stages.retracement.evidence.push(
        `Price ${input.price.toFixed(2)} is inside the zone (${Math.round(retracementDepth * 100)}% mitigated)`,
      );
    } else if ((chosen.state?.mitigation ?? 0) > 0) {
      stages.retracement.state = 'partial';
      stages.retracement.at = chosen.state?.time ?? null;
      stages.retracement.evidence.push(
        `Zone tapped to ${Math.round((chosen.state?.mitigation ?? 0) * 100)}%, price has since left it`,
      );
      stages.retracement.missing.push('Price is not currently in the zone.');
    } else {
      stages.retracement.missing.push(
        `Price has not retraced into ${zone.low.toFixed(2)}–${zone.high.toFixed(2)} yet.`,
      );
    }
  } else {
    stages.retracement.missing.push('No execution FVG to retrace into.');
  }

  // ---------------------------------------------------------------- stage 7
  // Entry confirmation on the execution timeframe: a reaction inside the
  // zone, not merely price being there.
  if (stages.retracement.state === 'met' && chosen) {
    const reaction = reactionInZone(input.candles, chosen.zone, bullish);
    if (reaction) {
      stages.entry_confirmation.state = 'met';
      stages.entry_confirmation.at = reaction.time;
      stages.entry_confirmation.evidence.push(reaction.description);
    } else {
      stages.entry_confirmation.missing.push(
        'No lower-timeframe reaction from the zone yet (rejection wick, engulf, or micro structure shift).',
      );
    }
  } else {
    stages.entry_confirmation.missing.push('Waiting for the retracement to complete.');
  }

  // ------------------------------------------------------------- conditions
  const active = activeSessions(input.sessions, input.at);
  const sessionValid = active.some((occurrence) => occurrence.definition.tradingPermitted);
  const sessionName = sessionLabelAt(input.sessions, input.at);

  const orderedStages = SETUP_STAGES.map((stage) => stages[stage]);
  const technicalStages = orderedStages.filter((stage) => stage.stage !== 'entry_confirmation');
  const allTechnicalMet = technicalStages.every((stage) => stage.state === 'met');
  const entryMet = stages.entry_confirmation.state === 'met';

  const missingConditions = orderedStages
    .filter((stage) => stage.state !== 'met')
    .flatMap((stage) => (stage.missing.length > 0 ? stage.missing : [`${stage.label} not met`]));

  if (rules.enforceSessionFilter && !sessionValid) {
    missingConditions.push(`Outside a permitted execution window (currently ${sessionName}).`);
  }
  if (news.filterBlocks) {
    missingConditions.push(`News filter active: ${news.message}`);
  }
  if (input.manualBlock?.active) {
    missingConditions.push(`Manual block: ${input.manualBlock.reason || 'set by user'}`);
  }

  const setupStatus = deriveStatus({
    stagesMet: orderedStages.filter((stage) => stage.state === 'met').length,
    allTechnicalMet,
    entryMet,
    sessionValid: sessionValid || !rules.enforceSessionFilter,
    news,
    manualBlock: input.manualBlock?.active ?? false,
    hasInvalidation: structureInvalidated,
  });

  return {
    direction: input.direction,
    bias: Object.fromEntries(contextBias.map((entry) => [entry.tf, entry.bias])),
    htfAligned,
    stages: orderedStages,
    liquiditySweep: {
      detected: sweep !== null,
      levelId: sweep?.id ?? null,
      levelType: sweep?.type ?? null,
      price: sweep?.price ?? null,
      at: sweep?.eventTime ?? null,
    },
    displacement: {
      detected: stages.displacement.state === 'met',
      score: bestDisplacement?.score ?? null,
      at: bestDisplacement?.time ?? null,
      reasons: bestDisplacement?.reasons ?? [],
    },
    structureBreak: {
      detected: structureBreak !== null,
      kind: structureBreak?.kind ?? null,
      scope: structureBreak?.scope ?? null,
      at: structureBreak?.time ?? null,
      level: structureBreak?.brokenLevel ?? null,
    },
    fvg: {
      detected: chosen !== null,
      id: chosen?.zone.id ?? null,
      high: chosen?.zone.high ?? null,
      low: chosen?.zone.low ?? null,
      midpoint: chosen?.zone.midpoint ?? null,
      status: chosen?.state?.status ?? null,
      quality: fvgQuality,
      timeframe: chosen?.zone.timeframe ?? null,
    },
    retracement: {
      detected: stages.retracement.state === 'met',
      at: retracementAt,
      depth: retracementDepth,
    },
    sessionValid,
    sessionName,
    newsRisk: news,
    setupStatus,
    missingConditions,
    summary: summarise(setupStatus, orderedStages, sessionName, news),
    evaluatedAt: input.at,
    strategyVersion: input.strategyVersion ?? 'v1.0',
  };
}

function deriveStatus(args: {
  stagesMet: number;
  allTechnicalMet: boolean;
  entryMet: boolean;
  sessionValid: boolean;
  news: NewsRisk;
  manualBlock: boolean;
  hasInvalidation?: boolean;
}): SetupStatus {
  if (args.manualBlock) return 'blocked';
  if (args.news.filterBlocks) return 'blocked';
  if (args.hasInvalidation) return 'no_setup';
  if (args.stagesMet === 0) return 'no_setup';
  if (!args.allTechnicalMet) return 'forming';
  if (!args.sessionValid) return 'valid_out_of_session';
  if (!args.entryMet) return 'forming';
  if (args.news.eventNearby) return 'caution';
  return 'qualified';
}

function summarise(
  status: SetupStatus,
  stages: StageResult[],
  sessionName: string,
  news: NewsRisk,
): string {
  const met = stages.filter((stage) => stage.state === 'met').length;
  const base = `${met}/${stages.length} stages met · ${sessionName}`;
  switch (status) {
    case 'qualified':
      return `SETUP QUALIFIED — ${base}. Every mandatory condition is satisfied; the decision to execute is yours.`;
    case 'caution':
      return `CAUTION — ${base}. ${news.message}`;
    case 'valid_out_of_session':
      return `VALID SETUP, NO EXECUTION WINDOW — ${base}. Log it as a missed setup rather than forcing it.`;
    case 'blocked':
      return `EXECUTION BLOCKED — ${base}.`;
    case 'forming':
      return `SETUP FORMING — ${base}. Waiting for confirmation.`;
    default:
      return `NO SETUP — ${base}.`;
  }
}

/** Nearest marked level price is currently reacting from, on the relevant side. */
function nearestRelevantLocation(
  input: EvaluateSetupInput,
  bullish: boolean,
): LiquidityLevel | null {
  const tolerance = Math.max(input.price * 0.001, 0.5);
  const candidates = input.liquidity.filter(
    (level) => Math.abs(level.price - input.price) <= tolerance,
  );
  if (candidates.length === 0) return null;
  const preferred = candidates.filter((level) =>
    bullish ? level.side === 'sell-side' : level.side === 'buy-side',
  );
  const pool = preferred.length > 0 ? preferred : candidates;
  return pool.reduce((closest, level) =>
    Math.abs(level.price - input.price) < Math.abs(closest.price - input.price) ? level : closest,
  );
}

/** Look for a genuine reaction on the last few bars inside the zone. */
function reactionInZone(
  candles: Candle[],
  zone: FvgZone,
  bullish: boolean,
): { time: number; description: string } | null {
  const window = candles.slice(-3);
  for (let i = window.length - 1; i >= 0; i -= 1) {
    const candle = window[i]!;
    const touched = candle.low <= zone.high && candle.high >= zone.low;
    if (!touched) continue;

    const range = candle.high - candle.low;
    if (range <= 0) continue;
    const body = Math.abs(candle.close - candle.open);
    const closedRight = bullish ? candle.close > candle.open : candle.close < candle.open;
    const wick = bullish ? candle.open - candle.low : candle.high - candle.open;

    if (closedRight && wick / range >= 0.4) {
      return {
        time: candle.time,
        description: `Rejection wick from the zone (${Math.round((wick / range) * 100)}% of range) closing ${bullish ? 'up' : 'down'}`,
      };
    }
    if (closedRight && body / range >= 0.6) {
      return {
        time: candle.time,
        description: `Decisive ${bullish ? 'bullish' : 'bearish'} close from the zone (body ${Math.round((body / range) * 100)}% of range)`,
      };
    }
  }
  return null;
}

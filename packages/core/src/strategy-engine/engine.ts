import type { Bias, Candle, Direction, Timeframe } from '../types/market.js';
import type { LiquidityLevel } from '../indicators/liquidity.js';
import type { FvgZone } from '../indicators/fvg.js';
import { fvgStatusAt, scoreFvgQuality } from '../indicators/fvg.js';
import type { StructureEvent } from '../indicators/structure.js';
import type { DisplacementReading } from '../indicators/displacement.js';
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

export function evaluateSetup(input: EvaluateSetupInput): SetupEvaluation {
  const rules = input.rules ?? DEFAULT_STRATEGY_RULES;
  const news = input.news ?? NO_NEWS;
  const bullish = input.direction === 'long';
  const currentIndex = input.candles.length - 1;

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
  const structureBreak = breaks.find((event) => !rules.requireChoch || event.kind === 'CHoCH') ?? null;

  if (structureBreak) {
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
  // Fresh execution FVG. Must be a LOCATION formed by this leg, not any gap
  // that happens to sit nearby.
  const fvgAfter = rules.requireFvgAfterStructure
    ? (structureBreak?.time ?? structureAfter)
    : structureAfter;

  const candidateZones = input.fvgZones
    .filter((zone) => zone.direction === displacementDirection)
    .filter((zone) => zone.createdTime <= input.at && zone.createdTime >= fvgAfter)
    .map((zone) => ({ zone, state: fvgStatusAt(zone, currentIndex) }))
    .filter(
      (entry) =>
        entry.state !== null &&
        (entry.state.status === 'fresh' || entry.state.status === 'partially_mitigated') &&
        entry.state.mitigation <= rules.maxFvgMitigation,
    )
    .sort((a, b) => b.zone.createdTime - a.zone.createdTime);

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
      `${chosen.zone.timeframe} ${chosen.zone.direction} FVG ${chosen.zone.low.toFixed(2)}–${chosen.zone.high.toFixed(2)} (${chosen.state!.status}, quality ${quality.score}/100)`,
      ...quality.reasons,
    );
  } else {
    stages.execution_fvg.missing.push(
      rules.requireFvgAfterStructure
        ? 'No fresh FVG created after the structure break.'
        : 'No fresh FVG available in this leg.',
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
}): SetupStatus {
  if (args.manualBlock) return 'blocked';
  if (args.news.filterBlocks) return 'blocked';
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

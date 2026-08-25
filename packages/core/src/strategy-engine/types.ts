import type { Bias, Direction, Timeframe } from '../types/market.js';
import type { Sensitivity } from '../indicators/swings.js';

/**
 * The seven stages of the trading model.
 *
 * They are modelled as distinct stages on purpose. Collapsing them — most
 * obviously into "price touched an FVG, therefore trade" — is the failure mode
 * the whole application is built to prevent.
 */
export const SETUP_STAGES = [
  'htf_location',
  'liquidity_event',
  'displacement',
  'structure_break',
  'execution_fvg',
  'retracement',
  'entry_confirmation',
] as const;

export type SetupStage = (typeof SETUP_STAGES)[number];

export const STAGE_LABELS: Record<SetupStage, string> = {
  htf_location: 'HTF location',
  liquidity_event: 'Liquidity event',
  displacement: 'Displacement',
  structure_break: 'Structure break (CHoCH / BOS)',
  execution_fvg: 'Fresh execution FVG',
  retracement: 'Retracement into FVG',
  entry_confirmation: 'Entry confirmation',
};

export type StageState = 'met' | 'partial' | 'not_met' | 'unknown';

export interface StageResult {
  stage: SetupStage;
  label: string;
  state: StageState;
  /** What the engine actually observed. Never an interpretation. */
  evidence: string[];
  /** What is still required before the stage can be met. */
  missing: string[];
  /** Time of the observation that satisfied the stage, when there is one. */
  at: number | null;
}

export type SetupStatus =
  /** Nothing in the model has begun. */
  | 'no_setup'
  /** Some stages met, sequence incomplete. */
  | 'forming'
  /** All technical stages met, but the session does not permit execution. */
  | 'valid_out_of_session'
  /** All technical stages met, session valid, but something warrants caution. */
  | 'caution'
  /** All mandatory conditions satisfied. Still requires a human decision. */
  | 'qualified'
  /** A manual block or a hard rule prevents execution. */
  | 'blocked';

export interface NewsRisk {
  /** Highest-impact event inside the lookahead window, if any. */
  nextEventName: string | null;
  nextEventTime: number | null;
  minutesToEvent: number | null;
  impact: 'high' | 'medium' | 'low' | null;
  /** True when the user's news filter is switched on AND an event is inside the window. */
  filterBlocks: boolean;
  /** True when an event is inside the window regardless of the filter setting. */
  eventNearby: boolean;
  message: string;
}

export interface StrategyRules {
  /** Minimum displacement score before the displacement stage is considered met. */
  minDisplacementScore: number;
  /** Require the structure break to be a CHoCH rather than any BOS. */
  requireChoch: boolean;
  /** Require the execution FVG to have formed after the structure break. */
  requireFvgAfterStructure: boolean;
  /** Require the FVG to still be fresh or only shallowly mitigated. */
  maxFvgMitigation: number;
  /** Structure sensitivity preset. */
  sensitivity: Sensitivity;
  /** Only mark execution-ready inside a permitted session. */
  enforceSessionFilter: boolean;
  /** Block when a high-impact event falls inside the window below. */
  newsFilterEnabled: boolean;
  newsWindowMinutes: number;
  /** Ceiling for a single trade. */
  maxRiskPercent: number;
  /** Bars after the structure break within which the entry must occur. */
  maxBarsFromStructureBreak: number;
  /** Maximum distance between current price and FVG, as a multiple of ATR. Default 3.0. */
  maxFvgDistanceAtr: number;
  /** Maximum age of FVG in bars since creation. Default 30. */
  maxFvgAgeBars: number;
  /** Invalidate setup if an opposing structure event (BOS/CHoCH) occurs after the setup break. Default true. */
  invalidateOnOpposingStructure: boolean;
  /** Invalidate setup if the originating/protected swing is broken. Default true. */
  requireOriginatingSwingIntact: boolean;
}

export const DEFAULT_STRATEGY_RULES: StrategyRules = {
  minDisplacementScore: 60,
  requireChoch: false,
  requireFvgAfterStructure: false,
  maxFvgMitigation: 0.9,
  sensitivity: 'balanced',
  enforceSessionFilter: true,
  newsFilterEnabled: false,
  newsWindowMinutes: 30,
  maxRiskPercent: 1,
  maxBarsFromStructureBreak: 24,
  maxFvgDistanceAtr: 3.0,
  maxFvgAgeBars: 30,
  invalidateOnOpposingStructure: true,
  requireOriginatingSwingIntact: true,
};

export interface StrategyVersion {
  version: string;
  name: string;
  rules: StrategyRules;
  createdAt: number;
  notes: string;
}

/**
 * Structured output of the engine. The UI renders this; it never re-derives
 * trading logic of its own.
 */
export interface SetupEvaluation {
  direction: Direction;
  bias: Record<string, Bias>;
  htfAligned: boolean;
  stages: StageResult[];
  liquiditySweep: {
    detected: boolean;
    levelId: string | null;
    levelType: string | null;
    price: number | null;
    at: number | null;
  };
  displacement: { detected: boolean; score: number | null; at: number | null; reasons: string[] };
  structureBreak: {
    detected: boolean;
    kind: 'BOS' | 'CHoCH' | null;
    scope: 'major' | 'internal' | null;
    at: number | null;
    level: number | null;
  };
  fvg: {
    detected: boolean;
    id: string | null;
    high: number | null;
    low: number | null;
    midpoint: number | null;
    status: string | null;
    quality: number | null;
    timeframe: Timeframe | null;
  };
  retracement: { detected: boolean; at: number | null; depth: number | null };
  sessionValid: boolean;
  sessionName: string;
  newsRisk: NewsRisk;
  setupStatus: SetupStatus;
  missingConditions: string[];
  /** Plain-language summary for the header strip and the Telegram bot. */
  summary: string;
  evaluatedAt: number;
  strategyVersion: string;
}

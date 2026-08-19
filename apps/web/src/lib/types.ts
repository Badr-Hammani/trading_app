import type {
  Bias,
  Candle,
  FvgZone,
  LiquidityLevel,
  SetupEvaluation,
  SessionStatus,
  StructureEvent,
  Timeframe,
  DisplacementReading,
  LabelledSwing,
} from '@xau/core';
import type { DataResult, Quote } from '@xau/core';

/** Shapes returned by the API routes, shared by the pages that consume them. */

export interface AnalysisResponse {
  dataAvailable: boolean;
  candles?: DataResult<unknown>;
  timezone: string;
  symbol?: string;
  timeframe?: Timeframe;
  at?: number;
  price?: number;
  meta?: { provider: string; sourceTimestamp: number | null; receivedAt: number };
  bias?: Partial<Record<Timeframe, Bias>>;
  suggestedBias?: { bias: Bias; rationale: string };
  biasSuggestionEnabled?: boolean;
  session?: SessionStatus;
  market?: 'open' | 'closed' | 'weekend';
  liquidity?: LiquidityLevel[];
  fvgZones?: (FvgZone & { quality?: number })[];
  structureEvents?: StructureEvent[];
  swings?: LabelledSwing[];
  displacement?: DisplacementReading[];
  long?: SetupEvaluation;
  short?: SetupEvaluation;
  dominant?: {
    direction: 'long' | 'short';
    checklist: { state: Record<string, boolean>; summary: ChecklistSummaryShape };
  };
  strategyVersion?: string;
}

export interface ChecklistSummaryShape {
  total: number;
  mandatoryTotal: number;
  checked: number;
  mandatoryChecked: number;
  qualified: boolean;
  missing: string[];
  completionPercent: number;
}

export interface QuoteResponse {
  symbol: string;
  timezone: string;
  at: number;
  quote: DataResult<Quote>;
  change: { absolute: number; percent: number } | null;
  session: SessionStatus;
  market: 'open' | 'closed' | 'weekend';
  manualBlock: { active: boolean; reason: string };
  provider: { id: string; name: string; configured: boolean; setupHint?: string };
}

export interface CandlesResponse {
  result: DataResult<{ meta: { provider: string; timeframe: Timeframe }; candles: Candle[] }>;
  quality: {
    bars: number;
    gaps: number;
    gapDetail: { after: number; before: number; missingBars: number }[];
    newestBarTime: number | null;
    ageSeconds: number | null;
  } | null;
}

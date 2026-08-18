import type { Direction } from '../types/market.js';
import type { SetupEvaluation } from './types.js';

/**
 * The setup builder checklist.
 *
 * Mandatory items must be ticked before a setup is marked QUALIFIED. Ticking
 * them never places a trade — it records that the trader believes the
 * conditions are present, which is what the journal later grades.
 */

export type ChecklistGroup = 'HTF CONTEXT' | 'LIQUIDITY' | 'CONFIRMATION' | 'ENTRY' | 'RISK';

export interface ChecklistItem {
  id: string;
  group: ChecklistGroup;
  label: string;
  mandatory: boolean;
  /** Which engine field can pre-tick this item, when the engine can see it. */
  derivedFrom?: keyof SetupEvaluation | 'stage' | null;
  hint?: string;
}

export interface ChecklistState {
  [itemId: string]: boolean;
}

function items(direction: Direction): ChecklistItem[] {
  const long = direction === 'long';
  const side = long ? 'bullish' : 'bearish';
  const liquiditySide = long ? 'Sell-side' : 'Buy-side';

  return [
    { id: 'htf_4h', group: 'HTF CONTEXT', label: `4H ${side}`, mandatory: true, derivedFrom: 'bias' },
    { id: 'htf_1h', group: 'HTF CONTEXT', label: `1H ${side}`, mandatory: true, derivedFrom: 'bias' },
    {
      id: 'htf_location',
      group: 'HTF CONTEXT',
      label: 'Price at a valid HTF location',
      mandatory: true,
      derivedFrom: 'stage',
      hint: 'Support/resistance, HTF FVG, or a marked liquidity pool — not just "somewhere in the range".',
    },

    {
      id: 'liq_identified',
      group: 'LIQUIDITY',
      label: `${liquiditySide} liquidity identified`,
      mandatory: true,
      derivedFrom: 'stage',
    },
    { id: 'liq_swept', group: 'LIQUIDITY', label: 'Liquidity swept', mandatory: true, derivedFrom: 'liquiditySweep' },

    {
      id: 'conf_displacement',
      group: 'CONFIRMATION',
      label: `${long ? 'Bullish' : 'Bearish'} displacement`,
      mandatory: true,
      derivedFrom: 'displacement',
    },
    {
      id: 'conf_structure',
      group: 'CONFIRMATION',
      label: 'Meaningful structure break',
      mandatory: true,
      derivedFrom: 'structureBreak',
      hint: 'CHoCH or BOS on a swing that matters — not a one-candle high.',
    },
    {
      id: 'conf_fvg',
      group: 'CONFIRMATION',
      label: `Fresh ${side} FVG`,
      mandatory: true,
      derivedFrom: 'fvg',
      hint: 'The FVG is the location for the entry. It is not the reason for the entry.',
    },

    { id: 'entry_retrace', group: 'ENTRY', label: 'Retracement into FVG', mandatory: true, derivedFrom: 'retracement' },
    { id: 'entry_reaction', group: 'ENTRY', label: 'LTF reaction', mandatory: true, derivedFrom: 'stage' },
    { id: 'entry_session', group: 'ENTRY', label: 'Session valid', mandatory: true, derivedFrom: 'sessionValid' },
    { id: 'entry_news', group: 'ENTRY', label: 'News conditions acceptable', mandatory: true, derivedFrom: 'newsRisk' },

    {
      id: 'risk_stop',
      group: 'RISK',
      label: 'Stop at structural invalidation',
      mandatory: true,
      hint: 'The point where the idea is wrong — not a round number or a fixed pip count.',
    },
    { id: 'risk_size', group: 'RISK', label: 'Position size calculated', mandatory: true },
    { id: 'risk_max', group: 'RISK', label: 'Risk within configured maximum', mandatory: true },

    { id: 'opt_confluence', group: 'CONFIRMATION', label: 'Additional confluence noted', mandatory: false },
    { id: 'opt_target', group: 'ENTRY', label: 'Targets sit at real liquidity', mandatory: false },
  ];
}

export function checklistFor(direction: Direction): ChecklistItem[] {
  return items(direction);
}

export const CHECKLIST_GROUPS: ChecklistGroup[] = [
  'HTF CONTEXT',
  'LIQUIDITY',
  'CONFIRMATION',
  'ENTRY',
  'RISK',
];

/**
 * Pre-tick the items the engine can actually verify. Everything else stays
 * unticked: the trader confirms it, so the journal records a human judgement
 * rather than a machine assumption.
 */
export function suggestChecklist(
  direction: Direction,
  evaluation: SetupEvaluation,
): ChecklistState {
  const stageState = (stage: string): boolean =>
    evaluation.stages.find((entry) => entry.stage === stage)?.state === 'met';

  const state: ChecklistState = {};
  for (const item of checklistFor(direction)) state[item.id] = false;

  const wanted = direction === 'long' ? 'bullish' : 'bearish';
  state.htf_4h = evaluation.bias['4H'] === wanted;
  state.htf_1h = evaluation.bias['1H'] === wanted;
  state.htf_location = stageState('htf_location');
  state.liq_identified = stageState('liquidity_event') || evaluation.liquiditySweep.detected;
  state.liq_swept = evaluation.liquiditySweep.detected;
  state.conf_displacement = evaluation.displacement.detected;
  state.conf_structure = evaluation.structureBreak.detected;
  state.conf_fvg = evaluation.fvg.detected;
  state.entry_retrace = evaluation.retracement.detected;
  state.entry_reaction = stageState('entry_confirmation');
  state.entry_session = evaluation.sessionValid;
  state.entry_news = !evaluation.newsRisk.filterBlocks && !evaluation.newsRisk.eventNearby;

  return state;
}

export interface ChecklistSummary {
  total: number;
  mandatoryTotal: number;
  checked: number;
  mandatoryChecked: number;
  qualified: boolean;
  missing: string[];
  completionPercent: number;
}

export function summariseChecklist(
  direction: Direction,
  state: ChecklistState,
): ChecklistSummary {
  const all = checklistFor(direction);
  const mandatory = all.filter((item) => item.mandatory);
  const checked = all.filter((item) => state[item.id]).length;
  const mandatoryChecked = mandatory.filter((item) => state[item.id]).length;
  const missing = mandatory.filter((item) => !state[item.id]).map((item) => item.label);

  return {
    total: all.length,
    mandatoryTotal: mandatory.length,
    checked,
    mandatoryChecked,
    qualified: missing.length === 0,
    missing,
    completionPercent: mandatory.length > 0 ? (mandatoryChecked / mandatory.length) * 100 : 0,
  };
}

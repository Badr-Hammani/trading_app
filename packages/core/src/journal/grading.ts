import type { ChecklistSummary } from '../strategy-engine/checklist.js';

/**
 * Trade grading.
 *
 * Grades measure PROCESS, never outcome. A losing A+ is a good trade; a
 * winning RULE BREAK is a bad trade. Nothing in this module reads P/L, and
 * that is the point.
 */

export const TRADE_GRADES = ['A+', 'A', 'B', 'C', 'RULE_BREAK'] as const;
export type TradeGrade = (typeof TRADE_GRADES)[number];

export const GRADE_DESCRIPTIONS: Record<TradeGrade, string> = {
  'A+': 'Every condition aligned. Executed exactly as planned.',
  A: 'Minor imperfection — a slightly late entry or an imperfect location.',
  B: 'Valid setup but not ideal. Some conditions were weak.',
  C: 'Weak or discretionary. Taken on partial evidence.',
  RULE_BREAK: 'The trade violated the plan, regardless of how it finished.',
};

export interface GradeInput {
  checklist: ChecklistSummary;
  /** Explicit rule violations recorded by the trader. */
  ruleViolations: string[];
  /** Was the trade taken inside a permitted session? */
  sessionValid: boolean;
  /** Was risk within the configured maximum? */
  riskWithinLimit: boolean;
  /** Did the trader wait for the confirmation the model requires? */
  confirmationTaken: boolean;
  /** High-impact news inside the window at entry. */
  newsPresent: boolean;
  /** Whether the news filter was switched on at the time. */
  newsFilterEnabled: boolean;
}

export interface GradeSuggestion {
  grade: TradeGrade;
  reasons: string[];
  /** Fraction of the trader's own rules the trade respected, 0…1. */
  adherence: number;
}

/**
 * Suggest a grade. The trader always has the final say — this only makes the
 * honest answer the easy one to record.
 */
export function suggestGrade(input: GradeInput): GradeSuggestion {
  const reasons: string[] = [];
  const hardBreaks: string[] = [];

  if (input.ruleViolations.length > 0) {
    hardBreaks.push(`Recorded rule violation: ${input.ruleViolations.join('; ')}`);
  }
  if (!input.sessionValid) {
    hardBreaks.push('Executed outside a permitted session window.');
  }
  if (!input.riskWithinLimit) {
    hardBreaks.push('Risk exceeded the configured maximum.');
  }
  if (input.newsPresent && input.newsFilterEnabled) {
    hardBreaks.push('Traded through a high-impact event while the news filter was on.');
  }

  const checklistFactor =
    input.checklist.mandatoryTotal > 0
      ? input.checklist.mandatoryChecked / input.checklist.mandatoryTotal
      : 0;

  const penalties = hardBreaks.length;
  const adherence = Math.max(0, checklistFactor - penalties * 0.25);

  if (hardBreaks.length > 0) {
    return { grade: 'RULE_BREAK', reasons: hardBreaks, adherence };
  }

  if (input.checklist.qualified && input.confirmationTaken && !input.newsPresent) {
    reasons.push('All mandatory conditions met, confirmation taken, no event risk at entry.');
    return { grade: 'A+', reasons, adherence };
  }

  if (input.checklist.qualified && input.confirmationTaken) {
    reasons.push('All mandatory conditions met; a high-impact event was nearby.');
    return { grade: 'A', reasons, adherence };
  }

  if (checklistFactor >= 0.8) {
    reasons.push(
      `${input.checklist.mandatoryChecked}/${input.checklist.mandatoryTotal} mandatory conditions met.`,
      ...input.checklist.missing.map((item) => `Missing: ${item}`),
    );
    return { grade: 'B', reasons, adherence };
  }

  reasons.push(
    `Only ${input.checklist.mandatoryChecked}/${input.checklist.mandatoryTotal} mandatory conditions met.`,
    ...input.checklist.missing.map((item) => `Missing: ${item}`),
  );
  return { grade: 'C', reasons, adherence };
}

/**
 * Process quality vs outcome.
 *
 * Surfaces the two combinations traders learn the wrong lesson from: the
 * good trade that lost, and the bad trade that won.
 */
export function processVsOutcome(
  grade: TradeGrade,
  resultR: number | null,
): { label: string; tone: 'good' | 'bad' | 'neutral'; note: string } {
  if (resultR === null) return { label: 'Open', tone: 'neutral', note: 'Trade is still running.' };

  const goodProcess = grade === 'A+' || grade === 'A';
  const won = resultR > 0;

  if (goodProcess && !won) {
    return {
      label: 'Good process, losing outcome',
      tone: 'good',
      note: 'This is the cost of doing business. Repeat this trade.',
    };
  }
  if (!goodProcess && won) {
    return {
      label: 'Poor process, winning outcome',
      tone: 'bad',
      note: 'The result flattered the decision. Do not repeat this trade.',
    };
  }
  if (goodProcess && won) {
    return { label: 'Good process, winning outcome', tone: 'good', note: 'Executed as planned.' };
  }
  return {
    label: 'Poor process, losing outcome',
    tone: 'bad',
    note: 'Both the decision and the result were wrong. The decision is the part to fix.',
  };
}

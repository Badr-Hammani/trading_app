import type { AnalyticsTrade } from '../analytics/types.js';
import { computeStatistics, groupStatistics } from '../analytics/statistics.js';
import type { Statistics } from '../analytics/types.js';

/**
 * Weekly review.
 *
 * At most three recommendations. A review that lists fifteen things to fix
 * changes nothing; the constraint is the feature.
 */

export interface MissedSetup {
  id: string;
  time: number;
  direction: string;
  reason: string;
  session: string;
  /** R the setup would have produced, when the trader recorded it. */
  hypotheticalR: number | null;
}

export interface WeeklyReview {
  weekStart: number;
  weekEnd: number;
  statistics: Statistics;
  bestSetup: { label: string; expectancyR: number | null } | null;
  worstSetup: { label: string; expectancyR: number | null } | null;
  bestSession: { label: string; expectancyR: number | null } | null;
  worstSession: { label: string; expectancyR: number | null } | null;
  ruleAdherencePercent: number | null;
  ruleBreaks: number;
  missedSetups: number;
  missedVsTaken: {
    takenExpectancyR: number | null;
    missedExpectancyR: number | null;
    verdict: string;
  };
  recommendations: string[];
  biggestMistake: string | null;
  bestDecision: string | null;
}

export interface WeeklyReviewInput {
  weekStart: number;
  weekEnd: number;
  trades: AnalyticsTrade[];
  missed: MissedSetup[];
  /** Free-text notes the trader logged during the week. */
  mistakes: string[];
  goodDecisions: string[];
}

export function buildWeeklyReview(input: WeeklyReviewInput): WeeklyReview {
  const trades = input.trades.filter(
    (trade) => trade.openTime >= input.weekStart && trade.openTime <= input.weekEnd,
  );
  const statistics = computeStatistics(trades);

  const bySetup = groupStatistics(trades, (trade) => trade.setupType);
  const bySession = groupStatistics(trades, (trade) => trade.session || 'Unknown');

  const ruleBreaks = trades.filter(
    (trade) => trade.grade === 'RULE_BREAK' || trade.ruleViolation,
  ).length;

  const missedWithR = input.missed.filter((setup) => setup.hypotheticalR !== null);
  const missedExpectancy =
    missedWithR.length > 0
      ? missedWithR.reduce((sum, setup) => sum + (setup.hypotheticalR ?? 0), 0) / missedWithR.length
      : null;

  const takenExpectancy = statistics.expectancyR;

  let verdict: string;
  if (missedExpectancy === null || missedWithR.length < 5) {
    verdict = `Not enough logged missed setups (${missedWithR.length} with an outcome) to judge whether the filters are helping.`;
  } else if (takenExpectancy === null) {
    verdict = 'No closed trades this week to compare against.';
  } else if (missedExpectancy > takenExpectancy + 0.2) {
    verdict = `The setups skipped averaged ${missedExpectancy.toFixed(2)}R vs ${takenExpectancy.toFixed(2)}R taken — the filters may be costing more than they save. Worth reviewing which reason dominates.`;
  } else if (missedExpectancy < takenExpectancy - 0.2) {
    verdict = `Skipped setups averaged ${missedExpectancy.toFixed(2)}R vs ${takenExpectancy.toFixed(2)}R taken — the filters are earning their place.`;
  } else {
    verdict = `Taken and missed setups performed similarly (${takenExpectancy.toFixed(2)}R vs ${missedExpectancy.toFixed(2)}R).`;
  }

  return {
    weekStart: input.weekStart,
    weekEnd: input.weekEnd,
    statistics,
    bestSetup: toEntry(bySetup[0]),
    worstSetup: toEntry(bySetup[bySetup.length - 1]),
    bestSession: toEntry(bySession[0]),
    worstSession: toEntry(bySession[bySession.length - 1]),
    ruleAdherencePercent: statistics.ruleAdherencePercent,
    ruleBreaks,
    missedSetups: input.missed.length,
    missedVsTaken: {
      takenExpectancyR: takenExpectancy,
      missedExpectancyR: missedExpectancy,
      verdict,
    },
    recommendations: buildRecommendations({ statistics, ruleBreaks, trades, missed: input.missed }),
    biggestMistake: mostCommon(input.mistakes),
    bestDecision: input.goodDecisions[0] ?? null,
  };
}

function toEntry(
  group: { label: string; statistics: Statistics } | undefined,
): { label: string; expectancyR: number | null } | null {
  if (!group) return null;
  return { label: group.label, expectancyR: group.statistics.expectancyR };
}

/**
 * Ranked candidate recommendations, trimmed to three. Ordering is by how much
 * the issue is likely costing, not by how easy it is to say.
 */
function buildRecommendations(args: {
  statistics: Statistics;
  ruleBreaks: number;
  trades: AnalyticsTrade[];
  missed: MissedSetup[];
}): string[] {
  const { statistics, ruleBreaks, trades, missed } = args;
  const candidates: { weight: number; text: string }[] = [];

  if (trades.length === 0) {
    return [
      'No trades were closed this week. If that was the plan, the discipline held. If it was not, review what stopped you executing.',
    ];
  }

  if (ruleBreaks > 0) {
    candidates.push({
      weight: 100 + ruleBreaks * 10,
      text: `${ruleBreaks} rule break${ruleBreaks === 1 ? '' : 's'} this week. Before anything else, work out which rule and why — process errors compound faster than bad setups.`,
    });
  }

  if (statistics.maxConsecutiveLosses >= 4) {
    candidates.push({
      weight: 70,
      text: `${statistics.maxConsecutiveLosses} losses in a row. Check whether you kept size constant through the streak or increased it to make it back.`,
    });
  }

  const bySession = groupStatistics(trades, (trade) => trade.session || 'Unknown');
  const worstSession = bySession[bySession.length - 1];
  if (worstSession && (worstSession.statistics.expectancyR ?? 0) < -0.2 && worstSession.statistics.trades >= 3) {
    candidates.push({
      weight: 60,
      text: `${worstSession.label} is running at ${worstSession.statistics.expectancyR?.toFixed(2)}R over ${worstSession.statistics.trades} trades. Consider tracking it separately before trading it again.`,
    });
  }

  const outsideSession = missed.filter((setup) => setup.reason === 'Outside session').length;
  if (outsideSession >= 3) {
    candidates.push({
      weight: 40,
      text: `${outsideSession} valid setups fell outside your execution window. That is the session filter working — check in the Missed Trades tab whether they would actually have paid.`,
    });
  }

  if ((statistics.averageLossR ?? 0) < -1.2) {
    candidates.push({
      weight: 80,
      text: `Average loss is ${statistics.averageLossR?.toFixed(2)}R, beyond the 1R the plan assumes. Look for stops being moved or entries taken late.`,
    });
  }

  if ((statistics.winRate ?? 0) > 55 && (statistics.expectancyR ?? 0) < 0.1) {
    candidates.push({
      weight: 65,
      text: `Win rate is ${statistics.winRate?.toFixed(0)}% but expectancy is only ${statistics.expectancyR?.toFixed(2)}R. Winners are being cut short relative to losers — compare management models in the Strategy Lab.`,
    });
  }

  if (candidates.length === 0) {
    candidates.push({
      weight: 1,
      text: 'Nothing stands out as broken this week. Keep the sample growing before changing anything.',
    });
  }

  return candidates
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((candidate) => candidate.text);
}

function mostCommon(values: string[]): string | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (key === '') continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const original = values.find((value) => value.trim().toLowerCase() === best![0]);
  return original ?? best![0];
}

export const MISSED_TRADE_REASONS = [
  'Outside session',
  'Missed entry',
  'Too fast',
  'News',
  'Below confidence threshold',
  'Manual decision',
] as const;

export type MissedTradeReason = (typeof MISSED_TRADE_REASONS)[number];

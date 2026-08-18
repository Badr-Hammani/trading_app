import type { AnalyticsTrade, GroupedStatistics, Statistics } from './types.js';

/**
 * Performance statistics.
 *
 * Breakevens are counted separately rather than folded into wins or losses:
 * a management model that produces many breakevens looks very different from
 * one that produces many small losses, and the Strategy Lab needs to see that.
 */

const BREAKEVEN_EPSILON = 0.05; // |R| below this counts as a breakeven.

export const EMPTY_STATISTICS: Statistics = {
  trades: 0,
  wins: 0,
  losses: 0,
  breakevens: 0,
  winRate: null,
  averageWinR: null,
  averageLossR: null,
  averageWinCurrency: null,
  averageLossCurrency: null,
  expectancyR: null,
  expectancyCurrency: null,
  profitFactor: null,
  totalR: 0,
  totalCurrency: 0,
  averageR: null,
  medianR: null,
  standardDeviationR: null,
  sharpeLike: null,
  maxDrawdownR: 0,
  maxDrawdownCurrency: 0,
  maxConsecutiveWins: 0,
  maxConsecutiveLosses: 0,
  largestWinR: null,
  largestLossR: null,
  averageMaeR: null,
  averageMfeR: null,
  ruleAdherencePercent: null,
  equityCurveR: [],
  equityCurveCurrency: [],
};

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function standardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const average = mean(values)!;
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function maxDrawdown(series: number[]): number {
  let peak = 0;
  let worst = 0;
  let cumulative = 0;
  for (const value of series) {
    cumulative += value;
    if (cumulative > peak) peak = cumulative;
    const drawdown = peak - cumulative;
    if (drawdown > worst) worst = drawdown;
  }
  return worst;
}

export function computeStatistics(input: AnalyticsTrade[]): Statistics {
  const closed = input
    .filter((trade) => trade.resultR !== null)
    .sort((a, b) => (a.closeTime ?? a.openTime) - (b.closeTime ?? b.openTime));

  if (closed.length === 0) return { ...EMPTY_STATISTICS };

  const rValues = closed.map((trade) => trade.resultR!);
  const currencyValues = closed.map((trade) => trade.resultCurrency ?? 0);

  const wins = closed.filter((trade) => trade.resultR! > BREAKEVEN_EPSILON);
  const losses = closed.filter((trade) => trade.resultR! < -BREAKEVEN_EPSILON);
  const breakevens = closed.length - wins.length - losses.length;

  const grossProfit = wins.reduce((sum, trade) => sum + trade.resultR!, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.resultR!, 0));

  let consecutiveWins = 0;
  let consecutiveLosses = 0;
  let maxWins = 0;
  let maxLosses = 0;
  for (const trade of closed) {
    if (trade.resultR! > BREAKEVEN_EPSILON) {
      consecutiveWins += 1;
      consecutiveLosses = 0;
    } else if (trade.resultR! < -BREAKEVEN_EPSILON) {
      consecutiveLosses += 1;
      consecutiveWins = 0;
    } else {
      consecutiveWins = 0;
      consecutiveLosses = 0;
    }
    maxWins = Math.max(maxWins, consecutiveWins);
    maxLosses = Math.max(maxLosses, consecutiveLosses);
  }

  const equityCurveR: number[] = [];
  const equityCurveCurrency: number[] = [];
  let runningR = 0;
  let runningCurrency = 0;
  for (let i = 0; i < closed.length; i += 1) {
    runningR += rValues[i] ?? 0;
    runningCurrency += currencyValues[i] ?? 0;
    equityCurveR.push(runningR);
    equityCurveCurrency.push(runningCurrency);
  }

  const averageR = mean(rValues);
  const deviation = standardDeviation(rValues);

  const graded = closed.filter((trade) => trade.grade !== null);
  const adherent = graded.filter((trade) => trade.grade !== 'RULE_BREAK' && !trade.ruleViolation);

  const maeValues = closed.map((t) => t.maeR).filter((v): v is number => v !== null);
  const mfeValues = closed.map((t) => t.mfeR).filter((v): v is number => v !== null);

  return {
    trades: closed.length,
    wins: wins.length,
    losses: losses.length,
    breakevens,
    winRate: (wins.length / closed.length) * 100,
    averageWinR: mean(wins.map((t) => t.resultR!)),
    averageLossR: mean(losses.map((t) => t.resultR!)),
    averageWinCurrency: mean(wins.map((t) => t.resultCurrency ?? 0)),
    averageLossCurrency: mean(losses.map((t) => t.resultCurrency ?? 0)),
    expectancyR: averageR,
    expectancyCurrency: mean(currencyValues),
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : null,
    totalR: runningR,
    totalCurrency: runningCurrency,
    averageR,
    medianR: median(rValues),
    standardDeviationR: deviation,
    sharpeLike: deviation && deviation > 0 && averageR !== null ? averageR / deviation : null,
    maxDrawdownR: maxDrawdown(rValues),
    maxDrawdownCurrency: maxDrawdown(currencyValues),
    maxConsecutiveWins: maxWins,
    maxConsecutiveLosses: maxLosses,
    largestWinR: wins.length > 0 ? Math.max(...wins.map((t) => t.resultR!)) : null,
    largestLossR: losses.length > 0 ? Math.min(...losses.map((t) => t.resultR!)) : null,
    averageMaeR: mean(maeValues),
    averageMfeR: mean(mfeValues),
    ruleAdherencePercent: graded.length > 0 ? (adherent.length / graded.length) * 100 : null,
    equityCurveR,
    equityCurveCurrency,
  };
}

/** Split trades by a key function and compute statistics for each bucket. */
export function groupStatistics(
  trades: AnalyticsTrade[],
  keyFn: (trade: AnalyticsTrade) => string | null,
  labelFn?: (key: string) => string,
): GroupedStatistics[] {
  const buckets = new Map<string, AnalyticsTrade[]>();
  for (const trade of trades) {
    const key = keyFn(trade);
    if (key === null) continue;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(trade);
    else buckets.set(key, [trade]);
  }

  return [...buckets.entries()]
    .map(([key, group]) => ({
      key,
      label: labelFn ? labelFn(key) : key,
      statistics: computeStatistics(group),
    }))
    .sort((a, b) => (b.statistics.expectancyR ?? -Infinity) - (a.statistics.expectancyR ?? -Infinity));
}

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** The standard breakdowns the analytics dashboard renders. */
export function standardBreakdowns(trades: AnalyticsTrade[]): Record<string, GroupedStatistics[]> {
  return {
    session: groupStatistics(trades, (trade) => trade.session || 'Unknown'),
    direction: groupStatistics(trades, (trade) => trade.direction),
    setupType: groupStatistics(trades, (trade) => trade.setupType),
    entryModel: groupStatistics(trades, (trade) => trade.entryModel),
    managementModel: groupStatistics(trades, (trade) => trade.managementModel),
    liquidityType: groupStatistics(trades, (trade) => trade.liquidityType),
    fvgTimeframe: groupStatistics(trades, (trade) => trade.fvgTimeframe),
    grade: groupStatistics(trades, (trade) => trade.grade),
    news: groupStatistics(
      trades,
      (trade) => (trade.newsPresent ? 'news' : 'no-news'),
      (key) => (key === 'news' ? 'High-impact news within window' : 'No major news'),
    ),
    dayOfWeek: groupStatistics(
      trades,
      (trade) => (trade.dayOfWeek === null ? null : String(trade.dayOfWeek)),
      (key) => WEEKDAY_NAMES[Number(key) - 1] ?? key,
    ),
  };
}

/**
 * News impact analysis (spec §22).
 *
 * Returns null until there is enough data to say anything, rather than
 * reporting a win rate computed from three trades as though it meant something.
 */
export function newsImpactAnalysis(
  trades: AnalyticsTrade[],
  minimumSample = 10,
): {
  withNews: Statistics;
  withoutNews: Statistics;
  sampleSufficient: boolean;
  verdict: string;
} {
  const withNews = computeStatistics(trades.filter((trade) => trade.newsPresent));
  const withoutNews = computeStatistics(trades.filter((trade) => !trade.newsPresent));
  const sampleSufficient = withNews.trades >= minimumSample && withoutNews.trades >= minimumSample;

  let verdict: string;
  if (!sampleSufficient) {
    verdict = `Not enough data yet — ${withNews.trades} trades with news and ${withoutNews.trades} without. At least ${minimumSample} of each is needed before drawing a conclusion.`;
  } else {
    const delta = (withNews.expectancyR ?? 0) - (withoutNews.expectancyR ?? 0);
    verdict =
      Math.abs(delta) < 0.1
        ? `No meaningful difference so far (${delta.toFixed(2)}R). The news filter is not earning its cost.`
        : delta > 0
          ? `Trades near news currently outperform by ${delta.toFixed(2)}R per trade.`
          : `Trades near news currently underperform by ${Math.abs(delta).toFixed(2)}R per trade.`;
  }

  return { withNews, withoutNews, sampleSufficient, verdict };
}

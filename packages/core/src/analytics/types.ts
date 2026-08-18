import type { Direction } from '../types/market.js';
import type { TradeGrade } from '../journal/grading.js';

/**
 * The normalised shape statistics are computed from. Journal trades and
 * backtest trades both project into it, so live and simulated results are
 * always compared on identical arithmetic.
 */
export interface AnalyticsTrade {
  id: string;
  openTime: number;
  closeTime: number | null;
  direction: Direction;
  session: string;
  setupType: string | null;
  entryModel: string | null;
  managementModel: string | null;
  liquidityType: string | null;
  fvgTimeframe: string | null;
  fvgQuality: number | null;
  grade: TradeGrade | null;
  ruleViolation: boolean;
  /** Realised result in R. Null while the trade is open. */
  resultR: number | null;
  /** Realised result in account currency. */
  resultCurrency: number | null;
  /** Maximum adverse / favourable excursion, in R. */
  maeR: number | null;
  mfeR: number | null;
  newsPresent: boolean;
  riskPercent: number | null;
  /** ISO weekday in the user's timezone, 1 = Monday. */
  dayOfWeek: number | null;
  /** Local hour of the entry, for time-of-day analysis. */
  hourOfDay: number | null;
}

export interface Statistics {
  trades: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number | null;
  averageWinR: number | null;
  averageLossR: number | null;
  averageWinCurrency: number | null;
  averageLossCurrency: number | null;
  /** Expected R per trade. */
  expectancyR: number | null;
  expectancyCurrency: number | null;
  profitFactor: number | null;
  totalR: number;
  totalCurrency: number;
  averageR: number | null;
  medianR: number | null;
  standardDeviationR: number | null;
  /** Mean R divided by the standard deviation of R. Not an annualised Sharpe. */
  sharpeLike: number | null;
  maxDrawdownR: number;
  maxDrawdownCurrency: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  largestWinR: number | null;
  largestLossR: number | null;
  averageMaeR: number | null;
  averageMfeR: number | null;
  ruleAdherencePercent: number | null;
  /** Cumulative R after each closed trade, for the equity curve. */
  equityCurveR: number[];
  equityCurveCurrency: number[];
}

export interface GroupedStatistics<K extends string = string> {
  key: K;
  label: string;
  statistics: Statistics;
}

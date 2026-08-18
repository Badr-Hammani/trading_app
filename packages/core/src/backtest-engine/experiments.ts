import type { Candle } from '../types/market.js';
import { computeStatistics } from '../analytics/statistics.js';
import type { Statistics } from '../analytics/types.js';
import { ENTRY_MODELS, ENTRY_MODEL_IDS, type EntryModelId } from '../strategy-engine/entryModels.js';
import { MANAGEMENT_MODELS } from '../journal/management.js';
import {
  backtestTradesToAnalytics,
  runBacktest,
  type BacktestConfig,
  type BacktestTrade,
} from './simulator.js';

/**
 * Strategy Lab.
 *
 * Runs the same candles through every variant of the model so the question
 * "does waiting for the second break actually pay?" gets an answer from data
 * rather than from memory of the last few trades.
 */

export interface ExperimentCell {
  entryModel: EntryModelId;
  entryModelName: string;
  managementModel: string;
  managementModelName: string;
  statistics: Statistics;
  tradeCount: number;
  /** Fraction of runners that survived past the first partial. */
  runnerSurvivalRate: number | null;
  skippedCount: number;
}

export interface ExperimentMatrix {
  cells: ExperimentCell[];
  bestByExpectancy: ExperimentCell | null;
  bestByProfitFactor: ExperimentCell | null;
  lowestDrawdown: ExperimentCell | null;
  /** Sample-size caveat shown alongside every conclusion. */
  caveat: string;
}

export interface ExperimentOptions {
  candles: Candle[];
  base: Omit<BacktestConfig, 'candles' | 'entryModel' | 'managementModelId'>;
  entryModels?: EntryModelId[];
  managementModels?: string[];
  /** Below this many trades a cell is reported but excluded from "best". */
  minimumTradesForRanking?: number;
}

export function runExperimentMatrix(options: ExperimentOptions): ExperimentMatrix {
  const entryModels = options.entryModels ?? ENTRY_MODEL_IDS;
  const managementModels =
    options.managementModels ?? MANAGEMENT_MODELS.filter((m) => ['A', 'B', 'C', 'D'].includes(m.id)).map((m) => m.id);
  const minimum = options.minimumTradesForRanking ?? 20;

  const cells: ExperimentCell[] = [];

  for (const entryModel of entryModels) {
    for (const managementModel of managementModels) {
      const result = runBacktest({
        ...options.base,
        candles: options.candles,
        entryModel,
        managementModelId: managementModel,
      });

      const statistics = computeStatistics(backtestTradesToAnalytics(result.trades));
      const managementName =
        MANAGEMENT_MODELS.find((m) => m.id === managementModel)?.name ?? managementModel;

      cells.push({
        entryModel,
        entryModelName: ENTRY_MODELS[entryModel].name,
        managementModel,
        managementModelName: managementName,
        statistics,
        tradeCount: result.trades.length,
        runnerSurvivalRate: runnerSurvival(result.trades),
        skippedCount: result.skipped.length,
      });
    }
  }

  const rankable = cells.filter((cell) => cell.tradeCount >= minimum);
  const pool = rankable.length > 0 ? rankable : cells;

  const bestByExpectancy = pick(pool, (cell) => cell.statistics.expectancyR ?? -Infinity);
  const bestByProfitFactor = pick(pool, (cell) =>
    Number.isFinite(cell.statistics.profitFactor ?? NaN) ? cell.statistics.profitFactor! : -Infinity,
  );
  const lowestDrawdown = pick(pool, (cell) => -cell.statistics.maxDrawdownR);

  const caveat =
    rankable.length === 0
      ? `No variant reached ${minimum} trades. These numbers describe this sample only and should not be treated as an edge.`
      : `Ranking uses the ${rankable.length} of ${cells.length} variants with at least ${minimum} trades. Backtested results are not a guarantee of future performance.`;

  return { cells, bestByExpectancy, bestByProfitFactor, lowestDrawdown, caveat };
}

function pick(cells: ExperimentCell[], score: (cell: ExperimentCell) => number): ExperimentCell | null {
  if (cells.length === 0) return null;
  return cells.reduce((best, cell) => (score(cell) > score(best) ? cell : best));
}

/**
 * Runner survival: of the trades that took a first partial, how many had their
 * remainder exit at a target rather than at the stop or breakeven.
 */
function runnerSurvival(trades: BacktestTrade[]): number | null {
  const withPartials = trades.filter((trade) => trade.fills.length > 1);
  if (withPartials.length === 0) return null;
  const survived = withPartials.filter((trade) => {
    const last = trade.fills[trade.fills.length - 1];
    return last !== undefined && last.reason !== 'stop' && last.reason !== 'end-of-data';
  });
  return (survived.length / withPartials.length) * 100;
}

import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { apiError, handleRouteError, searchString } from '@/lib/api';
import { loadUserContext } from '@/lib/context';
import { candlesToCsv, computeStatistics, standardBreakdowns, toCsv } from '@xau/core';
import { rowsToCandles } from '@/lib/serialize';
import { tradeRowsToAnalytics } from '@/lib/analyticsMap';
import { DateTime } from 'luxon';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

type Dataset = 'trades' | 'journal' | 'statistics' | 'backtest' | 'events' | 'candles' | 'missed';

/**
 * Export.
 *
 * CSV for spreadsheets (Excel opens it directly) and JSON for anything that
 * needs the nested detail. The data belongs to the trader; nothing here is
 * locked in.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const context = await loadUserContext(user.id);
    const url = new URL(request.url);
    const dataset = (searchString(url, 'dataset', 'trades') ?? 'trades') as Dataset;
    const format = searchString(url, 'format', 'csv') ?? 'csv';
    const runId = url.searchParams.get('runId');

    const stamp = DateTime.utc().toFormat('yyyyLLdd-HHmm');
    const filename = `xau-${dataset}-${stamp}.${format === 'json' ? 'json' : 'csv'}`;

    const respond = (payload: unknown, csv: string): Response =>
      format === 'json'
        ? new Response(JSON.stringify(payload, null, 2), {
            headers: {
              'Content-Type': 'application/json',
              'Content-Disposition': `attachment; filename="${filename}"`,
            },
          })
        : new Response(csv, {
            headers: {
              // Excel needs the BOM to read UTF-8 correctly.
              'Content-Type': 'text/csv; charset=utf-8',
              'Content-Disposition': `attachment; filename="${filename}"`,
            },
          });

    switch (dataset) {
      case 'trades': {
        const trades = await prisma.trade.findMany({
          where: { userId: user.id },
          orderBy: { openedAt: 'asc' },
          include: { journalEntry: true, executions: true },
        });

        const rows = trades.map((trade) => ({
          id: trade.id,
          date: DateTime.fromJSDate(trade.openedAt).setZone(context.timezone).toFormat('yyyy-LL-dd'),
          time: DateTime.fromJSDate(trade.openedAt).setZone(context.timezone).toFormat('HH:mm'),
          session: trade.session,
          instrument: trade.symbol,
          direction: trade.direction,
          status: trade.status,
          htfBias: trade.htfBias,
          setupType: trade.setupType ?? '',
          liquidityType: trade.liquidityType ?? '',
          fvgTimeframe: trade.fvgTimeframe ?? '',
          fvgQuality: trade.fvgQuality ?? '',
          sweep: trade.sweepPresent ? 'yes' : 'no',
          displacementScore: trade.displacementScore ?? '',
          structure: trade.structureKind ?? '',
          entry: trade.entry,
          stopLoss: trade.initialStop,
          takeProfit1: trade.takeProfit1 ?? '',
          takeProfit2: trade.takeProfit2 ?? '',
          takeProfit3: trade.takeProfit3 ?? '',
          riskPercent: trade.riskPercent,
          lotSize: trade.lotSize,
          resultCurrency: trade.resultCurrency ?? '',
          resultR: trade.resultR ?? '',
          maeR: trade.maeR ?? '',
          mfeR: trade.mfeR ?? '',
          newsPresent: trade.newsPresent ? 'yes' : 'no',
          entryModel: trade.entryModel ?? '',
          managementModel: trade.managementModel,
          grade: trade.grade ?? '',
          ruleViolation: trade.ruleViolation ? 'yes' : 'no',
          emotion: trade.journalEntry?.emotion ?? '',
          mistake: trade.journalEntry?.mistake ?? '',
          lesson: trade.journalEntry?.lesson ?? '',
          confidence: trade.journalEntry?.confidence ?? '',
          notes: trade.journalEntry?.notes ?? '',
        }));

        return respond(trades, toCsv(rows));
      }

      case 'journal': {
        const entries = await prisma.journalEntry.findMany({
          where: { userId: user.id },
          include: { trade: { select: { openedAt: true, direction: true, resultR: true, grade: true } } },
          orderBy: { createdAt: 'asc' },
        });
        const rows = entries.map((entry) => ({
          date: entry.trade.openedAt.toISOString(),
          direction: entry.trade.direction,
          resultR: entry.trade.resultR ?? '',
          grade: entry.grade ?? entry.trade.grade ?? '',
          emotion: entry.emotion,
          mistake: entry.mistake,
          lesson: entry.lesson,
          confidence: entry.confidence ?? '',
          ruleViolation: entry.ruleViolation,
          notes: entry.notes,
        }));
        return respond(entries, toCsv(rows));
      }

      case 'statistics': {
        const trades = await prisma.trade.findMany({ where: { userId: user.id } });
        const analytics = tradeRowsToAnalytics(trades, context.timezone);
        const statistics = computeStatistics(analytics);
        const breakdowns = standardBreakdowns(analytics);

        const rows = [
          { metric: 'Trades', value: statistics.trades },
          { metric: 'Wins', value: statistics.wins },
          { metric: 'Losses', value: statistics.losses },
          { metric: 'Breakevens', value: statistics.breakevens },
          { metric: 'Win rate %', value: statistics.winRate ?? '' },
          { metric: 'Expectancy R', value: statistics.expectancyR ?? '' },
          { metric: 'Profit factor', value: statistics.profitFactor ?? '' },
          { metric: 'Total R', value: statistics.totalR },
          { metric: 'Average R', value: statistics.averageR ?? '' },
          { metric: 'Median R', value: statistics.medianR ?? '' },
          { metric: 'Max drawdown R', value: statistics.maxDrawdownR },
          { metric: 'Max consecutive losses', value: statistics.maxConsecutiveLosses },
          { metric: 'Sharpe-like', value: statistics.sharpeLike ?? '' },
          { metric: 'Rule adherence %', value: statistics.ruleAdherencePercent ?? '' },
        ];
        return respond({ statistics, breakdowns }, toCsv(rows));
      }

      case 'backtest': {
        if (!runId) return apiError('A runId is required for a backtest export.', 422);
        const run = await prisma.backtestRun.findFirst({
          where: { id: runId, userId: user.id },
          include: { trades: { orderBy: { entryTime: 'asc' } } },
        });
        if (!run) return apiError('Backtest run not found.', 404);

        const rows = run.trades.map((trade) => ({
          entryTime: trade.entryTime.toISOString(),
          exitTime: trade.exitTime?.toISOString() ?? '',
          direction: trade.direction,
          session: trade.session,
          entryPrice: trade.entryPrice,
          exitPrice: trade.exitPrice ?? '',
          stopLoss: trade.stopLoss,
          lotSize: trade.lotSize,
          resultR: trade.resultR,
          resultCurrency: trade.resultCurrency,
          maeR: trade.maeR,
          mfeR: trade.mfeR,
          entryModel: trade.entryModel,
          managementModel: trade.managementModel,
          newsPresent: trade.newsPresent ? 'yes' : 'no',
        }));
        return respond(run, toCsv(rows));
      }

      case 'events': {
        const events = await prisma.economicEvent.findMany({
          where: { OR: [{ userId: user.id }, { userId: null }] },
          orderBy: { time: 'asc' },
        });
        const rows = events.map((event) => ({
          time: event.time.toISOString(),
          name: event.name,
          country: event.country,
          importance: event.importance,
          previous: event.previous ?? '',
          forecast: event.forecast ?? '',
          actual: event.actual ?? '',
          surprise: event.surprise ?? '',
          source: event.source,
          pointInTime: event.pointInTime ? 'yes' : 'no',
        }));
        return respond(events, toCsv(rows));
      }

      case 'missed': {
        const missed = await prisma.missedSetup.findMany({
          where: { userId: user.id },
          orderBy: { time: 'asc' },
        });
        const rows = missed.map((entry) => ({
          time: entry.time.toISOString(),
          direction: entry.direction,
          session: entry.session,
          reason: entry.reason,
          hypotheticalR: entry.hypotheticalR ?? '',
          notes: entry.notes,
        }));
        return respond(missed, toCsv(rows));
      }

      case 'candles': {
        const timeframe = searchString(url, 'timeframe', '5M')!;
        const series = await prisma.marketDataSeries.findFirst({
          where: { symbol: context.symbol, timeframe, OR: [{ userId: user.id }, { userId: null }] },
          orderBy: { lastTime: 'desc' },
        });
        if (!series) return apiError(`No stored ${timeframe} data for ${context.symbol}.`, 404);

        const rows = await prisma.marketCandle.findMany({
          where: { seriesId: series.id },
          orderBy: { time: 'asc' },
        });
        const candles = rowsToCandles(rows);
        return respond(candles, candlesToCsv(candles, context.timezone));
      }

      default:
        return apiError(`Unknown dataset "${dataset}".`, 422);
    }
  } catch (error) {
    return handleRouteError(error);
  }
}

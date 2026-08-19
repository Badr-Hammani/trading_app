import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { handleRouteError, json, parseBody } from '@/lib/api';
import { loadCandles, loadUserContext } from '@/lib/context';
import { rowToEvent } from '@/lib/serialize';
import {
  backtestTradesToAnalytics,
  computeStatistics,
  runBacktest,
  TIMEFRAMES,
} from '@xau/core';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const schema = z.object({
  name: z.string().min(1).max(120).default('Backtest'),
  timeframe: z.enum(TIMEFRAMES).default('5M'),
  from: z.number().int(),
  to: z.number().int(),
  entryModel: z.enum(['A', 'B', 'C', 'D']).default('C'),
  managementModel: z.string().default('A'),
  riskPercent: z.number().positive().default(0.5),
  accountBalance: z.number().positive().optional(),
  targetsR: z.tuple([z.number(), z.number(), z.number()]).default([1, 2, 3]),
  enforceSessionFilter: z.boolean().default(true),
  usePointInTimeNews: z.boolean().default(true),
  notes: z.string().max(1000).default(''),
});

/**
 * Run a backtest and store it.
 *
 * Calendar events are read point-in-time: a historical run must see what was
 * known then, not today's revised figures. If only revised data is available
 * the run proceeds without news context and says so, rather than quietly
 * using the wrong numbers.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(request, schema);
    const context = await loadUserContext(user.id);

    const candles = await loadCandles(context, body.timeframe, 100_000, body.from, body.to);
    if (candles.status !== 'ok') {
      return json(
        {
          error: `No candle data for that window: ${candles.message}`,
          hint: 'Import history under Settings → Data, or configure a market data provider.',
        },
        { status: 409 },
      );
    }

    let events: ReturnType<typeof rowToEvent>[] = [];
    let newsNote = 'No calendar data was used.';
    if (body.usePointInTimeNews) {
      const rows = await prisma.economicEvent.findMany({
        where: {
          time: { gte: new Date(body.from * 1000), lte: new Date(body.to * 1000) },
          OR: [{ userId: user.id }, { userId: null }],
          pointInTime: true,
        },
      });
      events = rows.map(rowToEvent);
      newsNote =
        rows.length > 0
          ? `${rows.length} point-in-time events used.`
          : 'No point-in-time calendar rows stored for this window, so the run has no news context. Revised figures were deliberately not substituted.';
    }

    const activeVersion = await prisma.strategyVersion.findFirst({
      where: { userId: user.id, isActive: true },
    });

    const result = runBacktest({
      candles: candles.data.candles,
      timeframe: body.timeframe,
      instrument: context.instrument,
      sessions: context.sessions,
      rules: context.rules,
      entryModel: body.entryModel,
      managementModelId: body.managementModel,
      accountBalance: body.accountBalance ?? (context.accountBalance || 10_000),
      riskPercent: body.riskPercent,
      targetsR: body.targetsR,
      stopBufferAtr: 0.05,
      timezone: context.timezone,
      enforceSessionFilter: body.enforceSessionFilter,
      events,
      newsWindowMinutes: context.rules.newsWindowMinutes,
      strategyVersion: context.strategyVersion,
    });

    const statistics = computeStatistics(backtestTradesToAnalytics(result.trades));

    const run = await prisma.backtestRun.create({
      data: {
        userId: user.id,
        name: body.name,
        symbol: context.symbol,
        timeframe: body.timeframe,
        from: new Date(body.from * 1000),
        to: new Date(body.to * 1000),
        entryModel: body.entryModel,
        managementModel: body.managementModel,
        config: JSON.parse(JSON.stringify({ ...body, rules: context.rules, newsNote })),
        statistics: JSON.parse(JSON.stringify(statistics)),
        tradeCount: result.trades.length,
        skippedCount: result.skipped.length,
        dataProvider: candles.data.meta.provider,
        notes: body.notes,
        strategyVersionId: activeVersion?.id ?? null,
        trades: {
          create: result.trades.map((trade) => ({
            direction: trade.direction,
            entryTime: new Date(trade.entryTime * 1000),
            exitTime: trade.exitTime ? new Date(trade.exitTime * 1000) : null,
            entryPrice: trade.entryPrice,
            exitPrice: trade.averageExit,
            stopLoss: trade.initialStop,
            takeProfit1: trade.takeProfits[0],
            takeProfit2: trade.takeProfits[1],
            takeProfit3: trade.takeProfits[2],
            lotSize: trade.lots,
            resultR: trade.resultR,
            resultCurrency: trade.resultCurrency,
            maeR: trade.maeR,
            mfeR: trade.mfeR,
            session: trade.session,
            entryModel: trade.entryModel,
            managementModel: trade.managementModel,
            fvgTimeframe: trade.fvgTimeframe,
            liquidityContext: trade.liquidityContext,
            structureKind: trade.structureKind,
            displacementScore: trade.displacementScore,
            newsPresent: trade.newsPresent,
            dayOfWeek: trade.dayOfWeek,
            hourOfDay: trade.hourOfDay,
            fills: JSON.parse(JSON.stringify(trade.fills)),
          })),
        },
      },
    });

    return json({
      runId: run.id,
      statistics,
      trades: result.trades,
      skipped: result.skipped.slice(0, 50),
      skippedCount: result.skipped.length,
      barsProcessed: result.barsProcessed,
      dataProvider: candles.data.meta.provider,
      newsNote,
      caveat:
        'A backtest measures one sample under simplified fill assumptions (stop checked before target on the same bar, one position at a time). It is not a guarantee of future performance.',
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function GET() {
  try {
    const user = await requireUser();
    const runs = await prisma.backtestRun.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { strategyVersion: { select: { version: true } } },
    });
    return json({ runs });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return json({ error: 'A run id is required.' }, { status: 422 });
    await prisma.backtestRun.deleteMany({ where: { id, userId: user.id } });
    return json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { handleRouteError, json, parseBody, searchNumber } from '@/lib/api';
import { loadUserContext } from '@/lib/context';
import { rowToEvent } from '@/lib/serialize';
import { BIASES, sessionStatus, startOfLocalDay, computeStatistics } from '@xau/core';
import { tradeRowsToAnalytics } from '@/lib/analyticsMap';

export const dynamic = 'force-dynamic';

/**
 * The daily plan: before, during and after the session.
 *
 * The "after" section is assembled from what actually happened — trades, rule
 * breaks, missed setups — so the review is built from the record rather than
 * from memory at the end of a long day.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const context = await loadUserContext(user.id);
    const at = searchNumber(new URL(request.url), 'at') ?? Math.floor(Date.now() / 1000);
    const dayStart = startOfLocalDay(at, context.timezone);
    const dayEnd = dayStart + 86400;
    const date = new Date(dayStart * 1000);

    const [plan, trades, missed, events, levels] = await Promise.all([
      prisma.dailyPlan.findUnique({
        where: { userId_date_symbol: { userId: user.id, date, symbol: context.symbol } },
      }),
      prisma.trade.findMany({
        where: {
          userId: user.id,
          openedAt: { gte: new Date(dayStart * 1000), lt: new Date(dayEnd * 1000) },
        },
        orderBy: { openedAt: 'asc' },
        include: { journalEntry: true },
      }),
      prisma.missedSetup.findMany({
        where: {
          userId: user.id,
          time: { gte: new Date(dayStart * 1000), lt: new Date(dayEnd * 1000) },
        },
      }),
      prisma.economicEvent.findMany({
        where: {
          time: { gte: new Date(dayStart * 1000), lt: new Date(dayEnd * 1000) },
          OR: [{ userId: user.id }, { userId: null }],
        },
        orderBy: { time: 'asc' },
      }),
      prisma.liquidityLevel.findMany({
        where: { userId: user.id, symbol: context.symbol },
        orderBy: { price: 'desc' },
      }),
    ]);

    const statistics = computeStatistics(tradeRowsToAnalytics(trades, context.timezone));

    return json({
      date: date.toISOString(),
      timezone: context.timezone,
      plan,
      sessions: sessionStatus(context.sessions, at),
      keyLevels: levels,
      events: events.map(rowToEvent),
      trades,
      missedSetups: missed,
      statistics,
      ruleBreaks: trades.filter((trade) => trade.ruleViolation || trade.grade === 'RULE_BREAK').length,
      lessons: trades
        .map((trade) => trade.journalEntry?.lesson)
        .filter((lesson): lesson is string => Boolean(lesson)),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

const schema = z.object({
  at: z.number().int().optional(),
  bias4h: z.enum(BIASES).optional(),
  bias1h: z.enum(BIASES).optional(),
  bias30m: z.enum(BIASES).optional(),
  liquidityNotes: z.string().max(3000).optional(),
  expectedVolatility: z.string().max(300).optional(),
  londonPlan: z.string().max(3000).optional(),
  newYorkPlan: z.string().max(3000).optional(),
  noTradeConditions: z.string().max(3000).optional(),
  duringSessionNotes: z.string().max(5000).optional(),
  afterSessionNotes: z.string().max(5000).optional(),
  lessons: z.string().max(3000).optional(),
});

export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(request, schema);
    const context = await loadUserContext(user.id);
    const at = body.at ?? Math.floor(Date.now() / 1000);
    const date = new Date(startOfLocalDay(at, context.timezone) * 1000);
    const { at: _at, ...data } = body;

    const plan = await prisma.dailyPlan.upsert({
      where: { userId_date_symbol: { userId: user.id, date, symbol: context.symbol } },
      update: data,
      create: { userId: user.id, date, symbol: context.symbol, ...data },
    });

    return json({ plan });
  } catch (error) {
    return handleRouteError(error);
  }
}

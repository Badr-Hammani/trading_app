import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { handleRouteError, json, parseBody, searchNumber } from '@/lib/api';
import { loadUserContext } from '@/lib/context';
import { buildWeeklyReview, startOfLocalWeek } from '@xau/core';
import { tradeRowsToAnalytics } from '@/lib/analyticsMap';

export const dynamic = 'force-dynamic';

/**
 * Weekly review.
 *
 * Deliberately capped at three recommendations. A list of fifteen things to
 * fix produces no change at all.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const context = await loadUserContext(user.id);
    const at = searchNumber(new URL(request.url), 'at') ?? Math.floor(Date.now() / 1000);
    const weekStart = startOfLocalWeek(at, context.timezone);
    const weekEnd = weekStart + 7 * 86400;

    const [rows, missed, stored] = await Promise.all([
      prisma.trade.findMany({
        where: {
          userId: user.id,
          openedAt: { gte: new Date(weekStart * 1000), lt: new Date(weekEnd * 1000) },
        },
        include: { journalEntry: true },
        orderBy: { openedAt: 'asc' },
      }),
      prisma.missedSetup.findMany({
        where: {
          userId: user.id,
          time: { gte: new Date(weekStart * 1000), lt: new Date(weekEnd * 1000) },
        },
      }),
      prisma.weeklyReview.findUnique({
        where: { userId_weekStart: { userId: user.id, weekStart: new Date(weekStart * 1000) } },
      }),
    ]);

    const review = buildWeeklyReview({
      weekStart,
      weekEnd,
      trades: tradeRowsToAnalytics(rows, context.timezone),
      missed: missed.map((entry) => ({
        id: entry.id,
        time: Math.floor(entry.time.getTime() / 1000),
        direction: entry.direction,
        reason: entry.reason,
        session: entry.session,
        hypotheticalR: entry.hypotheticalR,
      })),
      mistakes: rows
        .map((trade) => trade.journalEntry?.mistake ?? '')
        .filter((mistake) => mistake.trim() !== ''),
      goodDecisions: rows
        .map((trade) => trade.journalEntry?.lesson ?? '')
        .filter((lesson) => lesson.trim() !== ''),
    });

    return json({ review, stored, timezone: context.timezone });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** Persist the week's review with the trader's own notes attached. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const context = await loadUserContext(user.id);
    const body = await parseBody(
      request,
      z.object({
        at: z.number().int().optional(),
        notes: z.string().max(5000).default(''),
        biggestMistake: z.string().max(1000).default(''),
        bestDecision: z.string().max(1000).default(''),
      }),
    );

    const at = body.at ?? Math.floor(Date.now() / 1000);
    const weekStart = startOfLocalWeek(at, context.timezone);
    const weekEnd = weekStart + 7 * 86400;

    const rows = await prisma.trade.findMany({
      where: {
        userId: user.id,
        openedAt: { gte: new Date(weekStart * 1000), lt: new Date(weekEnd * 1000) },
      },
      include: { journalEntry: true },
    });

    const review = buildWeeklyReview({
      weekStart,
      weekEnd,
      trades: tradeRowsToAnalytics(rows, context.timezone),
      missed: [],
      mistakes: [],
      goodDecisions: [],
    });

    const saved = await prisma.weeklyReview.upsert({
      where: { userId_weekStart: { userId: user.id, weekStart: new Date(weekStart * 1000) } },
      update: {
        statistics: JSON.parse(JSON.stringify(review.statistics)),
        recommendations: review.recommendations,
        notes: body.notes,
        biggestMistake: body.biggestMistake,
        bestDecision: body.bestDecision,
        ruleAdherence: review.ruleAdherencePercent,
      },
      create: {
        userId: user.id,
        weekStart: new Date(weekStart * 1000),
        weekEnd: new Date(weekEnd * 1000),
        statistics: JSON.parse(JSON.stringify(review.statistics)),
        recommendations: review.recommendations,
        notes: body.notes,
        biggestMistake: body.biggestMistake,
        bestDecision: body.bestDecision,
        ruleAdherence: review.ruleAdherencePercent,
      },
    });

    return json({ review: saved });
  } catch (error) {
    return handleRouteError(error);
  }
}

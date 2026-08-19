import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { handleRouteError, json, parseBody } from '@/lib/api';
import { processVsOutcome, TRADE_GRADES } from '@xau/core';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);

    const trades = await prisma.trade.findMany({
      where: {
        userId: user.id,
        ...(url.searchParams.get('status') ? { status: url.searchParams.get('status')! } : {}),
        ...(url.searchParams.get('grade') ? { grade: url.searchParams.get('grade')! } : {}),
      },
      orderBy: { openedAt: 'desc' },
      take: Number(url.searchParams.get('limit') ?? 200),
      include: {
        journalEntry: true,
        screenshots: { select: { id: true, phase: true, filename: true, caption: true } },
        executions: { orderBy: { time: 'asc' } },
        managementEvents: { orderBy: { time: 'asc' } },
      },
    });

    return json({
      trades: trades.map((trade) => ({
        ...trade,
        // The line the journal exists to draw: process quality vs outcome.
        processVsOutcome: trade.grade
          ? processVsOutcome(trade.grade as (typeof TRADE_GRADES)[number], trade.resultR)
          : null,
      })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

const schema = z.object({
  tradeId: z.string(),
  emotion: z.string().max(200).optional(),
  mistake: z.string().max(1000).optional(),
  lesson: z.string().max(1000).optional(),
  confidence: z.number().int().min(1).max(10).nullable().optional(),
  ruleViolation: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
  grade: z.enum(TRADE_GRADES).nullable().optional(),
  processNote: z.string().max(1000).optional(),
});

export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(request, schema);

    const trade = await prisma.trade.findFirst({ where: { id: body.tradeId, userId: user.id } });
    if (!trade) return json({ error: 'Trade not found.' }, { status: 404 });

    const { tradeId, grade, ...entryData } = body;

    const entry = await prisma.journalEntry.upsert({
      where: { tradeId },
      update: { ...entryData, ...(grade !== undefined ? { grade } : {}) },
      create: { userId: user.id, tradeId, ...entryData, ...(grade !== undefined ? { grade } : {}) },
    });

    // The grade lives on the trade too, because statistics group by it.
    if (grade !== undefined) {
      await prisma.trade.update({
        where: { id: tradeId },
        data: { grade, ruleViolation: grade === 'RULE_BREAK' || Boolean(body.ruleViolation) },
      });
    }

    return json({ entry });
  } catch (error) {
    return handleRouteError(error);
  }
}

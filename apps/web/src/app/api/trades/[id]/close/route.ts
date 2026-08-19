import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { handleRouteError, json, parseBody } from '@/lib/api';
import { loadUserContext } from '@/lib/context';
import { profitFor, suggestGrade, summariseChecklist, type ChecklistState } from '@xau/core';

export const dynamic = 'force-dynamic';

const schema = z.object({
  price: z.number(),
  time: z.number().int().optional(),
  maeR: z.number().nullable().optional(),
  mfeR: z.number().nullable().optional(),
  reason: z.string().max(200).default('Manual close'),
});

/**
 * Close the remaining position and compute the result.
 *
 * R is weighted across every fill, so a scaled-out trade reports what actually
 * happened rather than the outcome of its final exit.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = await parseBody(request, schema);
    const context = await loadUserContext(user.id);

    const trade = await prisma.trade.findFirst({
      where: { id, userId: user.id },
      include: { executions: true, setup: true },
    });
    if (!trade) return json({ error: 'Trade not found.' }, { status: 404 });
    if (trade.status !== 'open') return json({ error: 'That trade is already closed.' }, { status: 409 });

    const time = new Date((body.time ?? Math.floor(Date.now() / 1000)) * 1000);
    const direction = trade.direction as 'long' | 'short';
    const riskDistance = Math.abs(trade.entry - trade.initialStop);

    const finalPnl =
      trade.remainingLots > 0
        ? profitFor(trade.entry, body.price, trade.remainingLots, direction, context.instrument)
        : 0;

    if (trade.remainingLots > 0) {
      await prisma.tradeExecution.create({
        data: {
          tradeId: trade.id,
          kind: 'exit',
          time,
          price: body.price,
          lots: trade.remainingLots,
          percent: (trade.remainingLots / trade.lotSize) * 100,
          pnl: finalPnl,
          reason: body.reason,
        },
      });
    }

    const executions = await prisma.tradeExecution.findMany({
      where: { tradeId: trade.id, kind: { in: ['partial', 'exit'] } },
    });

    const resultCurrency = executions.reduce((sum, execution) => sum + execution.pnl, 0);
    const resultR =
      riskDistance > 0
        ? executions.reduce((sum, execution) => {
            const move =
              direction === 'long'
                ? execution.price - trade.entry
                : trade.entry - execution.price;
            return sum + (move / riskDistance) * (execution.percent / 100);
          }, 0)
        : 0;

    // Grade the process, never the outcome.
    const checklist = (trade.setup?.checklist as ChecklistState | undefined) ?? {};
    const summary = summariseChecklist(direction, checklist);
    const grade = suggestGrade({
      checklist: summary,
      ruleViolations: trade.ruleViolation ? ['Recorded during the trade'] : [],
      sessionValid: trade.setup?.sessionValid ?? true,
      riskWithinLimit: trade.riskPercent <= context.rules.maxRiskPercent + 1e-9,
      confirmationTaken: Boolean(checklist.entry_reaction),
      newsPresent: trade.newsPresent,
      newsFilterEnabled: context.rules.newsFilterEnabled,
    });

    const updated = await prisma.trade.update({
      where: { id: trade.id },
      data: {
        status: 'closed',
        closedAt: time,
        remainingLots: 0,
        realisedPnl: resultCurrency,
        resultCurrency,
        resultR,
        maeR: body.maeR ?? null,
        mfeR: body.mfeR ?? null,
        grade: trade.grade ?? grade.grade,
      },
      include: { executions: true, journalEntry: true },
    });

    return json({ trade: updated, suggestedGrade: grade });
  } catch (error) {
    return handleRouteError(error);
  }
}

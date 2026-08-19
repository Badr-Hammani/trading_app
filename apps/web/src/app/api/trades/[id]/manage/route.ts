import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { handleRouteError, json, parseBody } from '@/lib/api';
import { loadUserContext } from '@/lib/context';
import { profitFor } from '@xau/core';

export const dynamic = 'force-dynamic';

const schema = z.object({
  type: z.enum(['partial_close', 'stop_moved', 'target_moved', 'note']),
  time: z.number().int().optional(),
  price: z.number().nullable().optional(),
  percent: z.number().min(0).max(100).nullable().optional(),
  newStop: z.number().nullable().optional(),
  takeProfit1: z.number().nullable().optional(),
  takeProfit2: z.number().nullable().optional(),
  takeProfit3: z.number().nullable().optional(),
  note: z.string().max(500).default(''),
});

/**
 * Record a management action: a partial close, a stop move to breakeven, a
 * target adjustment. Every action is stored as an event so the Strategy Lab
 * can later compare how the trade was actually managed against the models.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const body = await parseBody(request, schema);
    const context = await loadUserContext(user.id);

    const trade = await prisma.trade.findFirst({ where: { id, userId: user.id } });
    if (!trade) return json({ error: 'Trade not found.' }, { status: 404 });
    if (trade.status !== 'open') return json({ error: 'That trade is already closed.' }, { status: 409 });

    const time = new Date((body.time ?? Math.floor(Date.now() / 1000)) * 1000);
    let realisedPnl: number | null = null;
    const updates: Record<string, unknown> = {};

    if (body.type === 'partial_close') {
      if (body.price == null || body.percent == null) {
        return json({ error: 'A partial close needs both a price and a percentage.' }, { status: 422 });
      }
      const lots = trade.lotSize * (body.percent / 100);
      if (lots > trade.remainingLots + 1e-9) {
        return json(
          { error: `Only ${trade.remainingLots} lots remain; ${lots.toFixed(2)} were requested.` },
          { status: 422 },
        );
      }

      realisedPnl = profitFor(
        trade.entry,
        body.price,
        lots,
        trade.direction as 'long' | 'short',
        context.instrument,
      );

      updates.remainingLots = trade.remainingLots - lots;
      updates.realisedPnl = trade.realisedPnl + realisedPnl;

      await prisma.tradeExecution.create({
        data: {
          tradeId: trade.id,
          kind: 'partial',
          time,
          price: body.price,
          lots,
          percent: body.percent,
          pnl: realisedPnl,
          reason: body.note || 'Partial close',
        },
      });
    }

    if (body.type === 'stop_moved' && body.newStop != null) {
      updates.currentStop = body.newStop;
    }

    if (body.type === 'target_moved') {
      if (body.takeProfit1 !== undefined) updates.takeProfit1 = body.takeProfit1;
      if (body.takeProfit2 !== undefined) updates.takeProfit2 = body.takeProfit2;
      if (body.takeProfit3 !== undefined) updates.takeProfit3 = body.takeProfit3;
    }

    await prisma.tradeManagementEvent.create({
      data: {
        tradeId: trade.id,
        type: body.type,
        time,
        price: body.price ?? null,
        percent: body.percent ?? null,
        newStop: body.newStop ?? null,
        realisedPnl,
        note: body.note,
      },
    });

    const updated = await prisma.trade.update({
      where: { id: trade.id },
      data: updates,
      include: { executions: true, managementEvents: { orderBy: { time: 'asc' } } },
    });

    return json({ trade: updated });
  } catch (error) {
    return handleRouteError(error);
  }
}

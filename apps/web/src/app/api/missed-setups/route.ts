import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { handleRouteError, json, parseBody } from '@/lib/api';
import { loadUserContext } from '@/lib/context';
import { MISSED_TRADE_REASONS, sessionLabelAt } from '@xau/core';

export const dynamic = 'force-dynamic';

/**
 * Missed trade tracker.
 *
 * Logging what was skipped, and why, is the only way to find out whether the
 * session filter and the confidence threshold are helping or just costing
 * trades. Without this the filters can never be evaluated.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const missed = await prisma.missedSetup.findMany({
      where: { userId: user.id },
      orderBy: { time: 'desc' },
      take: 200,
      include: { setup: { select: { id: true, direction: true, status: true } } },
    });

    const byReason = MISSED_TRADE_REASONS.map((reason) => {
      const group = missed.filter((entry) => entry.reason === reason);
      const withOutcome = group.filter((entry) => entry.hypotheticalR !== null);
      return {
        reason,
        count: group.length,
        withOutcome: withOutcome.length,
        averageR:
          withOutcome.length > 0
            ? withOutcome.reduce((sum, entry) => sum + (entry.hypotheticalR ?? 0), 0) / withOutcome.length
            : null,
      };
    });

    return json({ missed, byReason, reasons: MISSED_TRADE_REASONS });
  } catch (error) {
    return handleRouteError(error);
  }
}

const schema = z.object({
  setupId: z.string().nullable().optional(),
  time: z.number().int().optional(),
  direction: z.enum(['long', 'short']),
  reason: z.string().min(1).max(80),
  hypotheticalR: z.number().nullable().optional(),
  notes: z.string().max(1000).default(''),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(request, schema);
    const context = await loadUserContext(user.id);
    const time = body.time ?? Math.floor(Date.now() / 1000);

    const missed = await prisma.missedSetup.create({
      data: {
        userId: user.id,
        setupId: body.setupId ?? null,
        time: new Date(time * 1000),
        symbol: context.symbol,
        direction: body.direction,
        session: sessionLabelAt(context.sessions, time),
        reason: body.reason,
        hypotheticalR: body.hypotheticalR ?? null,
        notes: body.notes,
      },
    });

    return json({ missed });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(
      request,
      z.object({
        id: z.string(),
        // Filled in later, once the trader has seen how the setup resolved.
        hypotheticalR: z.number().nullable().optional(),
        notes: z.string().max(1000).optional(),
      }),
    );
    const { id, ...data } = body;

    const result = await prisma.missedSetup.updateMany({ where: { id, userId: user.id }, data });
    if (result.count === 0) return json({ error: 'Entry not found.' }, { status: 404 });
    return json({ missed: await prisma.missedSetup.findUnique({ where: { id } }) });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return json({ error: 'An id is required.' }, { status: 422 });
    await prisma.missedSetup.deleteMany({ where: { id, userId: user.id } });
    return json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

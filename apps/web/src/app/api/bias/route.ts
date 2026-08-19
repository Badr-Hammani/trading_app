import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { handleRouteError, json, parseBody, searchNumber } from '@/lib/api';
import { loadUserContext } from '@/lib/context';
import { BIASES, startOfLocalDay, TIMEFRAMES } from '@xau/core';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const context = await loadUserContext(user.id);
    const at = searchNumber(new URL(request.url), 'at') ?? Math.floor(Date.now() / 1000);
    const date = new Date(startOfLocalDay(at, context.timezone) * 1000);

    const rows = await prisma.marketBias.findMany({
      where: { userId: user.id, symbol: context.symbol, date },
    });
    return json({ date: date.toISOString(), bias: rows });
  } catch (error) {
    return handleRouteError(error);
  }
}

const schema = z.object({
  timeframe: z.enum(TIMEFRAMES),
  bias: z.enum(BIASES),
  rationale: z.string().max(500).default(''),
  at: z.number().int().optional(),
});

/**
 * The trader's bias, per timeframe per day.
 *
 * `source` is always "user" here. The engine's own reading is offered
 * separately as a suggestion and never written into this table.
 */
export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(request, schema);
    const context = await loadUserContext(user.id);
    const at = body.at ?? Math.floor(Date.now() / 1000);
    const date = new Date(startOfLocalDay(at, context.timezone) * 1000);

    const row = await prisma.marketBias.upsert({
      where: {
        userId_symbol_timeframe_date: {
          userId: user.id,
          symbol: context.symbol,
          timeframe: body.timeframe,
          date,
        },
      },
      update: { bias: body.bias, rationale: body.rationale, source: 'user' },
      create: {
        userId: user.id,
        symbol: context.symbol,
        timeframe: body.timeframe,
        date,
        bias: body.bias,
        rationale: body.rationale,
        source: 'user',
      },
    });

    return json({ bias: row });
  } catch (error) {
    return handleRouteError(error);
  }
}

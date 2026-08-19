import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { handleRouteError, json, parseBody } from '@/lib/api';
import { loadCandles, loadUserContext } from '@/lib/context';
import { rowToLiquidity } from '@/lib/serialize';
import {
  deriveEqualLevels,
  derivePeriodLevels,
  deriveSessionLevels,
  detectSwings,
  evaluateLiquidity,
  LIQUIDITY_TYPES,
  sideForType,
  SWING_PRESETS,
  TIMEFRAMES,
} from '@xau/core';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();
    const context = await loadUserContext(user.id);

    const rows = await prisma.liquidityLevel.findMany({
      where: { userId: user.id, symbol: context.symbol },
      orderBy: { price: 'desc' },
    });

    // Re-classify against current candles so sweeps stay current without the
    // trader having to press anything.
    const candles = await loadCandles(context, '5M', 800);
    const evaluated =
      candles.status === 'ok'
        ? evaluateLiquidity(rows.map(rowToLiquidity), candles.data.candles)
        : rows.map(rowToLiquidity);

    // Persist any newly detected sweep/break so the journal can reference it.
    for (const level of evaluated) {
      const original = rows.find((row) => row.id === level.id);
      if (!original || original.status === level.status) continue;
      await prisma.liquidityLevel.update({
        where: { id: level.id },
        data: {
          status: level.status,
          eventTime: level.eventTime ? new Date(level.eventTime * 1000) : null,
          penetration: level.penetration,
        },
      });
    }

    return json({ levels: evaluated, price: candles.status === 'ok' ? candles.data.candles.at(-1)?.close ?? null : null });
  } catch (error) {
    return handleRouteError(error);
  }
}

const createSchema = z.object({
  type: z.enum(LIQUIDITY_TYPES),
  price: z.number(),
  timeframe: z.enum(TIMEFRAMES).default('5M'),
  createdTime: z.number().int().optional(),
  label: z.string().max(120).default(''),
  notes: z.string().max(500).default(''),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(request, createSchema);
    const context = await loadUserContext(user.id);

    const level = await prisma.liquidityLevel.create({
      data: {
        userId: user.id,
        symbol: context.symbol,
        type: body.type,
        side: sideForType(body.type),
        price: body.price,
        timeframe: body.timeframe,
        createdTime: new Date((body.createdTime ?? Math.floor(Date.now() / 1000)) * 1000),
        label: body.label || body.type,
        notes: body.notes,
        manual: true,
      },
    });

    return json({ level });
  } catch (error) {
    return handleRouteError(error);
  }
}

const updateSchema = z.object({
  id: z.string(),
  price: z.number().optional(),
  // The trader can override the classification: the engine is strict about
  // what counts as a sweep, but the final call is theirs.
  status: z.enum(['intact', 'swept', 'broken']).optional(),
  label: z.string().max(120).optional(),
  notes: z.string().max(500).optional(),
});

export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(request, updateSchema);
    const { id, ...data } = body;

    const result = await prisma.liquidityLevel.updateMany({
      where: { id, userId: user.id },
      data: {
        ...data,
        ...(data.status === 'swept' ? { eventTime: new Date() } : {}),
      },
    });
    if (result.count === 0) return json({ error: 'Level not found.' }, { status: 404 });

    return json({ level: await prisma.liquidityLevel.findUnique({ where: { id } }) });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return json({ error: 'A level id is required.' }, { status: 422 });
    await prisma.liquidityLevel.deleteMany({ where: { id, userId: user.id } });
    return json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * Derive the standard reference levels and save the ones that are missing.
 * Detection is a convenience; the trader keeps control of the map and can
 * delete or override anything here.
 */
export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    const context = await loadUserContext(user.id);
    const body = await parseBody(
      request,
      z.object({ timeframe: z.enum(TIMEFRAMES).default('5M'), at: z.number().int().optional() }),
    );

    const at = body.at ?? Math.floor(Date.now() / 1000);
    const candles = await loadCandles(context, body.timeframe, 1500);
    if (candles.status !== 'ok') return json({ error: candles.message, detected: 0 }, { status: 409 });

    const swings = detectSwings(
      candles.data.candles,
      body.timeframe,
      SWING_PRESETS[context.rules.sensitivity],
    );

    const derived = [
      ...derivePeriodLevels(candles.data.candles, body.timeframe, at, context.timezone),
      ...deriveSessionLevels(candles.data.candles, body.timeframe, at, context.sessions),
      ...deriveEqualLevels(swings, candles.data.candles, body.timeframe),
    ];

    const existing = await prisma.liquidityLevel.findMany({
      where: { userId: user.id, symbol: context.symbol },
    });

    let created = 0;
    for (const level of derived) {
      // Skip anything the trader already has within a tick of this price.
      const duplicate = existing.some(
        (row) => row.type === level.type && Math.abs(row.price - level.price) < context.instrument.tickSize,
      );
      if (duplicate) continue;

      await prisma.liquidityLevel.create({
        data: {
          userId: user.id,
          symbol: context.symbol,
          type: level.type,
          side: level.side,
          price: level.price,
          timeframe: level.timeframe,
          createdTime: new Date(level.createdTime * 1000),
          label: level.label,
          manual: false,
        },
      });
      created += 1;
    }

    return json({ detected: derived.length, created });
  } catch (error) {
    return handleRouteError(error);
  }
}

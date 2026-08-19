import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { handleRouteError, json, parseBody, searchString } from '@/lib/api';
import { loadCandles, loadUserContext } from '@/lib/context';
import { buildFvgZones, isTimeframe, scanDisplacement, scoreFvgQuality, TIMEFRAMES } from '@xau/core';

export const dynamic = 'force-dynamic';

/**
 * FVG manager.
 *
 * Zones are recomputed from candles rather than trusted from storage, which is
 * what keeps the "a violated zone stays dead" rule true: the engine replays
 * mitigation from the source data every time.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const context = await loadUserContext(user.id);
    const timeframe = searchString(new URL(request.url), 'timeframe', '5M')!;
    if (!isTimeframe(timeframe)) return json({ error: `Unknown timeframe "${timeframe}".` }, { status: 422 });

    const candles = await loadCandles(context, timeframe, 800);
    if (candles.status !== 'ok') {
      return json({ available: false, reason: candles.message, zones: [], manual: [] });
    }

    const zones = buildFvgZones(candles.data.candles, timeframe);
    const displacement = scanDisplacement(candles.data.candles, timeframe, { fvgZones: zones });

    const withQuality = zones.map((zone) => {
      const reading = displacement.find((entry) => entry.index === zone.createdIndex - 1);
      const quality = scoreFvgQuality(zone, { displacementScore: reading?.score ?? null });
      return { ...zone, quality: quality.score, qualityReasons: quality.reasons };
    });

    const manual = await prisma.fvgZone.findMany({
      where: { userId: user.id, symbol: context.symbol, manual: true },
      orderBy: { createdTime: 'desc' },
    });

    return json({
      available: true,
      timeframe,
      zones: withQuality,
      manual,
      counts: {
        fresh: zones.filter((zone) => zone.status === 'fresh').length,
        partial: zones.filter((zone) => zone.status === 'partially_mitigated').length,
        // Dead zones are kept and shown faded; they are never removed or reused.
        dead: zones.filter(
          (zone) => zone.status === 'fully_mitigated' || zone.status === 'invalidated',
        ).length,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

const manualSchema = z.object({
  direction: z.enum(['bullish', 'bearish']),
  timeframe: z.enum(TIMEFRAMES),
  high: z.number(),
  low: z.number(),
  createdTime: z.number().int().optional(),
  notes: z.string().max(500).default(''),
});

/** A zone the trader drew themselves, e.g. an HTF gap read off another chart. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(request, manualSchema);
    const context = await loadUserContext(user.id);

    const high = Math.max(body.high, body.low);
    const low = Math.min(body.high, body.low);

    const zone = await prisma.fvgZone.create({
      data: {
        userId: user.id,
        symbol: context.symbol,
        direction: body.direction,
        timeframe: body.timeframe,
        high,
        low,
        midpoint: (high + low) / 2,
        size: high - low,
        createdTime: new Date((body.createdTime ?? Math.floor(Date.now() / 1000)) * 1000),
        manual: true,
        notes: body.notes,
        overlaps: [],
      },
    });

    return json({ zone });
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
        status: z.enum(['fresh', 'partially_mitigated', 'fully_mitigated', 'invalidated']).optional(),
        notes: z.string().max(500).optional(),
      }),
    );
    const { id, ...data } = body;

    const result = await prisma.fvgZone.updateMany({ where: { id, userId: user.id }, data });
    if (result.count === 0) return json({ error: 'Zone not found.' }, { status: 404 });
    return json({ zone: await prisma.fvgZone.findUnique({ where: { id } }) });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return json({ error: 'A zone id is required.' }, { status: 422 });
    await prisma.fvgZone.deleteMany({ where: { id, userId: user.id, manual: true } });
    return json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

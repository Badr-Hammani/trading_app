import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { handleRouteError, json, parseBody, searchString } from '@/lib/api';
import { loadCandles, loadUserContext } from '@/lib/context';
import {
  detectStructureEvents,
  detectSwings,
  isTimeframe,
  labelSwings,
  suggestBias,
  SWING_PRESETS,
  type StructureEvent,
} from '@xau/core';

export const dynamic = 'force-dynamic';

/**
 * Structure engine output.
 *
 * Detected events are proposals. The trader confirms or rejects each one, and
 * a rejected event is excluded from every downstream evaluation.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const context = await loadUserContext(user.id);
    const url = new URL(request.url);
    const timeframe = searchString(url, 'timeframe', '5M')!;
    if (!isTimeframe(timeframe)) return json({ error: `Unknown timeframe "${timeframe}".` }, { status: 422 });

    const scope = searchString(url, 'scope', 'all');
    const candles = await loadCandles(context, timeframe, 800);
    if (candles.status !== 'ok') {
      return json({ available: false, reason: candles.message, events: [], swings: [] });
    }

    const config = SWING_PRESETS[context.rules.sensitivity];
    const swings = detectSwings(candles.data.candles, timeframe, config);
    const events = detectStructureEvents(candles.data.candles, swings, timeframe);

    // Merge in the trader's confirmations/rejections, matched on time+level.
    const reviews = await prisma.structureEvent.findMany({
      where: { userId: user.id, symbol: context.symbol, timeframe },
    });

    const merged = events.map((event) => {
      const review = reviews.find(
        (row) =>
          Math.abs(Math.floor(row.time.getTime() / 1000) - event.time) < 1 &&
          Math.abs(row.brokenLevel - event.brokenLevel) < 1e-6,
      );
      return {
        ...event,
        review: (review?.review as StructureEvent['review']) ?? event.review,
        reviewId: review?.id ?? null,
      };
    });

    const filtered =
      scope === 'major' || scope === 'internal'
        ? merged.filter((event) => event.scope === scope)
        : merged;

    return json({
      available: true,
      timeframe,
      sensitivity: context.rules.sensitivity,
      events: filtered.slice(-60),
      swings: labelSwings(swings).slice(-80),
      // Offered as a suggestion only; the trader's own bias is stored elsewhere.
      suggestedBias: suggestBias(merged.filter((event) => event.review !== 'rejected')),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

const reviewSchema = z.object({
  kind: z.enum(['BOS', 'CHoCH']),
  direction: z.enum(['bullish', 'bearish']),
  scope: z.enum(['major', 'internal']),
  timeframe: z.string(),
  time: z.number().int(),
  brokenLevel: z.number(),
  brokenSwingTime: z.number().int(),
  closePrice: z.number(),
  review: z.enum(['confirmed', 'rejected', 'detected']),
  notes: z.string().max(500).default(''),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(request, reviewSchema);
    const context = await loadUserContext(user.id);

    const existing = await prisma.structureEvent.findFirst({
      where: {
        userId: user.id,
        symbol: context.symbol,
        timeframe: body.timeframe,
        time: new Date(body.time * 1000),
      },
    });

    const data = {
      userId: user.id,
      symbol: context.symbol,
      kind: body.kind,
      direction: body.direction,
      scope: body.scope,
      timeframe: body.timeframe,
      time: new Date(body.time * 1000),
      brokenLevel: body.brokenLevel,
      brokenSwingTime: new Date(body.brokenSwingTime * 1000),
      closePrice: body.closePrice,
      review: body.review,
      notes: body.notes,
    };

    const row = existing
      ? await prisma.structureEvent.update({ where: { id: existing.id }, data })
      : await prisma.structureEvent.create({ data });

    return json({ event: row });
  } catch (error) {
    return handleRouteError(error);
  }
}

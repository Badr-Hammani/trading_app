import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { loadUserContext } from '@/lib/context';
import { prisma } from '@/lib/db';
import { handleRouteError, json, parseBody, searchNumber } from '@/lib/api';
import { buildNewsRisk } from '@xau/core';
import { isGoldRelevant } from '@xau/providers';

export const dynamic = 'force-dynamic';

/**
 * Gold-relevant economic calendar.
 *
 * `asOf` routes the request to the provider's point-in-time snapshot so a
 * backtest sees the numbers as they were published, not as later revised.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const context = await loadUserContext(user.id);
    const url = new URL(request.url);

    const now = Math.floor(Date.now() / 1000);
    const from = searchNumber(url, 'from') ?? now - 86400;
    const to = searchNumber(url, 'to') ?? now + 7 * 86400;
    const asOf = searchNumber(url, 'asOf');
    const goldOnly = url.searchParams.get('goldOnly') !== 'false';

    const result = await context.providers.economic.getCalendar({
      from,
      to,
      ...(asOf ? { asOf } : {}),
    });

    if (result.status !== 'ok') {
      return json({ result, events: [], newsRisk: null, provider: context.providers.economic.info });
    }

    const events = goldOnly
      ? result.data.filter((event) => isGoldRelevant(event.name, event.category))
      : result.data;

    return json({
      result: { ...result, data: events },
      events,
      newsRisk: buildNewsRisk(events, now, {
        windowMinutes: context.rules.newsWindowMinutes,
        filterEnabled: context.rules.newsFilterEnabled,
      }),
      provider: context.providers.economic.info,
      pointInTime: Boolean(asOf),
      timezone: context.timezone,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

const eventSchema = z.object({
  name: z.string().min(1).max(160),
  country: z.string().min(1).max(60).default('United States'),
  time: z.number().int(),
  importance: z.enum(['high', 'medium', 'low']),
  category: z.string().max(80).nullable().optional(),
  previous: z.number().nullable().optional(),
  forecast: z.number().nullable().optional(),
  actual: z.number().nullable().optional(),
  unit: z.string().max(20).nullable().optional(),
  notes: z.string().max(500).default(''),
});

/** Add an event by hand: the calendar and news filter work with no API key. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(request, eventSchema);

    const actual = body.actual ?? null;
    const forecast = body.forecast ?? null;

    const event = await prisma.economicEvent.create({
      data: {
        userId: user.id,
        name: body.name,
        country: body.country,
        time: new Date(body.time * 1000),
        importance: body.importance,
        category: body.category ?? null,
        previous: body.previous ?? null,
        forecast,
        actual,
        unit: body.unit ?? null,
        surprise: actual !== null && forecast !== null ? actual - forecast : null,
        source: 'manual',
        notes: body.notes,
      },
    });

    return json({ event });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return json({ error: 'An event id is required.' }, { status: 422 });

    await prisma.economicEvent.deleteMany({ where: { id, userId: user.id } });
    return json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

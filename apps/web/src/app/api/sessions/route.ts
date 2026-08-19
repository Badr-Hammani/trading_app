import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { handleRouteError, json, parseBody } from '@/lib/api';
import { isValidTimezone, sessionStatus, type SessionDefinition } from '@xau/core';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await prisma.tradingSession.findMany({
      where: { userId: user.id },
      orderBy: { sortOrder: 'asc' },
    });

    const definitions: SessionDefinition[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind as SessionDefinition['kind'],
      timezone: row.timezone,
      startMinutes: row.startMinutes,
      endMinutes: row.endMinutes,
      days: row.days,
      tradingPermitted: row.tradingPermitted,
      enabled: row.enabled,
      color: row.color,
    }));

    return json({
      sessions: rows,
      status: sessionStatus(definitions, Math.floor(Date.now() / 1000)),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

const sessionSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(60),
  kind: z.enum(['asian', 'london', 'newyork', 'overlap', 'custom']),
  timezone: z.string(),
  startMinutes: z.number().int().min(0).max(1439),
  endMinutes: z.number().int().min(0).max(1439),
  days: z.array(z.number().int().min(1).max(7)).min(1),
  tradingPermitted: z.boolean(),
  enabled: z.boolean(),
  color: z.string().max(20),
});

/** Replace the whole session set. Times are never hardcoded in the app. */
export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(request, z.object({ sessions: z.array(sessionSchema) }));

    for (const session of body.sessions) {
      if (!isValidTimezone(session.timezone)) {
        return json(
          { error: `"${session.timezone}" is not a recognised IANA timezone.` },
          { status: 422 },
        );
      }
    }

    await prisma.$transaction([
      prisma.tradingSession.deleteMany({ where: { userId: user.id } }),
      prisma.tradingSession.createMany({
        data: body.sessions.map((session, index) => ({
          userId: user.id,
          name: session.name,
          kind: session.kind,
          timezone: session.timezone,
          startMinutes: session.startMinutes,
          endMinutes: session.endMinutes,
          days: session.days,
          tradingPermitted: session.tradingPermitted,
          enabled: session.enabled,
          color: session.color,
          sortOrder: index,
        })),
      }),
    ]);

    const rows = await prisma.tradingSession.findMany({
      where: { userId: user.id },
      orderBy: { sortOrder: 'asc' },
    });
    return json({ sessions: rows });
  } catch (error) {
    return handleRouteError(error);
  }
}

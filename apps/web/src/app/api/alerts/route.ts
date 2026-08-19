import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { handleRouteError, json, parseBody } from '@/lib/api';
import { ALERT_CHANNELS, ALERT_TYPES } from '@/lib/alerts';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();
    const [alerts, notifications] = await Promise.all([
      prisma.alert.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } }),
      prisma.alertNotification.findMany({
        where: { alert: { userId: user.id } },
        orderBy: { time: 'desc' },
        take: 50,
        include: { alert: { select: { type: true, symbol: true } } },
      }),
    ]);
    return json({ alerts, notifications, types: ALERT_TYPES, channels: ALERT_CHANNELS });
  } catch (error) {
    return handleRouteError(error);
  }
}

const schema = z.object({
  type: z.enum(ALERT_TYPES),
  config: z.record(z.unknown()).default({}),
  channels: z.array(z.enum(ALERT_CHANNELS)).min(1).default(['in-app']),
  oneShot: z.boolean().default(true),
  message: z.string().max(300).default(''),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(request, schema);

    const alert = await prisma.alert.create({
      data: {
        userId: user.id,
        type: body.type,
        config: body.config as object,
        channels: body.channels,
        oneShot: body.oneShot,
        message: body.message,
      },
    });

    return json({ alert });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(
      request,
      z.object({ id: z.string(), enabled: z.boolean().optional(), markRead: z.boolean().optional() }),
    );

    if (body.markRead) {
      await prisma.alertNotification.updateMany({
        where: { alertId: body.id, alert: { userId: user.id } },
        data: { read: true },
      });
    }
    if (body.enabled !== undefined) {
      await prisma.alert.updateMany({
        where: { id: body.id, userId: user.id },
        data: { enabled: body.enabled },
      });
    }

    return json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return json({ error: 'An alert id is required.' }, { status: 422 });
    await prisma.alert.deleteMany({ where: { id, userId: user.id } });
    return json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

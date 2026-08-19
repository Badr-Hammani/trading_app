import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { handleRouteError, json, parseBody } from '@/lib/api';
import { loadUserContext } from '@/lib/context';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();
    const versions = await prisma.strategyVersion.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { trades: true, backtestRuns: true, setups: true } },
      },
    });
    return json({ versions });
  } catch (error) {
    return handleRouteError(error);
  }
}

const schema = z.object({
  version: z.string().min(1).max(20),
  name: z.string().min(1).max(120),
  notes: z.string().max(2000).default(''),
  activate: z.boolean().default(true),
  rules: z.record(z.unknown()).optional(),
});

/**
 * Create a new strategy version.
 *
 * Rules are snapshotted rather than edited in place, so a trade taken under
 * v1.1 always keeps v1.1's rules. Historical results are never silently
 * recomputed under a rule set that did not exist at the time.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(request, schema);
    const context = await loadUserContext(user.id);

    const existing = await prisma.strategyVersion.findUnique({
      where: { userId_version: { userId: user.id, version: body.version } },
    });
    if (existing) return json({ error: `Version ${body.version} already exists.` }, { status: 409 });

    const version = await prisma.strategyVersion.create({
      data: {
        userId: user.id,
        version: body.version,
        name: body.name,
        notes: body.notes,
        rules: (body.rules ?? context.rules) as object,
        isActive: body.activate,
      },
    });

    if (body.activate) {
      await prisma.$transaction([
        prisma.strategyVersion.updateMany({
          where: { userId: user.id, id: { not: version.id } },
          data: { isActive: false },
        }),
        prisma.userSettings.upsert({
          where: { userId: user.id },
          update: { activeStrategyVersion: body.version },
          create: { userId: user.id, activeStrategyVersion: body.version },
        }),
      ]);
    }

    return json({ version });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(request, z.object({ id: z.string(), activate: z.literal(true) }));

    const version = await prisma.strategyVersion.findFirst({
      where: { id: body.id, userId: user.id },
    });
    if (!version) return json({ error: 'Version not found.' }, { status: 404 });

    await prisma.$transaction([
      prisma.strategyVersion.updateMany({ where: { userId: user.id }, data: { isActive: false } }),
      prisma.strategyVersion.update({ where: { id: version.id }, data: { isActive: true } }),
      prisma.userSettings.upsert({
        where: { userId: user.id },
        update: { activeStrategyVersion: version.version },
        create: { userId: user.id, activeStrategyVersion: version.version },
      }),
    ]);

    return json({ version: { ...version, isActive: true } });
  } catch (error) {
    return handleRouteError(error);
  }
}

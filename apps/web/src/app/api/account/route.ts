import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { handleRouteError, json, parseBody } from '@/lib/api';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();
    const [accounts, instruments] = await Promise.all([
      prisma.account.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } }),
      prisma.instrument.findMany({ orderBy: { symbol: 'asc' } }),
    ]);
    return json({ accounts, instruments });
  } catch (error) {
    return handleRouteError(error);
  }
}

const accountSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(80),
  broker: z.string().max(80).default(''),
  currency: z.string().min(3).max(3).default('USD'),
  balance: z.number().min(0),
  isDefault: z.boolean().default(true),
});

export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(request, accountSchema);

    const account = body.id
      ? await prisma.account.update({
          where: { id: body.id },
          data: { name: body.name, broker: body.broker, currency: body.currency, balance: body.balance },
        })
      : await prisma.account.create({ data: { ...body, userId: user.id } });

    if (body.isDefault) {
      await prisma.account.updateMany({
        where: { userId: user.id, id: { not: account.id } },
        data: { isDefault: false },
      });
      await prisma.account.update({ where: { id: account.id }, data: { isDefault: true } });
    }

    return json({ account });
  } catch (error) {
    return handleRouteError(error);
  }
}

const instrumentSchema = z.object({
  symbol: z.string().min(1).max(20),
  displayName: z.string().min(1).max(80),
  contractSize: z.number().positive(),
  tickSize: z.number().positive(),
  tickValue: z.number().positive(),
  pricePrecision: z.number().int().min(0).max(8),
  minLot: z.number().positive(),
  maxLot: z.number().positive(),
  lotStep: z.number().positive(),
  quoteCurrency: z.string().min(3).max(3),
  brokerNote: z.string().max(300).default(''),
});

/**
 * Contract specification.
 *
 * Editable because gold specs differ between brokers, and sizing computed
 * against the wrong contract size is wrong by a factor of ten.
 */
export async function PATCH(request: Request) {
  try {
    await requireUser();
    const body = await parseBody(request, instrumentSchema);

    const instrument = await prisma.instrument.upsert({
      where: { symbol: body.symbol },
      update: body,
      create: body,
    });

    return json({ instrument });
  } catch (error) {
    return handleRouteError(error);
  }
}

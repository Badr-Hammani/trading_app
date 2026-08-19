import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { handleRouteError, json, parseBody } from '@/lib/api';
import { providerEnv } from '@/lib/env';
import { describeProviders } from '@xau/providers';
import { isValidTimezone, SAFETY_NOTICES } from '@xau/core';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();
    const [settings, account, instrument, sessions, versions] = await Promise.all([
      prisma.userSettings.findUnique({ where: { userId: user.id } }),
      prisma.account.findFirst({ where: { userId: user.id, isDefault: true } }),
      prisma.instrument.findUnique({ where: { symbol: 'XAUUSD' } }),
      prisma.tradingSession.findMany({ where: { userId: user.id }, orderBy: { sortOrder: 'asc' } }),
      prisma.strategyVersion.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } }),
    ]);

    return json({
      user,
      settings,
      account,
      instrument,
      sessions,
      strategyVersions: versions,
      // Booleans only: a key never reaches the browser.
      providers: describeProviders(providerEnv()),
      safety: SAFETY_NOTICES,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

const schema = z.object({
  timezone: z.string().optional(),
  displayName: z.string().min(1).max(80).optional(),
  defaultRiskPercent: z.number().min(0.01).max(100).optional(),
  maxRiskPercent: z.number().min(0.01).max(100).optional(),
  minDisplacementScore: z.number().int().min(0).max(100).optional(),
  requireChoch: z.boolean().optional(),
  requireFvgAfterStructure: z.boolean().optional(),
  maxFvgMitigation: z.number().min(0).max(1).optional(),
  sensitivity: z.enum(['conservative', 'balanced', 'sensitive']).optional(),
  enforceSessionFilter: z.boolean().optional(),
  newsFilterEnabled: z.boolean().optional(),
  newsWindowMinutes: z.number().int().min(1).max(240).optional(),
  maxBarsFromStructureBreak: z.number().int().min(1).max(500).optional(),
  manualBlockActive: z.boolean().optional(),
  manualBlockReason: z.string().max(300).optional(),
  aiBiasSuggestionEnabled: z.boolean().optional(),
  aiAssistantEnabled: z.boolean().optional(),
  browserNotifications: z.boolean().optional(),
  telegramEnabled: z.boolean().optional(),
  telegramChatId: z.string().max(64).nullable().optional(),
  emailAlertsEnabled: z.boolean().optional(),
  activeStrategyVersion: z.string().optional(),
});

export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(request, schema);
    const { timezone, displayName, ...settings } = body;

    if (timezone && !isValidTimezone(timezone)) {
      return json({ error: `"${timezone}" is not a recognised IANA timezone.` }, { status: 422 });
    }

    if (timezone || displayName) {
      await prisma.user.update({
        where: { id: user.id },
        data: { ...(timezone ? { timezone } : {}), ...(displayName ? { displayName } : {}) },
      });
    }

    const updated = Object.keys(settings).length
      ? await prisma.userSettings.upsert({
          where: { userId: user.id },
          update: settings,
          create: { userId: user.id, ...settings },
        })
      : await prisma.userSettings.findUnique({ where: { userId: user.id } });

    return json({ settings: updated });
  } catch (error) {
    return handleRouteError(error);
  }
}

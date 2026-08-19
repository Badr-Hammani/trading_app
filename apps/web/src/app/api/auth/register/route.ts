import { z } from 'zod';
import { prisma } from '@/lib/db';
import { createSession, hashPassword } from '@/lib/auth';
import { apiError, handleRouteError, json, parseBody } from '@/lib/api';
import { env } from '@/lib/env';
import { DEFAULT_SESSIONS, DEFAULT_STRATEGY_RULES, XAUUSD_DEFAULT_SPEC, isValidTimezone } from '@xau/core';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(10, 'Use at least 10 characters.'),
  displayName: z.string().min(1).max(80),
  timezone: z.string().default(env.defaultTimezone),
});

/**
 * Registration also provisions the trader's starting configuration: the
 * default sessions (London and New York permitted, Asian tracked but not),
 * the XAUUSD contract spec and strategy version v1.0.
 */
export async function POST(request: Request) {
  try {
    const body = await parseBody(request, schema);

    if (!isValidTimezone(body.timezone)) {
      return apiError(`"${body.timezone}" is not a recognised IANA timezone.`, 422);
    }

    const existing = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (existing) return apiError('An account with that email already exists.', 409);

    const user = await prisma.user.create({
      data: {
        email: body.email.toLowerCase(),
        passwordHash: await hashPassword(body.password),
        displayName: body.displayName,
        timezone: body.timezone,
        settings: { create: {} },
        tradingSessions: {
          create: DEFAULT_SESSIONS.map((session, index) => ({
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
        },
        strategyVersions: {
          create: {
            version: 'v1.0',
            name: 'Liquidity sweep → displacement → structure → FVG',
            rules: { ...DEFAULT_STRATEGY_RULES },
            isActive: true,
            notes:
              'Starting rule set. Editing rules creates a new version so historical results keep the rules they were taken under.',
          },
        },
        accounts: {
          create: { name: 'Main account', currency: 'USD', balance: 10000, isDefault: true },
        },
      },
    });

    await prisma.instrument.upsert({
      where: { symbol: XAUUSD_DEFAULT_SPEC.symbol },
      update: {},
      create: {
        symbol: XAUUSD_DEFAULT_SPEC.symbol,
        displayName: XAUUSD_DEFAULT_SPEC.displayName,
        contractSize: XAUUSD_DEFAULT_SPEC.contractSize,
        tickSize: XAUUSD_DEFAULT_SPEC.tickSize,
        tickValue: XAUUSD_DEFAULT_SPEC.tickValue,
        pricePrecision: XAUUSD_DEFAULT_SPEC.pricePrecision,
        minLot: XAUUSD_DEFAULT_SPEC.minLot,
        maxLot: XAUUSD_DEFAULT_SPEC.maxLot,
        lotStep: XAUUSD_DEFAULT_SPEC.lotStep,
        quoteCurrency: XAUUSD_DEFAULT_SPEC.quoteCurrency,
        brokerNote: 'Default 100 oz contract. Confirm this against your own broker before sizing.',
      },
    });

    await createSession(user.id, request.headers.get('user-agent') ?? undefined);

    return json({
      user: { id: user.id, email: user.email, displayName: user.displayName, timezone: user.timezone },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

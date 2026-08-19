import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { handleRouteError, json, parseBody } from '@/lib/api';
import { loadUserContext } from '@/lib/context';
import { calculateRisk, liveTradeState, sessionLabelAt } from '@xau/core';

export const dynamic = 'force-dynamic';

/** Open trades come back with live metrics; closed trades with their result. */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const context = await loadUserContext(user.id);
    const url = new URL(request.url);
    const status = url.searchParams.get('status');

    const trades = await prisma.trade.findMany({
      where: { userId: user.id, ...(status ? { status } : {}) },
      orderBy: { openedAt: 'desc' },
      take: Number(url.searchParams.get('limit') ?? 200),
      include: {
        executions: { orderBy: { time: 'asc' } },
        managementEvents: { orderBy: { time: 'asc' } },
        journalEntry: true,
        setup: { select: { id: true, checklist: true, status: true } },
      },
    });

    const quote = trades.some((trade) => trade.status === 'open')
      ? await context.providers.marketData.getQuote(context.symbol)
      : null;
    const price = quote?.status === 'ok' ? quote.data.mid : null;

    const enriched = trades.map((trade) => {
      if (trade.status !== 'open' || price === null) return { ...trade, live: null };
      return {
        ...trade,
        live: liveTradeState({
          direction: trade.direction as 'long' | 'short',
          entry: trade.entry,
          originalStop: trade.initialStop,
          currentStop: trade.currentStop,
          takeProfit1: trade.takeProfit1,
          takeProfit2: trade.takeProfit2,
          takeProfit3: trade.takeProfit3,
          originalLots: trade.lotSize,
          remainingLots: trade.remainingLots,
          realisedPnl: trade.realisedPnl,
          currentPrice: price,
          instrument: context.instrument,
        }),
      };
    });

    return json({
      trades: enriched,
      currentPrice: price,
      priceAvailable: quote === null || quote.status === 'ok',
      priceUnavailableReason: quote && quote.status === 'unavailable' ? quote.message : null,
      instrument: context.instrument,
      currency: context.accountCurrency,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

const createSchema = z.object({
  setupId: z.string().nullable().optional(),
  direction: z.enum(['long', 'short']),
  entry: z.number(),
  stopLoss: z.number(),
  takeProfit1: z.number().nullable().optional(),
  takeProfit2: z.number().nullable().optional(),
  takeProfit3: z.number().nullable().optional(),
  riskPercent: z.number().positive(),
  lotSize: z.number().positive().nullable().optional(),
  managementModel: z.string().default('A'),
  entryModel: z.string().nullable().optional(),
  openedAt: z.number().int().optional(),
  notes: z.string().max(2000).default(''),
});

/**
 * Record a trade the trader placed with their broker.
 *
 * The application never sends an order anywhere. This is a record of a
 * decision already made, which is what the journal and the statistics measure.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(request, createSchema);
    const context = await loadUserContext(user.id);
    const openedAt = body.openedAt ?? Math.floor(Date.now() / 1000);

    const risk = calculateRisk({
      accountBalance: context.accountBalance,
      riskPercent: body.riskPercent,
      entry: body.entry,
      stopLoss: body.stopLoss,
      takeProfit1: body.takeProfit1 ?? null,
      takeProfit2: body.takeProfit2 ?? null,
      takeProfit3: body.takeProfit3 ?? null,
      direction: body.direction,
      instrument: context.instrument,
      manualLotSize: body.lotSize ?? null,
      maxRiskPercent: context.rules.maxRiskPercent,
    });

    if (!risk.valid) {
      return json({ error: risk.errors.join(' ') || risk.warnings.join(' '), risk }, { status: 422 });
    }

    const [account, instrument, setup, activeVersion] = await Promise.all([
      prisma.account.findFirst({ where: { userId: user.id, isDefault: true } }),
      prisma.instrument.findUnique({ where: { symbol: context.symbol } }),
      body.setupId ? prisma.setup.findFirst({ where: { id: body.setupId, userId: user.id } }) : null,
      prisma.strategyVersion.findFirst({ where: { userId: user.id, isActive: true } }),
    ]);

    const trade = await prisma.trade.create({
      data: {
        userId: user.id,
        accountId: account?.id ?? null,
        instrumentId: instrument?.id ?? null,
        setupId: setup?.id ?? null,
        symbol: context.symbol,
        direction: body.direction,
        status: 'open',
        openedAt: new Date(openedAt * 1000),
        session: sessionLabelAt(context.sessions, openedAt),
        entry: body.entry,
        initialStop: body.stopLoss,
        currentStop: body.stopLoss,
        takeProfit1: body.takeProfit1 ?? null,
        takeProfit2: body.takeProfit2 ?? null,
        takeProfit3: body.takeProfit3 ?? null,
        riskPercent: risk.actualRiskPercent,
        riskAmount: risk.actualRiskAmount,
        lotSize: risk.lotSize,
        remainingLots: risk.lotSize,
        htfBias: setup ? `4H ${setup.htfBias4h} / 1H ${setup.htfBias1h}` : '',
        setupType: setup?.setupType ?? null,
        liquidityType: setup?.liquidityType ?? null,
        fvgTimeframe: setup?.fvgTimeframe ?? null,
        fvgQuality: setup?.fvgQuality ?? null,
        sweepPresent: Boolean(setup?.liquidityType),
        displacementScore: setup?.displacementScore ?? null,
        structureKind: setup?.structureKind ?? null,
        entryModel: body.entryModel ?? null,
        managementModel: body.managementModel,
        newsPresent: setup?.newsPresent ?? false,
        strategyVersionId: activeVersion?.id ?? null,
        executions: {
          create: {
            kind: 'entry',
            time: new Date(openedAt * 1000),
            price: body.entry,
            lots: risk.lotSize,
            percent: 100,
            reason: 'Entry',
          },
        },
        journalEntry: { create: { userId: user.id, notes: body.notes } },
      },
      include: { executions: true, journalEntry: true },
    });

    if (setup) {
      await prisma.setup.update({ where: { id: setup.id }, data: { status: 'executed' } });
    }

    return json({ trade, risk });
  } catch (error) {
    return handleRouteError(error);
  }
}

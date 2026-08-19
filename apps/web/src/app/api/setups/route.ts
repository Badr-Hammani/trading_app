import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { handleRouteError, json, parseBody } from '@/lib/api';
import { loadBias, loadCandles, loadUserContext } from '@/lib/context';
import { analyse } from '@/lib/analysis';
import { rowToEvent, rowToLiquidity } from '@/lib/serialize';
import {
  BIASES,
  checklistFor,
  startOfLocalDay,
  summariseChecklist,
  TIMEFRAMES,
  type Bias,
  type Timeframe,
} from '@xau/core';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const status = url.searchParams.get('status');

    const setups = await prisma.setup.findMany({
      where: { userId: user.id, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { trade: { select: { id: true, status: true, resultR: true } } },
    });

    return json({ setups });
  } catch (error) {
    return handleRouteError(error);
  }
}

const createSchema = z.object({
  direction: z.enum(['long', 'short']),
  checklist: z.record(z.boolean()).default({}),
  entry: z.number().nullable().optional(),
  stopLoss: z.number().nullable().optional(),
  takeProfit1: z.number().nullable().optional(),
  takeProfit2: z.number().nullable().optional(),
  takeProfit3: z.number().nullable().optional(),
  riskPercent: z.number().nullable().optional(),
  lotSize: z.number().nullable().optional(),
  notes: z.string().max(2000).default(''),
  setupType: z.string().max(120).nullable().optional(),
  liquidityLevelIds: z.array(z.string()).default([]),
  fvgZoneIds: z.array(z.string()).default([]),
  bias: z.record(z.enum(TIMEFRAMES), z.enum(BIASES)).optional(),
  at: z.number().int().optional(),
});

/**
 * Save a setup.
 *
 * Creating a setup records a decision to watch, never an order. The status the
 * engine computed is stored alongside the trader's checklist so the journal
 * can later compare what the app saw with what the trader ticked.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(request, createSchema);
    const context = await loadUserContext(user.id);
    const at = body.at ?? Math.floor(Date.now() / 1000);

    const candles = await loadCandles(context, '5M', 600);
    const dayStart = new Date(startOfLocalDay(at, context.timezone) * 1000);

    const [levelRows, eventRows, storedBias] = await Promise.all([
      prisma.liquidityLevel.findMany({ where: { userId: user.id, symbol: context.symbol } }),
      prisma.economicEvent.findMany({
        where: {
          time: { gte: new Date((at - 86400) * 1000), lte: new Date((at + 2 * 86400) * 1000) },
          OR: [{ userId: user.id }, { userId: null }],
        },
      }),
      loadBias(user.id, context.symbol, dayStart),
    ]);

    const bias = { ...(storedBias as Partial<Record<Timeframe, Bias>>), ...(body.bias ?? {}) };

    const analysis =
      candles.status === 'ok'
        ? analyse({
            context,
            candles: candles.data.candles.filter((candle) => candle.time <= at),
            timeframe: '5M',
            at,
            manualLevels: levelRows.map(rowToLiquidity),
            events: eventRows.map(rowToEvent),
            bias,
          })
        : null;

    const evaluation = analysis
      ? body.direction === 'long'
        ? analysis.long
        : analysis.short
      : null;

    // The checklist the trader submitted governs qualification, not the engine.
    const checklistState = body.checklist;
    for (const item of checklistFor(body.direction)) {
      if (!(item.id in checklistState)) checklistState[item.id] = false;
    }
    const summary = summariseChecklist(body.direction, checklistState);

    const activeVersion = await prisma.strategyVersion.findFirst({
      where: { userId: user.id, isActive: true },
    });

    const setup = await prisma.setup.create({
      data: {
        userId: user.id,
        symbol: context.symbol,
        direction: body.direction,
        status: summary.qualified ? (evaluation?.setupStatus ?? 'qualified') : 'forming',
        session: evaluation?.sessionName ?? '',
        checklist: checklistState,
        evaluation: evaluation ? JSON.parse(JSON.stringify(evaluation)) : undefined,
        missingConditions: summary.missing,
        htfBias4h: bias['4H'] ?? 'neutral',
        htfBias1h: bias['1H'] ?? 'neutral',
        bias30m: bias['30M'] ?? 'neutral',
        structure15m: bias['15M'] ?? 'neutral',
        structure5m: bias['5M'] ?? 'neutral',
        setupType: body.setupType ?? (evaluation?.structureBreak.kind ? `Sweep + ${evaluation.structureBreak.kind}` : null),
        liquidityType: evaluation?.liquiditySweep.levelType ?? null,
        fvgTimeframe: evaluation?.fvg.timeframe ?? null,
        fvgQuality: evaluation?.fvg.quality ?? null,
        displacementScore: evaluation?.displacement.score ?? null,
        structureKind: evaluation?.structureBreak.kind ?? null,
        entry: body.entry ?? null,
        stopLoss: body.stopLoss ?? null,
        takeProfit1: body.takeProfit1 ?? null,
        takeProfit2: body.takeProfit2 ?? null,
        takeProfit3: body.takeProfit3 ?? null,
        riskPercent: body.riskPercent ?? null,
        lotSize: body.lotSize ?? null,
        sessionValid: evaluation?.sessionValid ?? false,
        newsPresent: evaluation?.newsRisk.eventNearby ?? false,
        newsNote: evaluation?.newsRisk.message ?? '',
        notes: body.notes,
        strategyVersionId: activeVersion?.id ?? null,
        ...(body.liquidityLevelIds.length
          ? { liquidityLevels: { connect: body.liquidityLevelIds.map((id) => ({ id })) } }
          : {}),
        ...(body.fvgZoneIds.length
          ? { fvgZones: { connect: body.fvgZoneIds.map((id) => ({ id })) } }
          : {}),
      },
    });

    return json({ setup, summary, evaluation });
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
        checklist: z.record(z.boolean()).optional(),
        status: z.string().optional(),
        notes: z.string().max(2000).optional(),
        entry: z.number().nullable().optional(),
        stopLoss: z.number().nullable().optional(),
        takeProfit1: z.number().nullable().optional(),
        takeProfit2: z.number().nullable().optional(),
        takeProfit3: z.number().nullable().optional(),
        riskPercent: z.number().nullable().optional(),
        lotSize: z.number().nullable().optional(),
      }),
    );

    const { id, ...data } = body;
    const existing = await prisma.setup.findFirst({ where: { id, userId: user.id } });
    if (!existing) return json({ error: 'Setup not found.' }, { status: 404 });

    const summary = data.checklist
      ? summariseChecklist(existing.direction as 'long' | 'short', data.checklist)
      : null;

    const setup = await prisma.setup.update({
      where: { id },
      data: {
        ...data,
        ...(summary ? { missingConditions: summary.missing } : {}),
      },
    });

    return json({ setup, summary });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return json({ error: 'A setup id is required.' }, { status: 422 });
    await prisma.setup.deleteMany({ where: { id, userId: user.id } });
    return json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { handleRouteError, json, parseBody } from '@/lib/api';
import { loadCandles, loadUserContext } from '@/lib/context';
import { ENTRY_MODELS, MANAGEMENT_MODELS, runExperimentMatrix, TIMEFRAMES } from '@xau/core';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const schema = z.object({
  name: z.string().min(1).max(120),
  question: z.string().max(500).default(''),
  timeframe: z.enum(TIMEFRAMES).default('5M'),
  from: z.number().int(),
  to: z.number().int(),
  entryModels: z.array(z.enum(['A', 'B', 'C', 'D'])).default(['A', 'B', 'C', 'D']),
  managementModels: z.array(z.string()).default(['A', 'B', 'C', 'D']),
  riskPercent: z.number().positive().default(0.5),
  enforceSessionFilter: z.boolean().default(true),
  minimumTradesForRanking: z.number().int().min(1).default(20),
});

/**
 * The Strategy Lab.
 *
 * Runs every entry model against every management model on the same candles,
 * so "does the second continuation break earn its lower trade count?" is
 * answered by the same data rather than by recollection.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(request, schema);
    const context = await loadUserContext(user.id);

    const candles = await loadCandles(context, body.timeframe, 100_000, body.from, body.to);
    if (candles.status !== 'ok') {
      return json(
        {
          error: `No candle data for that window: ${candles.message}`,
          hint: 'Import history under Settings → Data first.',
        },
        { status: 409 },
      );
    }

    const matrix = runExperimentMatrix({
      candles: candles.data.candles,
      entryModels: body.entryModels,
      managementModels: body.managementModels,
      minimumTradesForRanking: body.minimumTradesForRanking,
      base: {
        timeframe: body.timeframe,
        instrument: context.instrument,
        sessions: context.sessions,
        rules: context.rules,
        accountBalance: context.accountBalance || 10_000,
        riskPercent: body.riskPercent,
        targetsR: [1, 2, 3],
        stopBufferAtr: 0.05,
        timezone: context.timezone,
        enforceSessionFilter: body.enforceSessionFilter,
        warmupBars: 60,
        strategyVersion: context.strategyVersion,
      },
    });

    const activeVersion = await prisma.strategyVersion.findFirst({
      where: { userId: user.id, isActive: true },
    });

    const experiment = await prisma.strategyExperiment.create({
      data: {
        userId: user.id,
        name: body.name,
        kind: body.entryModels.length > 1 ? 'entry' : 'management',
        question: body.question,
        config: JSON.parse(JSON.stringify(body)),
        summary: JSON.parse(
          JSON.stringify({
            bestByExpectancy: matrix.bestByExpectancy,
            bestByProfitFactor: matrix.bestByProfitFactor,
            lowestDrawdown: matrix.lowestDrawdown,
          }),
        ),
        caveat: matrix.caveat,
        strategyVersionId: activeVersion?.id ?? null,
        cells: {
          create: matrix.cells.map((cell) => ({
            entryModel: cell.entryModel,
            managementModel: cell.managementModel,
            statistics: JSON.parse(JSON.stringify(cell.statistics)),
            tradeCount: cell.tradeCount,
            runnerSurvivalRate: cell.runnerSurvivalRate,
          })),
        },
      },
      include: { cells: true },
    });

    return json({ experiment, matrix });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function GET() {
  try {
    const user = await requireUser();
    const experiments = await prisma.strategyExperiment.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { cells: true, strategyVersion: { select: { version: true } } },
    });

    return json({
      experiments,
      entryModels: Object.values(ENTRY_MODELS),
      managementModels: MANAGEMENT_MODELS,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

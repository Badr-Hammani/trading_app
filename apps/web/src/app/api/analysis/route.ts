import { requireUser } from '@/lib/auth';
import { loadBias, loadCandles, loadUserContext } from '@/lib/context';
import { analyse, checklistFromEvaluation, dominantSide } from '@/lib/analysis';
import { handleRouteError, json, searchNumber, searchString } from '@/lib/api';
import { prisma } from '@/lib/db';
import { rowToLiquidity, rowToEvent } from '@/lib/serialize';
import { isTimeframe, startOfLocalDay, type Bias, type Timeframe } from '@xau/core';
import { DateTime } from 'luxon';

export const dynamic = 'force-dynamic';

/**
 * The full picture for one instant: structure, FVGs, liquidity, displacement
 * and both directional evaluations. Everything the dashboard renders comes
 * from this one call, so the UI never derives trading logic of its own.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const timeframe = searchString(url, 'timeframe', '5M')!;
    if (!isTimeframe(timeframe)) return json({ error: `Unknown timeframe "${timeframe}".` }, { status: 422 });

    const context = await loadUserContext(user.id);
    const at = searchNumber(url, 'at') ?? Math.floor(Date.now() / 1000);
    const providerParam = searchString(url, 'provider');
    const isHistoricalAt = searchNumber(url, 'at') !== undefined || providerParam === 'local' || providerParam === 'csv';

    const candlesResult = await loadCandles(
      context,
      timeframe,
      searchNumber(url, 'limit') ?? 600,
      undefined,
      isHistoricalAt ? at : undefined,
      isHistoricalAt,
    );
    if (candlesResult.status !== 'ok') {
      return json({ dataAvailable: false, candles: candlesResult, timezone: context.timezone });
    }

    // Replay and historical review must not see beyond the reference instant.
    const candles = candlesResult.data.candles.filter((candle) => candle.time <= at);

    const dayStart = new Date(startOfLocalDay(at, context.timezone) * 1000);
    const [levelRows, eventRows, biasMap] = await Promise.all([
      prisma.liquidityLevel.findMany({ where: { userId: user.id, symbol: context.symbol } }),
      prisma.economicEvent.findMany({
        where: {
          time: { gte: new Date((at - 86400) * 1000), lte: new Date((at + 3 * 86400) * 1000) },
          OR: [{ userId: user.id }, { userId: null }],
        },
        orderBy: { time: 'asc' },
      }),
      loadBias(user.id, context.symbol, dayStart),
    ]);

    const bias = biasMap as Partial<Record<Timeframe, Bias>>;

    const analysis = analyse({
      context,
      candles,
      timeframe,
      at,
      manualLevels: levelRows.filter((r) => r.manual).map(rowToLiquidity),
      events: eventRows.map(rowToEvent),
      bias,
    });

    const dominant = dominantSide(analysis);

    return json({
      dataAvailable: true,
      timezone: context.timezone,
      symbol: context.symbol,
      timeframe,
      at,
      price: analysis.price,
      meta: candlesResult.data.meta,
      bias,
      suggestedBias: analysis.suggestedBias,
      biasSuggestionEnabled: context.settings.aiBiasSuggestionEnabled,
      session: analysis.session,
      market: analysis.market,
      liquidity: analysis.liquidity,
      fvgZones: analysis.fvgZones,
      structureEvents: analysis.structureEvents,
      swings: analysis.swings.filter((swing) => swing.major).slice(-40),
      displacement: analysis.displacement.slice(-40),
      long: analysis.long,
      short: analysis.short,
      dominant: {
        direction: dominant.direction,
        checklist: checklistFromEvaluation(dominant.direction, dominant.evaluation),
      },
      strategyVersion: context.strategyVersion,
      generatedAt: DateTime.utc().toISO(),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

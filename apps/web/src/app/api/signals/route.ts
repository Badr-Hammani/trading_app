import { requireUser } from '@/lib/auth';
import { handleRouteError, json } from '@/lib/api';
import { loadCandles, loadUserContext, loadBias } from '@/lib/context';
import { analyse } from '@/lib/analysis';
import { prisma } from '@/lib/db';
import { rowToEvent, rowToLiquidity } from '@/lib/serialize';
import { detectSignals, startOfLocalDay, type Bias, type Timeframe } from '@xau/core';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const context = await loadUserContext(user.id);
    const at = Math.floor(Date.now() / 1000);

    const candlesRes = await loadCandles(context, '5M', 600);
    if (candlesRes.status !== 'ok' || !candlesRes.data.candles.length) {
      return json({ signals: [] });
    }

    const candles = candlesRes.data.candles.filter((c) => c.time <= at);
    const currentPrice = candles[candles.length - 1]?.close ?? 0;
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

    const manualLevels = levelRows.map(rowToLiquidity);
    const events = eventRows.map(rowToEvent);
    const bias = storedBias as Partial<Record<Timeframe, Bias>>;

    const analysis = analyse({
      context,
      candles,
      timeframe: '5M',
      at,
      manualLevels,
      events,
      bias,
    });

    const longSignals = detectSignals({
      at,
      price: currentPrice,
      bias,
      candles,
      executionTimeframe: '5M',
      liquidity: analysis.liquidity,
      fvgZones: analysis.fvgZones,
      structureEvents: analysis.structureEvents,
      displacement: analysis.displacement,
      sessions: context.sessions,
      directionsToTest: ['long'],
    });

    const shortSignals = detectSignals({
      at,
      price: currentPrice,
      bias,
      candles,
      executionTimeframe: '5M',
      liquidity: analysis.liquidity,
      fvgZones: analysis.fvgZones,
      structureEvents: analysis.structureEvents,
      displacement: analysis.displacement,
      sessions: context.sessions,
      directionsToTest: ['short'],
    });

    const signals = [...longSignals, ...shortSignals];

    return json({ signals });
  } catch (error) {
    return handleRouteError(error);
  }
}

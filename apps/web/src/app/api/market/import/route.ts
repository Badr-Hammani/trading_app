import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { apiError, handleRouteError, json } from '@/lib/api';
import { loadUserContext } from '@/lib/context';
import { isTimeframe, parseOhlcvCsv, XAUUSD_DEFAULT_SPEC } from '@xau/core';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * CSV import.
 *
 * This is the path that makes the application usable with no paid API: the
 * charts, replay, backtests and statistics all run on imported history. The
 * quality report is returned rather than swallowed, so the trader sees the
 * duplicates removed and the gaps found.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const context = await loadUserContext(user.id);

    const form = await request.formData();
    const file = form.get('file');
    const timeframe = String(form.get('timeframe') ?? '5M');
    const timezone = String(form.get('timezone') ?? 'UTC');
    const symbol = String(form.get('symbol') ?? context.symbol);
    const timeFormat = String(form.get('timeFormat') ?? '');

    if (!(file instanceof File)) return apiError('No CSV file was uploaded.', 422);
    if (!isTimeframe(timeframe)) return apiError(`Unknown timeframe "${timeframe}".`, 422);

    const text = await file.text();
    const { candles, report } = parseOhlcvCsv(text, {
      timezone,
      timeframe,
      ...(timeFormat ? { timeFormat } : {}),
    });

    if (candles.length === 0) {
      return apiError('No usable rows found in the file.', 422, { report });
    }

    const instrument = await prisma.instrument.upsert({
      where: { symbol },
      update: {},
      create: {
        symbol,
        displayName: symbol === 'XAUUSD' ? XAUUSD_DEFAULT_SPEC.displayName : symbol,
        contractSize: XAUUSD_DEFAULT_SPEC.contractSize,
        tickSize: XAUUSD_DEFAULT_SPEC.tickSize,
        tickValue: XAUUSD_DEFAULT_SPEC.tickValue,
        brokerNote: 'Created by CSV import. Confirm the contract spec against your broker.',
      },
    });

    const series = await prisma.marketDataSeries.upsert({
      where: {
        symbol_timeframe_provider_userId: { symbol, timeframe, provider: 'csv', userId: user.id },
      },
      update: {
        importedFrom: file.name,
        sourceTimezone: timezone,
        firstTime: new Date(candles[0]!.time * 1000),
        lastTime: new Date(candles[candles.length - 1]!.time * 1000),
        duplicatesRemoved: report.duplicatesRemoved,
        gapCount: report.gaps.length,
      },
      create: {
        userId: user.id,
        instrumentId: instrument.id,
        symbol,
        timeframe,
        provider: 'csv',
        sourceTimezone: timezone,
        importedFrom: file.name,
        firstTime: new Date(candles[0]!.time * 1000),
        lastTime: new Date(candles[candles.length - 1]!.time * 1000),
        duplicatesRemoved: report.duplicatesRemoved,
        gapCount: report.gaps.length,
      },
    });

    // Upsert in batches: re-importing an overlapping file corrects existing
    // bars rather than duplicating them.
    const receivedAt = new Date();
    const batchSize = 500;
    for (let start = 0; start < candles.length; start += batchSize) {
      const batch = candles.slice(start, start + batchSize);
      await prisma.$transaction(
        batch.map((candle) =>
          prisma.marketCandle.upsert({
            where: { seriesId_time: { seriesId: series.id, time: new Date(candle.time * 1000) } },
            update: {
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              volume: candle.volume,
              receivedAt,
            },
            create: {
              seriesId: series.id,
              time: new Date(candle.time * 1000),
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              volume: candle.volume,
              sourceTimestamp: new Date(candle.time * 1000),
              receivedAt,
            },
          }),
        ),
      );
    }

    const barCount = await prisma.marketCandle.count({ where: { seriesId: series.id } });
    await prisma.marketDataSeries.update({ where: { id: series.id }, data: { barCount } });

    return json({ imported: candles.length, storedBars: barCount, seriesId: series.id, report });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** List stored series, so Settings → Data can show what is available offline. */
export async function GET() {
  try {
    const user = await requireUser();
    const series = await prisma.marketDataSeries.findMany({
      where: { OR: [{ userId: user.id }, { userId: null }] },
      orderBy: [{ symbol: 'asc' }, { timeframe: 'asc' }],
    });
    return json({ series });
  } catch (error) {
    return handleRouteError(error);
  }
}

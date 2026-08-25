import { requireUser } from '@/lib/auth';
import { loadCandles, loadUserContext } from '@/lib/context';
import { handleRouteError, json, searchNumber, searchString } from '@/lib/api';
import { isTimeframe, findGaps } from '@xau/core';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const timeframe = searchString(url, 'timeframe', '5M')!;

    if (!isTimeframe(timeframe)) {
      return json({ error: `Unknown timeframe "${timeframe}".` }, { status: 422 });
    }

    const context = await loadUserContext(user.id);
    const limit = searchNumber(url, 'limit') ?? 500;
    const providerParam = searchString(url, 'provider');
    const preferLocal = providerParam === 'local' || providerParam === 'csv';

    const result = await loadCandles(
      context,
      timeframe,
      limit,
      searchNumber(url, 'from'),
      searchNumber(url, 'to'),
      preferLocal,
    );

    if (result.status !== 'ok') return json({ result, quality: null });

    // Data-quality summary travels with the series so the chart can warn about
    // holes instead of drawing over them.
    const gaps = findGaps(result.data.candles, timeframe);
    const newest = result.data.candles[result.data.candles.length - 1];
    const ageSeconds = newest ? Math.floor(Date.now() / 1000) - newest.time : null;

    return json({
      result,
      quality: {
        bars: result.data.candles.length,
        gaps: gaps.length,
        gapDetail: gaps.slice(0, 20),
        newestBarTime: newest?.time ?? null,
        ageSeconds,
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

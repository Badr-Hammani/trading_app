import { requireUser } from '@/lib/auth';
import { loadUserContext } from '@/lib/context';
import { handleRouteError, json } from '@/lib/api';
import { dailyChange, marketStatus, sessionStatus } from '@xau/core';

export const dynamic = 'force-dynamic';

/**
 * Live header data. When the provider cannot answer, the unavailable result is
 * passed through untouched so the UI shows DATA UNAVAILABLE with the reason —
 * it is never replaced with a last-known price.
 */
export async function GET() {
  try {
    const user = await requireUser();
    const context = await loadUserContext(user.id);
    const at = Math.floor(Date.now() / 1000);

    const quote = await context.providers.marketData.getQuote(context.symbol);

    return json({
      symbol: context.symbol,
      timezone: context.timezone,
      at,
      quote,
      change: quote.status === 'ok' ? dailyChange(quote.data) : null,
      session: sessionStatus(context.sessions, at),
      market: marketStatus(at),
      manualBlock: context.manualBlock,
      provider: context.providers.marketData.info,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { handleRouteError, json, searchNumber } from '@/lib/api';
import { loadUserContext } from '@/lib/context';
import { computeStatistics, newsImpactAnalysis, standardBreakdowns } from '@xau/core';
import { tradeRowsToAnalytics } from '@/lib/analyticsMap';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const context = await loadUserContext(user.id);
    const url = new URL(request.url);

    const from = searchNumber(url, 'from');
    const to = searchNumber(url, 'to');

    const rows = await prisma.trade.findMany({
      where: {
        userId: user.id,
        ...(from || to
          ? {
              openedAt: {
                ...(from ? { gte: new Date(from * 1000) } : {}),
                ...(to ? { lte: new Date(to * 1000) } : {}),
              },
            }
          : {}),
      },
      orderBy: { openedAt: 'asc' },
    });

    const trades = tradeRowsToAnalytics(rows, context.timezone);
    const statistics = computeStatistics(trades);

    const missed = await prisma.missedSetup.findMany({ where: { userId: user.id } });
    const missedWithOutcome = missed.filter((entry) => entry.hypotheticalR !== null);
    const missedExpectancy =
      missedWithOutcome.length > 0
        ? missedWithOutcome.reduce((sum, entry) => sum + (entry.hypotheticalR ?? 0), 0) /
          missedWithOutcome.length
        : null;

    return json({
      statistics,
      breakdowns: standardBreakdowns(trades),
      newsImpact: newsImpactAnalysis(trades),
      missed: {
        total: missed.length,
        withOutcome: missedWithOutcome.length,
        expectancyR: missedExpectancy,
        byReason: Object.entries(
          missed.reduce<Record<string, number>>((acc, entry) => {
            acc[entry.reason] = (acc[entry.reason] ?? 0) + 1;
            return acc;
          }, {}),
        ).map(([reason, count]) => ({ reason, count })),
        // The comparison that tells the trader whether their filters help.
        verdict:
          missedExpectancy === null || missedWithOutcome.length < 5
            ? `Not enough missed setups with a recorded outcome (${missedWithOutcome.length}) to judge the filters yet.`
            : statistics.expectancyR === null
              ? 'No closed trades to compare against yet.'
              : missedExpectancy > statistics.expectancyR
                ? `Skipped setups averaged ${missedExpectancy.toFixed(2)}R against ${statistics.expectancyR.toFixed(2)}R taken. Worth checking which filter is doing the skipping.`
                : `Skipped setups averaged ${missedExpectancy.toFixed(2)}R against ${statistics.expectancyR.toFixed(2)}R taken. The filters are earning their place.`,
      },
      currency: context.accountCurrency,
      caveat:
        'Statistics describe the sample recorded here. A small sample can look like an edge purely by chance.',
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

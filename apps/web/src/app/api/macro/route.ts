import { requireUser } from '@/lib/auth';
import { loadUserContext } from '@/lib/context';
import { handleRouteError, json } from '@/lib/api';
import { FRED_SERIES, type MacroSeries } from '@xau/providers';
import type { DataResult } from '@xau/core';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Gold macro panel.
 *
 * Relationships are described, never asserted as rules. "DXY up therefore gold
 * down" is exactly the kind of hardcoded shortcut the spec rules out, so this
 * route reports the direction of each series and, where there is enough
 * overlapping data, a rolling correlation the trader can judge for themselves.
 */

const PANEL: { key: keyof typeof FRED_SERIES; group: string }[] = [
  { key: 'GOLD', group: 'Metals' },
  { key: 'SILVER', group: 'Metals' },
  { key: 'DXY', group: 'Dollar' },
  { key: 'US2Y', group: 'Rates' },
  { key: 'US10Y', group: 'Rates' },
  { key: 'REAL10Y', group: 'Rates' },
  { key: 'FEDFUNDS', group: 'Rates' },
  { key: 'CPI', group: 'Inflation' },
  { key: 'CORE_CPI', group: 'Inflation' },
  { key: 'PCE', group: 'Inflation' },
  { key: 'CORE_PCE', group: 'Inflation' },
  { key: 'NFP', group: 'Labour' },
  { key: 'UNEMPLOYMENT', group: 'Labour' },
  { key: 'VIX', group: 'Risk' },
  { key: 'SP500', group: 'Risk' },
  { key: 'NASDAQ', group: 'Risk' },
  { key: 'OIL', group: 'Commodities' },
];

function changeOver(series: MacroSeries, days: number): number | null {
  const points = series.points;
  if (points.length < 2) return null;
  const last = points[points.length - 1]!;
  const cutoff = last.time - days * 86400;
  const earlier = [...points].reverse().find((point) => point.time <= cutoff);
  if (!earlier || earlier.value === 0) return null;
  return ((last.value - earlier.value) / Math.abs(earlier.value)) * 100;
}

/** Pearson correlation of daily changes over the overlapping window. */
function correlation(a: MacroSeries, b: MacroSeries, days: number): number | null {
  const mapB = new Map(b.points.map((point) => [point.time, point.value]));
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

  const pairs: [number, number][] = [];
  for (let i = 1; i < a.points.length; i += 1) {
    const current = a.points[i]!;
    const previous = a.points[i - 1]!;
    if (current.time < cutoff) continue;
    const bCurrent = mapB.get(current.time);
    const bPrevious = mapB.get(previous.time);
    if (bCurrent === undefined || bPrevious === undefined) continue;
    if (previous.value === 0 || bPrevious === 0) continue;
    pairs.push([
      (current.value - previous.value) / Math.abs(previous.value),
      (bCurrent - bPrevious) / Math.abs(bPrevious),
    ]);
  }

  // Too few overlapping observations to say anything honest about correlation.
  if (pairs.length < 20) return null;

  const meanA = pairs.reduce((sum, [x]) => sum + x, 0) / pairs.length;
  const meanB = pairs.reduce((sum, [, y]) => sum + y, 0) / pairs.length;
  let numerator = 0;
  let denomA = 0;
  let denomB = 0;
  for (const [x, y] of pairs) {
    numerator += (x - meanA) * (y - meanB);
    denomA += (x - meanA) ** 2;
    denomB += (y - meanB) ** 2;
  }
  if (denomA === 0 || denomB === 0) return null;
  return numerator / Math.sqrt(denomA * denomB);
}

export async function GET() {
  try {
    const user = await requireUser();
    const context = await loadUserContext(user.id);
    const provider = context.providers.economic;

    if (!provider.getSeries) {
      return json({
        available: false,
        message: 'No macro data provider is configured. Set FRED_API_KEY to populate this panel.',
        series: [],
        relationships: [],
      });
    }

    const from = Math.floor(Date.now() / 1000) - 400 * 86400;
    const results = await Promise.all(
      PANEL.map(async (entry) => ({
        key: entry.key,
        group: entry.group,
        label: FRED_SERIES[entry.key].label,
        seriesId: FRED_SERIES[entry.key].id,
        result: (await provider.getSeries!(FRED_SERIES[entry.key].id, from)) as DataResult<MacroSeries>,
      })),
    );

    const series = results.map((entry) => {
      if (entry.result.status !== 'ok') {
        return {
          key: entry.key,
          group: entry.group,
          label: entry.label,
          seriesId: entry.seriesId,
          available: false,
          reason: entry.result.message,
          latest: null,
          change1d: null,
          change5d: null,
          change30d: null,
          units: null,
          asOf: null,
        };
      }
      const data = entry.result.data;
      const latest = data.points[data.points.length - 1] ?? null;
      return {
        key: entry.key,
        group: entry.group,
        label: entry.label,
        seriesId: entry.seriesId,
        available: true,
        reason: null,
        latest: latest?.value ?? null,
        change1d: changeOver(data, 1),
        change5d: changeOver(data, 5),
        change30d: changeOver(data, 30),
        units: data.units,
        asOf: latest?.time ?? null,
      };
    });

    // Correlations are reported, not interpreted into a rule.
    const gold = results.find((entry) => entry.key === 'GOLD');
    const relationships =
      gold && gold.result.status === 'ok'
        ? results
            .filter((entry) => entry.key !== 'GOLD' && entry.result.status === 'ok')
            .map((entry) => ({
              key: entry.key,
              label: entry.label,
              correlation30d: correlation(gold.result.status === 'ok' ? gold.result.data : ({ points: [] } as unknown as MacroSeries), (entry.result as { data: MacroSeries }).data, 30),
              correlation90d: correlation(gold.result.status === 'ok' ? gold.result.data : ({ points: [] } as unknown as MacroSeries), (entry.result as { data: MacroSeries }).data, 90),
            }))
            .filter((entry) => entry.correlation30d !== null || entry.correlation90d !== null)
        : [];

    return json({
      available: series.some((entry) => entry.available),
      provider: provider.info,
      series,
      relationships,
      note: 'Relationships are observations, not rules. A rising dollar does not compel gold to fall; the correlation is shown so you can judge whether the usual relationship is holding right now.',
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

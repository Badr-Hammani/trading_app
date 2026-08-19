'use client';

import clsx from 'clsx';
import { DataUnavailable, Panel, Spinner, Stat, Tag } from '@/components/ui/Panel';
import { HeaderStrip } from '@/components/panels/HeaderStrip';
import { usePolling } from '@/lib/hooks';
import { useAppStore } from '@/store/app';
import { fmtNumber, fmtPercent, fmtTime } from '@/lib/format';
import type { AnalysisResponse } from '@/lib/types';

interface MacroSeriesRow {
  key: string;
  group: string;
  label: string;
  seriesId: string;
  available: boolean;
  reason: string | null;
  latest: number | null;
  change1d: number | null;
  change5d: number | null;
  change30d: number | null;
  units: string | null;
  asOf: number | null;
}

interface MacroResponse {
  available: boolean;
  message?: string;
  provider?: { name: string; configured: boolean; setupHint?: string };
  series: MacroSeriesRow[];
  relationships: { key: string; label: string; correlation30d: number | null; correlation90d: number | null }[];
  note?: string;
}

/**
 * Gold macro context.
 *
 * Relationships are shown, never enforced. There is no rule here that says a
 * rising dollar must push gold down — only the observed moves and, where
 * there is enough overlapping data, the rolling correlation.
 */
export function MarketView() {
  const { timeframe, refreshMs } = useAppStore();
  const macro = usePolling<MacroResponse>('/api/macro', 15 * 60_000);
  const analysis = usePolling<AnalysisResponse>(`/api/analysis?timeframe=${timeframe}`, refreshMs);

  const timezone = analysis.data?.timezone ?? 'UTC';
  const groups = [...new Set((macro.data?.series ?? []).map((row) => row.group))];

  return (
    <div className="space-y-2 p-2">
      <HeaderStrip newsRisk={analysis.data?.long?.newsRisk ?? null} />

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
        <Panel
          title="Gold context"
          subtitle="What is actually moving right now"
          className="lg:col-span-3"
          bodyClassName="space-y-2"
        >
          {macro.loading ? (
            <Spinner label="Loading macro series" />
          ) : !macro.data?.available ? (
            <DataUnavailable
              reason={macro.data?.message ?? macro.error ?? 'No macro provider configured.'}
              hint="Set FRED_API_KEY in .env to populate DXY, yields, real yields, CPI, PCE, payrolls and VIX. A key is free."
            />
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {(macro.data.series ?? [])
                  .filter((row) => row.available && row.change1d !== null)
                  .slice(0, 8)
                  .map((row) => (
                    <Tag
                      key={row.key}
                      tone={row.change1d! > 0 ? 'bull' : row.change1d! < 0 ? 'bear' : 'neutral'}
                    >
                      {row.key} {row.change1d! > 0 ? 'rising' : row.change1d! < 0 ? 'falling' : 'flat'}
                    </Tag>
                  ))}
              </div>
              <p className="text-2xs leading-relaxed text-ink-500">{macro.data.note}</p>
            </>
          )}
        </Panel>

        {macro.data?.available &&
          groups.map((group) => (
            <Panel key={group} title={group} bodyClassName="p-0">
              <table className="table-dense">
                <thead>
                  <tr>
                    <th>Series</th>
                    <th className="text-right">Latest</th>
                    <th className="text-right">1d</th>
                    <th className="text-right">5d</th>
                    <th className="text-right">30d</th>
                  </tr>
                </thead>
                <tbody>
                  {macro.data!.series
                    .filter((row) => row.group === group)
                    .map((row) => (
                      <tr key={row.key}>
                        <td>
                          <div className="text-xs text-ink-200">{row.key}</div>
                          <div className="truncate text-2xs text-ink-600" title={row.label}>
                            {row.available && row.asOf
                              ? fmtTime(row.asOf, timezone, 'dd LLL')
                              : (row.reason ?? '')}
                          </div>
                        </td>
                        <td className="num text-right">
                          {row.available ? fmtNumber(row.latest, 2) : <span className="text-warn">n/a</span>}
                        </td>
                        <Change value={row.change1d} />
                        <Change value={row.change5d} />
                        <Change value={row.change30d} />
                      </tr>
                    ))}
                </tbody>
              </table>
            </Panel>
          ))}

        {macro.data?.available && macro.data.relationships.length > 0 && (
          <Panel
            title="Rolling correlation with gold"
            subtitle="Daily changes — an observation, not a rule"
            className="lg:col-span-3"
            bodyClassName="p-0"
          >
            <table className="table-dense">
              <thead>
                <tr>
                  <th>Series</th>
                  <th className="text-right">30d</th>
                  <th className="text-right">90d</th>
                  <th>Reading</th>
                </tr>
              </thead>
              <tbody>
                {macro.data.relationships.map((row) => (
                  <tr key={row.key}>
                    <td className="text-xs">{row.label}</td>
                    <td className="num text-right">{fmtNumber(row.correlation30d, 2)}</td>
                    <td className="num text-right">{fmtNumber(row.correlation90d, 2)}</td>
                    <td className="text-2xs text-ink-400">{describeCorrelation(row.correlation30d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
      </div>

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        <Panel title="Structure events" subtitle={`${timeframe} · detected`} bodyClassName="p-0">
          {(analysis.data?.structureEvents ?? []).length === 0 ? (
            <p className="p-3 text-2xs text-ink-500">No structure events in the loaded window.</p>
          ) : (
            <table className="table-dense">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Event</th>
                  <th>Scope</th>
                  <th className="text-right">Level</th>
                </tr>
              </thead>
              <tbody>
                {(analysis.data?.structureEvents ?? [])
                  .slice(-20)
                  .reverse()
                  .map((event) => (
                    <tr key={`${event.time}-${event.brokenLevel}`}>
                      <td className="num text-2xs">{fmtTime(event.time, timezone, 'dd LLL HH:mm')}</td>
                      <td>
                        <Tag tone={event.direction === 'bullish' ? 'bull' : 'bear'}>{event.kind}</Tag>
                      </td>
                      <td className="text-2xs text-ink-400">{event.scope}</td>
                      <td className="num text-right">{fmtNumber(event.brokenLevel, 2)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel
          title="Displacement scores"
          subtitle="Analytical aid — never an entry signal"
          bodyClassName="p-0"
        >
          {(analysis.data?.displacement ?? []).filter((reading) => reading.score >= 40).length === 0 ? (
            <p className="p-3 text-2xs text-ink-500">
              Nothing scoring above 40 in the loaded window.
            </p>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <table className="table-dense">
                <thead className="sticky top-0 bg-ink-900">
                  <tr>
                    <th>Time</th>
                    <th>Dir</th>
                    <th className="text-right">Score</th>
                    <th>Reasons</th>
                  </tr>
                </thead>
                <tbody>
                  {(analysis.data?.displacement ?? [])
                    .filter((reading) => reading.score >= 40)
                    .slice(-20)
                    .reverse()
                    .map((reading) => (
                      <tr key={reading.time}>
                        <td className="num text-2xs">{fmtTime(reading.time, timezone, 'dd LLL HH:mm')}</td>
                        <td>
                          <Tag tone={reading.direction === 'bullish' ? 'bull' : 'bear'}>
                            {reading.direction === 'bullish' ? 'BULL' : 'BEAR'}
                          </Tag>
                        </td>
                        <td
                          className={clsx(
                            'num text-right font-semibold',
                            reading.qualifies ? 'text-bull' : 'text-ink-300',
                          )}
                        >
                          {reading.score}/100
                        </td>
                        <td className="text-2xs leading-relaxed text-ink-400">
                          {reading.reasons.slice(0, 3).join(' · ')}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Session windows" bodyClassName="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Active"
          value={analysis.data?.session?.activeNames.join(', ') || 'None'}
          mono={false}
        />
        <Stat
          label="Execution window"
          value={analysis.data?.session?.executionWindow ? 'OPEN' : 'CLOSED'}
          tone={analysis.data?.session?.executionWindow ? 'bull' : 'warn'}
          mono={false}
        />
        <Stat
          label="Next"
          value={analysis.data?.session?.next?.definition.name ?? '—'}
          mono={false}
        />
        <Stat
          label="Market"
          value={(analysis.data?.market ?? '—').toUpperCase()}
          mono={false}
        />
      </Panel>
    </div>
  );
}

function Change({ value }: { value: number | null }) {
  return (
    <td
      className={clsx(
        'num text-right text-2xs',
        value === null ? 'text-ink-600' : value > 0 ? 'text-bull' : value < 0 ? 'text-bear' : 'text-ink-400',
      )}
    >
      {value === null ? '—' : fmtPercent(value, 2, true)}
    </td>
  );
}

function describeCorrelation(value: number | null): string {
  if (value === null) return 'Not enough overlapping observations';
  const magnitude = Math.abs(value);
  const strength = magnitude > 0.6 ? 'strong' : magnitude > 0.3 ? 'moderate' : 'weak';
  return `${strength} ${value > 0 ? 'positive' : 'negative'}`;
}

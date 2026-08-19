'use client';

import clsx from 'clsx';
import type { GroupedStatistics, Statistics } from '@xau/core';
import { EmptyState, Panel, Spinner, Stat, Tag } from '@/components/ui/Panel';
import { fmtCurrency, fmtNumber, fmtPercent, fmtR } from '@/lib/format';
import { usePolling } from '@/lib/hooks';

interface AnalyticsResponse {
  statistics: Statistics;
  breakdowns: Record<string, GroupedStatistics[]>;
  newsImpact: {
    withNews: Statistics;
    withoutNews: Statistics;
    sampleSufficient: boolean;
    verdict: string;
  };
  missed: {
    total: number;
    withOutcome: number;
    expectancyR: number | null;
    byReason: { reason: string; count: number }[];
    verdict: string;
  };
  currency: string;
  caveat: string;
}

const BREAKDOWN_TITLES: Record<string, string> = {
  session: 'By session',
  direction: 'Long vs short',
  setupType: 'By setup type',
  entryModel: 'By entry model',
  managementModel: 'By management model',
  liquidityType: 'By liquidity type',
  fvgTimeframe: 'By FVG timeframe',
  grade: 'By grade',
  news: 'News vs no news',
  dayOfWeek: 'By day of week',
};

export function AnalyticsView() {
  const analytics = usePolling<AnalyticsResponse>('/api/analytics', 60_000);

  if (analytics.loading && !analytics.data) {
    return (
      <div className="p-4">
        <Spinner label="Computing statistics" />
      </div>
    );
  }

  const data = analytics.data;
  if (!data || data.statistics.trades === 0) {
    return (
      <div className="p-3">
        <EmptyState
          title="No closed trades yet"
          hint="Statistics appear once trades are recorded and closed. Backtest results are shown separately in the Strategy Lab."
        />
      </div>
    );
  }

  const stats = data.statistics;

  return (
    <div className="space-y-2 p-2">
      <Panel title="Performance" subtitle={data.caveat} bodyClassName="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 lg:grid-cols-8">
        <Stat label="Trades" value={stats.trades} />
        <Stat label="Wins" value={stats.wins} tone="bull" />
        <Stat label="Losses" value={stats.losses} tone="bear" />
        <Stat label="Breakevens" value={stats.breakevens} />
        <Stat label="Win rate" value={fmtPercent(stats.winRate, 1)} />
        <Stat
          label="Expectancy"
          value={fmtR(stats.expectancyR)}
          tone={(stats.expectancyR ?? 0) >= 0 ? 'bull' : 'bear'}
        />
        <Stat
          label="Profit factor"
          value={stats.profitFactor === null ? '—' : fmtNumber(stats.profitFactor, 2)}
        />
        <Stat label="Total R" value={fmtR(stats.totalR)} tone={stats.totalR >= 0 ? 'bull' : 'bear'} />
        <Stat label="Average win" value={fmtR(stats.averageWinR)} tone="bull" />
        <Stat label="Average loss" value={fmtR(stats.averageLossR)} tone="bear" />
        <Stat label="Median R" value={fmtR(stats.medianR)} />
        <Stat label="Max drawdown" value={`${fmtNumber(stats.maxDrawdownR, 2)}R`} tone="bear" />
        <Stat label="Max consec. wins" value={stats.maxConsecutiveWins} />
        <Stat label="Max consec. losses" value={stats.maxConsecutiveLosses} tone="bear" />
        <Stat
          label="Sharpe-like"
          value={fmtNumber(stats.sharpeLike, 2)}
          hint="mean R ÷ std dev"
        />
        <Stat
          label="Rule adherence"
          value={fmtPercent(stats.ruleAdherencePercent, 0)}
          tone={(stats.ruleAdherencePercent ?? 100) >= 90 ? 'bull' : 'warn'}
        />
        <Stat label="Total P/L" value={fmtCurrency(stats.totalCurrency, data.currency)} />
        <Stat label="Average MAE" value={fmtNumber(stats.averageMaeR, 2)} />
        <Stat label="Average MFE" value={fmtNumber(stats.averageMfeR, 2)} />
        <Stat label="Largest win" value={fmtR(stats.largestWinR)} tone="bull" />
        <Stat label="Largest loss" value={fmtR(stats.largestLossR)} tone="bear" />
      </Panel>

      {stats.equityCurveR.length > 1 && (
        <Panel title="Equity curve (R)" bodyClassName="p-2">
          <EquityCurve values={stats.equityCurveR} />
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        <Panel
          title="News impact"
          subtitle="Measured, not assumed"
          bodyClassName="space-y-2"
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded border border-ink-700 bg-ink-850 p-2">
              <div className="stat-label">With high-impact news</div>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <Stat label="Trades" value={data.newsImpact.withNews.trades} />
                <Stat label="Expectancy" value={fmtR(data.newsImpact.withNews.expectancyR)} />
                <Stat label="Win rate" value={fmtPercent(data.newsImpact.withNews.winRate, 0)} />
                <Stat label="Avg MAE" value={fmtNumber(data.newsImpact.withNews.averageMaeR, 2)} />
              </div>
            </div>
            <div className="rounded border border-ink-700 bg-ink-850 p-2">
              <div className="stat-label">Without</div>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <Stat label="Trades" value={data.newsImpact.withoutNews.trades} />
                <Stat label="Expectancy" value={fmtR(data.newsImpact.withoutNews.expectancyR)} />
                <Stat label="Win rate" value={fmtPercent(data.newsImpact.withoutNews.winRate, 0)} />
                <Stat label="Avg MAE" value={fmtNumber(data.newsImpact.withoutNews.averageMaeR, 2)} />
              </div>
            </div>
          </div>
          <p
            className={clsx(
              'rounded border px-2 py-1.5 text-2xs leading-relaxed',
              data.newsImpact.sampleSufficient
                ? 'border-ink-700 bg-ink-850 text-ink-300'
                : 'border-warn/40 bg-warn/10 text-warn',
            )}
          >
            {data.newsImpact.verdict}
          </p>
        </Panel>

        <Panel title="Missed setups" subtitle="Do your filters earn their place?" bodyClassName="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Logged" value={data.missed.total} />
            <Stat label="With outcome" value={data.missed.withOutcome} />
            <Stat label="Their avg R" value={fmtR(data.missed.expectancyR)} />
          </div>
          {data.missed.byReason.length > 0 && (
            <table className="table-dense">
              <thead>
                <tr>
                  <th>Reason</th>
                  <th className="text-right">Count</th>
                </tr>
              </thead>
              <tbody>
                {data.missed.byReason.map((row) => (
                  <tr key={row.reason}>
                    <td>{row.reason}</td>
                    <td className="num text-right">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="rounded border border-ink-700 bg-ink-850 px-2 py-1.5 text-2xs leading-relaxed text-ink-300">
            {data.missed.verdict}
          </p>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 xl:grid-cols-3">
        {Object.entries(data.breakdowns)
          .filter(([, groups]) => groups.length > 0)
          .map(([key, groups]) => (
            <Panel key={key} title={BREAKDOWN_TITLES[key] ?? key} bodyClassName="p-0">
              <table className="table-dense">
                <thead>
                  <tr>
                    <th>Group</th>
                    <th className="text-right">n</th>
                    <th className="text-right">Win %</th>
                    <th className="text-right">Exp R</th>
                    <th className="text-right">PF</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <tr key={group.key}>
                      <td className="text-2xs">{group.label}</td>
                      <td className="num text-right text-2xs">{group.statistics.trades}</td>
                      <td className="num text-right text-2xs">
                        {fmtPercent(group.statistics.winRate, 0)}
                      </td>
                      <td
                        className={clsx(
                          'num text-right text-2xs',
                          (group.statistics.expectancyR ?? 0) >= 0 ? 'text-bull' : 'text-bear',
                        )}
                      >
                        {fmtR(group.statistics.expectancyR)}
                      </td>
                      <td className="num text-right text-2xs">
                        {group.statistics.profitFactor === null
                          ? '—'
                          : fmtNumber(group.statistics.profitFactor, 2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {groups.some((group) => group.statistics.trades < 10) && (
                <p className="px-2 py-1.5 text-2xs text-ink-600">
                  Groups under 10 trades are shown but are too small to draw conclusions from.
                </p>
              )}
            </Panel>
          ))}
      </div>

      <Panel title="Export" bodyClassName="flex flex-wrap gap-2">
        {(
          [
            ['trades', 'Trades'],
            ['journal', 'Journal'],
            ['statistics', 'Statistics'],
            ['missed', 'Missed setups'],
          ] as const
        ).map(([dataset, label]) => (
          <span key={dataset} className="flex gap-1">
            <a className="btn btn-default" href={`/api/export?dataset=${dataset}&format=csv`}>
              {label} CSV
            </a>
            <a className="btn btn-ghost" href={`/api/export?dataset=${dataset}&format=json`}>
              JSON
            </a>
          </span>
        ))}
      </Panel>
    </div>
  );
}

/** Minimal inline equity curve — no chart library needed for a single series. */
function EquityCurve({ values }: { values: number[] }) {
  const width = 800;
  const height = 140;
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;

  const points = values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const zeroY = height - ((0 - min) / range) * height;
  const last = values[values.length - 1] ?? 0;

  return (
    <div className="space-y-1">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-36 w-full" preserveAspectRatio="none">
        <line x1={0} y1={zeroY} x2={width} y2={zeroY} stroke="#36435a" strokeWidth={1} strokeDasharray="4 4" />
        <polyline
          points={points}
          fill="none"
          stroke={last >= 0 ? '#22c55e' : '#ef4444'}
          strokeWidth={1.5}
        />
      </svg>
      <div className="flex justify-between text-2xs text-ink-500">
        <span>{values.length} closed trades</span>
        <span className={last >= 0 ? 'text-bull' : 'text-bear'}>{fmtR(last)} cumulative</span>
      </div>
    </div>
  );
}

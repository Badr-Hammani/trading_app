'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { TIMEFRAMES, DEFAULT_SESSIONS, allSessionOccurrences, type Timeframe, type TradingSignal } from '@xau/core';
import { TradingChart, type TradeOverlay, type ChartMarker } from '@/components/chart/TradingChart';
import { HeaderStrip } from '@/components/panels/HeaderStrip';
import { BiasPanel } from '@/components/panels/BiasPanel';
import { SetupStages, ExecutionStatus } from '@/components/panels/SetupStages';
import { LiquidityPanel } from '@/components/panels/LiquidityPanel';
import { FvgPanel } from '@/components/panels/FvgPanel';
import { ChecklistPanel } from '@/components/panels/ChecklistPanel';
import { SignalPanel } from '@/components/panels/SignalPanel';
import { DataUnavailable, Panel, Spinner, Stat, Tag } from '@/components/ui/Panel';
import { usePolling } from '@/lib/hooks';
import { useAppStore } from '@/store/app';
import { fmtCurrency, fmtNumber, fmtR, fmtTime } from '@/lib/format';
import type { AnalysisResponse, CandlesResponse } from '@/lib/types';
import clsx from 'clsx';

interface TradeRecord {
  id: string;
  openedAt: string;
  closedAt: string | null;
  direction: string;
  entry: number;
  initialStop: number;
  takeProfit1?: number | null;
  takeProfit2?: number | null;
  takeProfit3?: number | null;
  resultR: number | null;
  status: string;
}

interface TodayResponse {
  statistics: { trades: number; totalR: number; totalCurrency: number; winRate: number | null };
  trades: { id: string; direction: string; resultR: number | null; grade: string | null; openedAt: string }[];
  ruleBreaks: number;
  missedSetups: unknown[];
  events: { id: string; name: string; time: number; importance: string; country: string }[];
  timezone: string;
}

/**
 * The home dashboard.
 *
 * Layout follows the spec: status strip on top, bias down the left, chart in
 * the centre, liquidity / FVG / checklist / risk on the right, calendar and
 * today's stats along the bottom.
 */
export function DashboardView() {
  const { timeframe, setTimeframe, direction, setDirection, refreshMs } = useAppStore();
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [selectedTrade, setSelectedTrade] = useState<TradeOverlay | null>(null);

  const analysis = usePolling<AnalysisResponse>(
    `/api/analysis?timeframe=${timeframe}&limit=600`,
    refreshMs,
  );
  const candles = usePolling<CandlesResponse>(
    `/api/market/candles?timeframe=${timeframe}&limit=600`,
    refreshMs,
  );
  const signalsRes = usePolling<{ signals: TradingSignal[] }>('/api/signals', refreshMs);
  const tradesRes = usePolling<{ trades: TradeRecord[] }>('/api/trades?limit=100', 30_000);
  const today = usePolling<TodayResponse>('/api/daily-plan', 60_000);

  const data = analysis.data;
  const timezone = data?.timezone ?? 'UTC';
  const evaluation = direction === 'long' ? data?.long : data?.short;

  // Memoised so the empty-array fallback does not produce a new reference on
  // every render, which would re-run the session-overlay computation.
  const series = useMemo(
    () => (candles.data?.result.status === 'ok' ? candles.data.result.data.candles : []),
    [candles.data],
  );

  const sessionOverlays = useMemo(() => {
    if (series.length === 0) return [];
    return allSessionOccurrences(DEFAULT_SESSIONS, series[0]!.time, series[series.length - 1]!.time + 86400, timezone);
  }, [series, timezone]);

  const tradeMarkers = useMemo(() => {
    if (!tradesRes.data?.trades) return [];
    const list: ChartMarker[] = [];
    for (const t of tradesRes.data.trades) {
      const openTime = Math.floor(new Date(t.openedAt).getTime() / 1000);
      if (!Number.isNaN(openTime) && openTime > 0) {
        const isLong = t.direction === 'long';
        list.push({
          time: openTime,
          position: isLong ? 'belowBar' : 'aboveBar',
          color: isLong ? '#22c55e' : '#ef4444',
          shape: isLong ? 'arrowUp' : 'arrowDown',
          text: `${isLong ? 'BUY' : 'SELL'} @ ${t.entry.toFixed(2)}`,
        });
      }
      if (t.closedAt) {
        const closeTime = Math.floor(new Date(t.closedAt).getTime() / 1000);
        if (!Number.isNaN(closeTime) && closeTime > 0) {
          const r = t.resultR ?? 0;
          const win = r >= 0;
          list.push({
            time: closeTime,
            position: t.direction === 'long' ? 'aboveBar' : 'belowBar',
            color: win ? '#22c55e' : '#ef4444',
            shape: 'circle',
            text: `${win ? '+' : ''}${r.toFixed(1)}R`,
          });
        }
      }
    }
    return list;
  }, [tradesRes.data]);

  const allMarkers = tradeMarkers;

  return (
    <div className="space-y-2 p-2">
      <HeaderStrip newsRisk={evaluation?.newsRisk ?? null} />

      <div className="grid grid-cols-1 gap-2 xl:grid-cols-[minmax(210px,220px)_minmax(0,1fr)_minmax(300px,340px)]">
        {/* -------------------------------------------------------- left */}
        <div className="space-y-2">
          {/*
            Bias is the trader's own judgement, not a reading of the candles,
            so it stays editable even on a timeframe with nothing imported.
            Gating it on `dataAvailable` left a spinner that never resolved and
            no way to record a bias at all. Only the engine's SUGGESTION —
            which genuinely needs candles — is withheld.
          */}
          {analysis.loading && !data ? (
            <Panel title="Market regime">
              <Spinner />
            </Panel>
          ) : (
            <BiasPanel
              bias={data?.bias ?? {}}
              suggested={data?.dataAvailable ? data.suggestedBias : null}
              suggestionEnabled={data?.biasSuggestionEnabled}
              onChanged={() => void analysis.refresh()}
            />
          )}

          {evaluation && (
            <Panel title="Execution status" bodyClassName="p-2">
              <ExecutionStatus evaluation={evaluation} />
            </Panel>
          )}

          <Panel title="Direction" bodyClassName="p-2">
            <div className="flex gap-1">
              {(['long', 'short'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setDirection(option)}
                  className={clsx(
                    'flex-1 rounded border px-2 py-1 text-xs font-medium uppercase',
                    direction === option
                      ? option === 'long'
                        ? 'border-bull/50 bg-bull/15 text-bull'
                        : 'border-bear/50 bg-bear/15 text-bear'
                      : 'border-ink-700 text-ink-400',
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-2xs leading-relaxed text-ink-600">
              Both directions are evaluated continuously. This only chooses which one the panels
              show.
            </p>
          </Panel>
        </div>

        {/* ------------------------------------------------------ centre */}
        <div className="space-y-2">
          <Panel
            title={`${data?.symbol ?? 'XAUUSD'} · ${timeframe}`}
            subtitle={
              candles.data?.quality
                ? `${candles.data.quality.bars} bars · ${candles.data.quality.gaps} gaps · provider ${
                    candles.data.result.status === 'ok' ? candles.data.result.data.meta.provider : '—'
                  }`
                : undefined
            }
            actions={
              <div className="flex gap-0.5">
                {TIMEFRAMES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setTimeframe(option as Timeframe)}
                    className={clsx(
                      'rounded px-1.5 py-0.5 text-2xs font-medium',
                      timeframe === option
                        ? 'bg-accent/20 text-accent'
                        : 'text-ink-500 hover:bg-ink-800 hover:text-ink-200',
                    )}
                  >
                    {option}
                  </button>
                ))}
              </div>
            }
            bodyClassName="p-0"
          >
            {candles.loading && series.length === 0 ? (
              <div className="p-4">
                <Spinner label="Loading candles" />
              </div>
            ) : candles.data?.result.status === 'unavailable' ? (
              <div className="p-3">
                <DataUnavailable
                  reason={candles.data.result.message}
                  hint="Import OHLCV CSV under Settings → Data to use the app with no API keys, or configure a market data provider in .env."
                />
              </div>
            ) : (
              <TradingChart
                candles={series}
                timeframe={timeframe}
                timezone={timezone}
                fvgZones={(data?.fvgZones ?? []).filter((z) => z.status === 'fresh' || z.status === 'partially_mitigated')}
                liquidity={data?.liquidity ?? []}
                structureEvents={data?.structureEvents ?? []}
                sessions={sessionOverlays}
                trade={selectedTrade}
                activeSetupFvgId={evaluation?.fvg?.id ?? null}
                activeSetupLiquidityId={evaluation?.liquiditySweep?.levelId ?? null}
                height={430}
                markers={allMarkers}
              />
            )}
          </Panel>

          {evaluation && <SetupStages evaluation={evaluation} />}
        </div>

        {/* ------------------------------------------------------- right */}
        <div className="space-y-2">
          <SignalPanel
            signals={signalsRes.data?.signals ?? []}
            price={data?.price ?? null}
            timezone={timezone}
            onSelectSignal={(signal) => {
              setSelectedTrade({
                direction: signal.direction,
                entry: signal.entryPrice,
                stopLoss: signal.stopLoss,
                takeProfit1: signal.takeProfit1,
                takeProfit2: signal.takeProfit2,
                takeProfit3: signal.takeProfit3,
                label: `${signal.type} ${signal.symbol}`,
              });
            }}
          />
          <LiquidityPanel
            levels={data?.liquidity ?? []}
            price={data?.price ?? null}
            timezone={timezone}
            onChanged={() => void analysis.refresh()}
            stale={Boolean(data?.liquidityStale)}
            compact
          />
          <FvgPanel zones={data?.fvgZones ?? []} price={data?.price ?? null} timezone={timezone} compact />
          <ChecklistPanel
            direction={direction}
            state={checklist}
            onChange={setChecklist}
            onApplySuggestion={
              data?.dominant && data.dominant.direction === direction
                ? () => setChecklist(data.dominant!.checklist.state)
                : undefined
            }
          />
          <Panel title="Next step" bodyClassName="space-y-1.5">
            <Link href="/setups" className="btn btn-primary w-full">
              Open setup builder
            </Link>
            <Link href="/risk" className="btn btn-default w-full">
              Risk calculator
            </Link>
            <Link href="/journal" className="btn btn-default w-full">
              Journal
            </Link>
          </Panel>
        </div>
      </div>

      {/* ------------------------------------------------------- bottom */}
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
        <Panel
          title="Today"
          actions={<Link href="/plan" className="btn btn-ghost">Daily plan</Link>}
        >
          {today.data ? (
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
              <Stat label="Trades" value={today.data.statistics.trades} />
              <Stat
                label="R"
                value={fmtR(today.data.statistics.totalR)}
                tone={today.data.statistics.totalR >= 0 ? 'bull' : 'bear'}
              />
              <Stat
                label="P/L"
                value={fmtCurrency(today.data.statistics.totalCurrency)}
                tone={today.data.statistics.totalCurrency >= 0 ? 'bull' : 'bear'}
              />
              <Stat
                label="Rule breaks"
                value={today.data.ruleBreaks}
                tone={today.data.ruleBreaks > 0 ? 'bear' : 'bull'}
              />
            </div>
          ) : (
            <Spinner />
          )}
        </Panel>

        <Panel
          title="Today's events"
          actions={<Link href="/calendar" className="btn btn-ghost">Calendar</Link>}
        >
          {today.data && today.data.events.length > 0 ? (
            <ul className="space-y-1">
              {today.data.events.slice(0, 6).map((event) => (
                <li key={event.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="num shrink-0 text-ink-400">
                    {fmtTime(event.time, timezone, 'HH:mm')}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink-200">{event.name}</span>
                  <Tag tone={event.importance === 'high' ? 'bear' : 'neutral'}>{event.importance}</Tag>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-2xs text-ink-500">
              No events loaded for today. Add them by hand under Calendar, or configure Trading
              Economics.
            </p>
          )}
        </Panel>

        <Panel title="Structure log" actions={<Link href="/market" className="btn btn-ghost">Market</Link>}>
          {(data?.structureEvents ?? []).length > 0 ? (
            <ul className="space-y-1">
              {(data?.structureEvents ?? [])
                .slice(-6)
                .reverse()
                .map((event) => (
                  <li key={`${event.time}-${event.brokenLevel}`} className="flex items-center gap-2 text-xs">
                    <Tag tone={event.direction === 'bullish' ? 'bull' : 'bear'}>{event.kind}</Tag>
                    <span className="num text-ink-300">{fmtNumber(event.brokenLevel, 2)}</span>
                    <span className="text-2xs text-ink-500">{event.scope}</span>
                    <span className="ml-auto text-2xs text-ink-500">
                      {fmtTime(event.time, timezone, 'dd LLL HH:mm')}
                    </span>
                  </li>
                ))}
            </ul>
          ) : (
            <p className="text-2xs text-ink-500">No structure events detected in the loaded window.</p>
          )}
        </Panel>
      </div>

      {analysis.error && (
        <DataUnavailable reason={analysis.error} hint="The dashboard will retry automatically." />
      )}
    </div>
  );
}

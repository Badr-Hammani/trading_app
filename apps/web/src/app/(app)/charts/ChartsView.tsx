'use client';

import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { TIMEFRAMES, allSessionOccurrences, type Timeframe } from '@xau/core';
import { TradingChart, type TradeOverlay } from '@/components/chart/TradingChart';
import { LiquidityPanel } from '@/components/panels/LiquidityPanel';
import { FvgPanel } from '@/components/panels/FvgPanel';
import { DataUnavailable, Panel, Spinner, Tag } from '@/components/ui/Panel';
import { post } from '@/lib/client';
import { fmtNumber, parseNumberInput } from '@/lib/format';
import { useAction, usePolling } from '@/lib/hooks';
import { useAppStore } from '@/store/app';
import type { AnalysisResponse, CandlesResponse } from '@/lib/types';

/**
 * The charting page.
 *
 * Clicking the chart captures a price, so levels can be marked where they are
 * seen rather than typed from memory. Overlays are synchronised across
 * timeframes because the levels themselves are timeframe-independent.
 */
export function ChartsView() {
  const { timeframe, setTimeframe, refreshMs } = useAppStore();
  const [showFvg, setShowFvg] = useState(true);
  const [showLiquidity, setShowLiquidity] = useState(true);
  const [showSessions, setShowSessions] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [clicked, setClicked] = useState<{ price: number; time: number } | null>(null);

  const [overlay, setOverlay] = useState<TradeOverlay | null>(null);
  const [draft, setDraft] = useState({
    direction: 'long' as 'long' | 'short',
    entry: '',
    stopLoss: '',
    takeProfit1: '',
    takeProfit2: '',
    takeProfit3: '',
  });

  const analysis = usePolling<AnalysisResponse>(`/api/analysis?timeframe=${timeframe}`, refreshMs);
  const candles = usePolling<CandlesResponse>(
    `/api/market/candles?timeframe=${timeframe}&limit=1200`,
    refreshMs,
  );

  // Memoised so the empty-array fallback does not produce a new reference on
  // every render, which would re-run the session-overlay computation.
  const series = useMemo(
    () => (candles.data?.result.status === 'ok' ? candles.data.result.data.candles : []),
    [candles.data],
  );
  const timezone = analysis.data?.timezone ?? 'UTC';

  const sessions = useMemo(() => {
    if (!showSessions || series.length === 0 || !analysis.data?.session) return [];
    const definitions = [
      ...analysis.data.session.active.map((entry) => entry.definition),
      ...(analysis.data.session.next ? [analysis.data.session.next.definition] : []),
    ];
    const unique = [...new Map(definitions.map((definition) => [definition.id, definition])).values()];
    return allSessionOccurrences(unique, series[0]!.time, series[series.length - 1]!.time + 86400);
  }, [showSessions, series, analysis.data?.session]);

  const addLevel = useAction(async (type: string, price: number) => {
    await post('/api/liquidity', { type, price, timeframe, label: type });
    await analysis.refresh();
    setClicked(null);
  });

  const applyOverlay = () => {
    const entry = parseNumberInput(draft.entry);
    const stopLoss = parseNumberInput(draft.stopLoss);
    if (entry === null || stopLoss === null) {
      setOverlay(null);
      return;
    }
    setOverlay({
      direction: draft.direction,
      entry,
      stopLoss,
      takeProfit1: parseNumberInput(draft.takeProfit1),
      takeProfit2: parseNumberInput(draft.takeProfit2),
      takeProfit3: parseNumberInput(draft.takeProfit3),
    });
  };

  const rr = useMemo(() => {
    if (!overlay) return null;
    const risk = Math.abs(overlay.entry - overlay.stopLoss);
    if (risk <= 0) return null;
    const target = overlay.takeProfit2 ?? overlay.takeProfit1;
    if (target == null) return null;
    return Math.abs(target - overlay.entry) / risk;
  }, [overlay]);

  return (
    <div className="grid grid-cols-1 gap-2 p-2 xl:grid-cols-[minmax(0,1fr)_minmax(300px,340px)]">
      <div className="space-y-2">
        <Panel
          title={`XAUUSD · ${timeframe}`}
          subtitle={
            candles.data?.quality
              ? `${candles.data.quality.bars} bars · ${candles.data.quality.gaps} gaps detected`
              : undefined
          }
          actions={
            <div className="flex flex-wrap items-center gap-1">
              {TIMEFRAMES.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setTimeframe(option as Timeframe)}
                  className={clsx(
                    'rounded px-1.5 py-0.5 text-2xs font-medium',
                    timeframe === option ? 'bg-accent/20 text-accent' : 'text-ink-500 hover:bg-ink-800',
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
                hint="Import CSV under Settings → Data, or configure a provider."
              />
            </div>
          ) : (
            <TradingChart
              candles={series}
              timeframe={timeframe}
              timezone={timezone}
              fvgZones={showFvg ? (analysis.data?.fvgZones ?? []) : []}
              liquidity={showLiquidity ? (analysis.data?.liquidity ?? []) : []}
              sessions={sessions}
              trade={overlay}
              showVolume={showVolume}
              height={560}
              onPriceClick={(price, time) => setClicked({ price, time })}
              markers={(analysis.data?.swings ?? []).slice(-24).map((swing) => ({
                time: swing.time,
                position: swing.type === 'high' ? 'aboveBar' : 'belowBar',
                color: swing.type === 'high' ? '#ef4444' : '#22c55e',
                shape: 'circle',
                text: swing.label ?? '',
              }))}
            />
          )}
        </Panel>

        <Panel title="Layers" bodyClassName="flex flex-wrap gap-3">
          <Toggle label="FVG zones" checked={showFvg} onChange={setShowFvg} />
          <Toggle label="Liquidity" checked={showLiquidity} onChange={setShowLiquidity} />
          <Toggle label="Session overlays" checked={showSessions} onChange={setShowSessions} />
          <Toggle label="Volume" checked={showVolume} onChange={setShowVolume} />
        </Panel>
      </div>

      <div className="space-y-2">
        {clicked && (
          <Panel title="Mark this price" subtitle={fmtNumber(clicked.price, 2)} bodyClassName="space-y-2">
            <div className="grid grid-cols-2 gap-1">
              {['PDH', 'PDL', 'SWING_HIGH', 'SWING_LOW', 'EQUAL_HIGHS', 'EQUAL_LOWS', 'INTERNAL', 'EXTERNAL'].map(
                (type) => (
                  <button
                    key={type}
                    type="button"
                    className="btn btn-default"
                    disabled={addLevel.busy}
                    onClick={() => void addLevel.run(type, clicked.price)}
                  >
                    {type}
                  </button>
                ),
              )}
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                className="btn btn-ghost flex-1"
                onClick={() => setDraft((value) => ({ ...value, entry: clicked.price.toFixed(2) }))}
              >
                Use as entry
              </button>
              <button
                type="button"
                className="btn btn-ghost flex-1"
                onClick={() => setDraft((value) => ({ ...value, stopLoss: clicked.price.toFixed(2) }))}
              >
                Use as stop
              </button>
            </div>
            <button type="button" className="btn btn-ghost w-full" onClick={() => setClicked(null)}>
              Dismiss
            </button>
            {addLevel.error && <p className="text-2xs text-bear">{addLevel.error}</p>}
          </Panel>
        )}

        <Panel
          title="Trade projection"
          subtitle="Visualise entry, stop and targets"
          actions={rr !== null ? <Tag tone="accent">{fmtNumber(rr, 2)}R</Tag> : undefined}
          bodyClassName="space-y-2"
        >
          <div className="flex gap-1">
            {(['long', 'short'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setDraft((value) => ({ ...value, direction: option }))}
                className={clsx(
                  'flex-1 rounded border px-2 py-1 text-xs uppercase',
                  draft.direction === option
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
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['entry', 'Entry'],
                ['stopLoss', 'Stop'],
                ['takeProfit1', 'TP1'],
                ['takeProfit2', 'TP2'],
                ['takeProfit3', 'TP3'],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <label className="field-label">{label}</label>
                <input
                  className="input"
                  value={draft[key]}
                  onChange={(event) => setDraft((value) => ({ ...value, [key]: event.target.value }))}
                  inputMode="decimal"
                />
              </div>
            ))}
          </div>
          <div className="flex gap-1">
            <button type="button" className="btn btn-primary flex-1" onClick={applyOverlay}>
              Draw on chart
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setOverlay(null)}>
              Clear
            </button>
          </div>
          <p className="text-2xs leading-relaxed text-ink-600">
            Drawing a projection does not create a setup or a trade. Use the Setups page to record
            one.
          </p>
        </Panel>

        <LiquidityPanel
          levels={analysis.data?.liquidity ?? []}
          price={analysis.data?.price ?? null}
          timezone={timezone}
          onChanged={() => void analysis.refresh()}
        />
        <FvgPanel
          zones={analysis.data?.fvgZones ?? []}
          price={analysis.data?.price ?? null}
          timezone={timezone}
        />
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-3.5 w-3.5 accent-violet-500"
      />
      {label}
    </label>
  );
}

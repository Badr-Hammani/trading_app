'use client';

import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { REPLAY_SPEEDS, TIMEFRAMES, type Candle, type Timeframe } from '@xau/core';
import { TradingChart } from '@/components/chart/TradingChart';
import { SetupStages } from '@/components/panels/SetupStages';
import { FvgPanel } from '@/components/panels/FvgPanel';
import { LiquidityPanel } from '@/components/panels/LiquidityPanel';
import { DataUnavailable, EmptyState, Panel, Spinner, Stat, Tag } from '@/components/ui/Panel';
import { get, post } from '@/lib/client';
import { fmtNumber, fmtR, fmtTime } from '@/lib/format';
import { useAction } from '@/lib/hooks';
import type { AnalysisResponse, CandlesResponse } from '@/lib/types';

/**
 * Replay.
 *
 * The candle array is loaded once and the cursor slices it, so the chart
 * cannot render a bar the trader has not "reached" yet. The analysis request
 * carries the cursor time, so the engines are equally blind to the future.
 */
export function ReplayView() {
  const [timeframe, setTimeframe] = useState<Timeframe>('5M');
  const [all, setAll] = useState<Candle[]>([]);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [direction, setDirection] = useState<'long' | 'short'>('long');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load the whole window once. The cursor, not the fetch, controls visibility.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const payload = await get<CandlesResponse>(
          `/api/market/candles?timeframe=${timeframe}&limit=5000`,
        );
        if (cancelled) return;
        if (payload.result.status !== 'ok') {
          setError(payload.result.message);
          setAll([]);
        } else {
          setAll(payload.result.data.candles);
          setCursor(Math.min(120, payload.result.data.candles.length - 1));
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Failed to load candles.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [timeframe]);

  const visible = useMemo(() => all.slice(0, cursor + 1), [all, cursor]);
  const current = visible[visible.length - 1] ?? null;

  // Re-evaluate the model at the cursor time.
  const evaluate = useCallback(async () => {
    if (!current) return;
    try {
      const payload = await get<AnalysisResponse>(
        `/api/analysis?timeframe=${timeframe}&at=${current.time}&limit=800`,
      );
      setAnalysis(payload);
    } catch {
      // Leave the previous evaluation on screen rather than blanking it.
    }
  }, [current, timeframe]);

  useEffect(() => {
    void evaluate();
  }, [evaluate]);

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!playing) return;

    timerRef.current = setInterval(() => {
      setCursor((value) => {
        if (value >= all.length - 1) {
          setPlaying(false);
          return value;
        }
        return value + 1;
      });
    }, Math.max(50, 1000 / speed));

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [playing, speed, all.length]);

  const timezone = analysis?.timezone ?? 'UTC';
  const evaluation = direction === 'long' ? analysis?.long : analysis?.short;

  const logMissed = useAction(async (reason: string) => {
    if (!current) return;
    await post('/api/missed-setups', {
      time: current.time,
      direction,
      reason,
      notes: 'Logged from replay',
    });
  });

  if (loading) {
    return (
      <div className="p-4">
        <Spinner label="Loading replay data" />
      </div>
    );
  }

  if (error || all.length === 0) {
    return (
      <div className="p-3">
        <DataUnavailable
          reason={error ?? 'No candles stored for this timeframe.'}
          hint="Import OHLCV CSV under Settings → Data. Replay and backtesting run entirely on imported history — no API key needed."
        />
      </div>
    );
  }

  return (
    <div className="space-y-2 p-2">
      <Panel bodyClassName="space-y-2 p-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-0.5">
            {TIMEFRAMES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setTimeframe(option as Timeframe)}
                className={clsx(
                  'rounded px-1.5 py-0.5 text-2xs',
                  timeframe === option ? 'bg-accent/20 text-accent' : 'text-ink-500 hover:bg-ink-800',
                )}
              >
                {option}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <button type="button" className="btn btn-default" onClick={() => setCursor((v) => Math.max(0, v - 5))}>
              ⏪ 5
            </button>
            <button type="button" className="btn btn-default" onClick={() => setCursor((v) => Math.max(0, v - 1))}>
              ◀ 1
            </button>
            <button
              type="button"
              className={clsx('btn', playing ? 'btn-bear' : 'btn-bull')}
              onClick={() => setPlaying((value) => !value)}
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <button
              type="button"
              className="btn btn-default"
              onClick={() => setCursor((v) => Math.min(all.length - 1, v + 1))}
            >
              1 ▶
            </button>
            <button
              type="button"
              className="btn btn-default"
              onClick={() => setCursor((v) => Math.min(all.length - 1, v + 5))}
            >
              5 ⏩
            </button>
          </div>

          <div className="flex items-center gap-1">
            <span className="stat-label">Speed</span>
            {REPLAY_SPEEDS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setSpeed(option)}
                className={clsx(
                  'rounded px-1.5 py-0.5 text-2xs',
                  speed === option ? 'bg-accent/20 text-accent' : 'text-ink-500 hover:bg-ink-800',
                )}
              >
                {option}×
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-3">
            <Stat label="Bar" value={`${cursor + 1} / ${all.length}`} />
            <Stat label="Time" value={current ? fmtTime(current.time, timezone, 'dd LLL HH:mm') : '—'} />
            <Stat label="Close" value={fmtNumber(current?.close, 2)} />
          </div>
        </div>

        <input
          type="range"
          min={0}
          max={all.length - 1}
          value={cursor}
          onChange={(event) => setCursor(Number(event.target.value))}
          className="w-full accent-violet-500"
        />

        <div className="flex flex-wrap items-center gap-2">
          <span className="stat-label">Jump to date</span>
          <input
            type="date"
            className="input w-auto"
            onChange={(event) => {
              const target = DateTime.fromISO(event.target.value, { zone: timezone });
              if (!target.isValid) return;
              const seconds = Math.floor(target.toSeconds());
              const index = all.findIndex((candle) => candle.time >= seconds);
              setCursor(index === -1 ? all.length - 1 : index);
            }}
          />
          <Tag tone="accent">Future candles are not loaded into the chart at any point</Tag>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
        <div className="space-y-2">
          <Panel title={`Replay · ${timeframe}`} bodyClassName="p-0">
            <TradingChart
              candles={visible}
              timeframe={timeframe}
              timezone={timezone}
              fvgZones={analysis?.fvgZones ?? []}
              liquidity={analysis?.liquidity ?? []}
              height={480}
            />
          </Panel>

          {evaluation && <SetupStages evaluation={evaluation} compact />}
        </div>

        <div className="space-y-2">
          <Panel title="Direction" bodyClassName="p-2">
            <div className="flex gap-1">
              {(['long', 'short'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setDirection(option)}
                  className={clsx(
                    'flex-1 rounded border px-2 py-1 text-xs uppercase',
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
          </Panel>

          <Panel title="Log this bar" bodyClassName="space-y-1.5">
            <p className="text-2xs leading-relaxed text-ink-500">
              Found a setup you would not have taken live? Record why, so the Missed Trades tracker
              can measure whether the filter helps.
            </p>
            <div className="grid grid-cols-2 gap-1">
              {['Outside session', 'Missed entry', 'Too fast', 'News', 'Below confidence threshold', 'Manual decision'].map(
                (reason) => (
                  <button
                    key={reason}
                    type="button"
                    className="btn btn-default"
                    disabled={logMissed.busy}
                    onClick={() => void logMissed.run(reason)}
                  >
                    {reason}
                  </button>
                ),
              )}
            </div>
            {logMissed.error && <p className="text-2xs text-bear">{logMissed.error}</p>}
          </Panel>

          <FvgPanel zones={analysis?.fvgZones ?? []} price={current?.close ?? null} timezone={timezone} compact />
          <LiquidityPanel
            levels={analysis?.liquidity ?? []}
            price={current?.close ?? null}
            timezone={timezone}
            compact
          />
        </div>
      </div>
    </div>
  );
}

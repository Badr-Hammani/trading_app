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

  const [selectedDate, setSelectedDate] = useState<string>('');

  // Load a window of historical candles around a target timestamp.
  const loadWindow = useCallback(
    async (targetTime?: number) => {
      setLoading(true);
      try {
        let query = `/api/market/candles?timeframe=${timeframe}&provider=local&limit=3000`;
        if (targetTime) {
          // Step seconds for 5M vs 15M
          const step = (timeframe === '15M' ? 15 : 5) * 60;
          const fromTime = Math.max(0, targetTime - 200 * step);
          query += `&from=${fromTime}`;
        } else {
          // Initial load: start from beginning of dataset (from=0 ascending)
          query += `&from=0`;
        }

        const payload = await get<CandlesResponse>(query);
        if (payload.result.status !== 'ok') {
          setError(payload.result.message);
          setAll([]);
        } else {
          const candles = payload.result.data.candles;
          setAll(candles);
          setError(null);

          if (targetTime && candles.length > 0) {
            const idx = candles.findIndex((c) => c.time >= targetTime);
            setCursor(idx !== -1 ? idx : Math.min(100, candles.length - 1));
          } else {
            setCursor(Math.min(100, candles.length - 1));
          }
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Failed to load candles.');
      } finally {
        setLoading(false);
      }
    },
    [timeframe],
  );

  // Initial load and timeframe change
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!cancelled) await loadWindow();
    })();
    return () => {
      cancelled = true;
    };
  }, [timeframe, loadWindow]);

  const visible = useMemo(() => all.slice(0, cursor + 1), [all, cursor]);
  const current = visible[visible.length - 1] ?? null;

  // Auto-page next block when playback/cursor reaches end of loaded chunk
  useEffect(() => {
    if (cursor > 0 && cursor >= all.length - 30 && all.length > 0) {
      const lastTime = all[all.length - 1]!.time;
      void (async () => {
        try {
          const nextPayload = await get<CandlesResponse>(
            `/api/market/candles?timeframe=${timeframe}&provider=local&from=${lastTime + 1}&limit=2000`,
          );
          if (nextPayload.result.status === 'ok' && nextPayload.result.data.candles.length > 0) {
            const newCandles = nextPayload.result.data.candles;
            setAll((prev) => {
              const existingTimes = new Set(prev.map((c) => c.time));
              const filtered = newCandles.filter((c) => !existingTimes.has(c.time));
              return [...prev, ...filtered];
            });
          }
        } catch {
          // Silence background pagination errors
        }
      })();
    }
  }, [cursor, all, timeframe]);

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
            value={selectedDate}
            onChange={(event) => {
              const val = event.target.value;
              setSelectedDate(val);
              const target = DateTime.fromISO(val, { zone: 'utc' });
              if (!target.isValid) return;
              const seconds = Math.floor(target.toSeconds());
              void loadWindow(seconds);
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
              activeSetupFvgId={evaluation?.fvg?.id ?? null}
              activeSetupLiquidityId={evaluation?.liquiditySweep?.levelId ?? null}
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

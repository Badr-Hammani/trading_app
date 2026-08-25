'use client';

import clsx from 'clsx';
import { useState } from 'react';
import type { TradingSignal } from '@xau/core';
import { Panel, Tag, EmptyState } from '@/components/ui/Panel';
import { fmtNumber, fmtTime } from '@/lib/format';

const STATUS_TONE = {
  qualified: 'bull',
  caution: 'warn',
  forming: 'neutral',
  valid_out_of_session: 'neutral',
  no_setup: 'neutral',
  blocked: 'bear',
} as const;

export interface SignalPanelProps {
  signals: TradingSignal[];
  price: number | null;
  timezone: string;
  onSelectSignal?: (signal: TradingSignal) => void;
}

export function SignalPanel({
  signals,
  price,
  timezone,
  onSelectSignal,
}: SignalPanelProps) {
  const [audioEnabled, setAudioEnabled] = useState(false);

  const activeSignals = signals.filter(
    (s) => s.status === 'qualified' || s.status === 'caution' || s.status === 'forming',
  );

  return (
    <Panel
      title="Live Buy/Sell Signal Engine"
      subtitle={`${activeSignals.length} Active Signal${activeSignals.length === 1 ? '' : 's'}`}
      actions={
        <button
          type="button"
          onClick={() => setAudioEnabled(!audioEnabled)}
          className={clsx(
            'text-xs px-2 py-0.5 rounded border transition-colors',
            audioEnabled
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
              : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200',
          )}
        >
          {audioEnabled ? '🔔 Audio On' : '🔕 Audio Off'}
        </button>
      }
      bodyClassName="space-y-3"
    >
      {activeSignals.length === 0 ? (
        <EmptyState
          title="No Active Signals"
          hint="The signal engine continuously scans 5M/15M/1H timeframes. Active BUY and SELL setups will display here automatically."
        />
      ) : (
        <div className="space-y-2">
          {activeSignals.map((sig) => (
            <SignalCard
              key={sig.id}
              signal={sig}
              price={price}
              timezone={timezone}
              onSelect={() => onSelectSignal?.(sig)}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

function SignalCard({
  signal,
  price,
  timezone,
  onSelect,
}: {
  signal: TradingSignal;
  price: number | null;
  timezone: string;
  onSelect?: () => void;
}) {
  const isBuy = signal.type === 'BUY';

  return (
    <div
      className={clsx(
        'p-3 rounded-lg border text-sm transition-all',
        isBuy
          ? 'bg-emerald-950/30 border-emerald-500/40 hover:border-emerald-500/70'
          : 'bg-rose-950/30 border-rose-500/40 hover:border-rose-500/70',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span
            className={clsx(
              'px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider',
              isBuy ? 'bg-emerald-500 text-black' : 'bg-rose-500 text-white',
            )}
          >
            {signal.type} {signal.symbol}
          </span>
          <span className="text-xs font-mono text-zinc-400">[{signal.timeframe}]</span>
        </div>

        <div className="flex items-center gap-2">
          <Tag tone={STATUS_TONE[signal.status] || 'neutral'}>
            {signal.status.toUpperCase()}
          </Tag>
          <span className="text-xs font-mono text-zinc-400">
            Score: <strong className="text-zinc-200">{signal.qualityScore}%</strong>
          </span>
        </div>
      </div>

      {/* Summary */}
      <p className="text-xs text-zinc-300 mb-2 leading-relaxed">{signal.summary}</p>

      {/* Geometry Table */}
      <div className="grid grid-cols-4 gap-1 py-2 px-2.5 rounded bg-zinc-900/80 border border-zinc-800 text-xs font-mono mb-2.5">
        <div>
          <span className="text-zinc-500 block text-[10px] uppercase">Entry</span>
          <span className="font-semibold text-zinc-100">{fmtNumber(signal.entryPrice, 2)}</span>
        </div>
        <div>
          <span className="text-zinc-500 block text-[10px] uppercase">Stop Loss</span>
          <span className="font-semibold text-rose-400">{fmtNumber(signal.stopLoss, 2)}</span>
        </div>
        <div>
          <span className="text-zinc-500 block text-[10px] uppercase">TP1 (1:2)</span>
          <span className="font-semibold text-emerald-400">{fmtNumber(signal.takeProfit1, 2)}</span>
        </div>
        <div>
          <span className="text-zinc-500 block text-[10px] uppercase">R:R Ratio</span>
          <span className="font-semibold text-amber-400">{signal.riskRewardRatio}:1</span>
        </div>
      </div>

      {/* Footer Button */}
      <div className="flex items-center justify-between pt-1">
        <span className="text-[11px] text-zinc-500 font-mono">
          Detected {fmtTime(signal.timestamp, timezone, 'HH:mm:ss')}
        </span>

        <button
          type="button"
          onClick={onSelect}
          className="text-xs px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium transition-colors border border-zinc-700"
        >
          🎯 Load into Risk Calculator & Chart
        </button>
      </div>
    </div>
  );
}

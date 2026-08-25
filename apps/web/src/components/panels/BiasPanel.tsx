'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { BIASES, type Bias, type Timeframe } from '@xau/core';
import { Panel, Tag } from '@/components/ui/Panel';
import { put } from '@/lib/client';

/**
 * Market regime.
 *
 * The bias is the trader's, always. The engine's structural reading is shown
 * beside it as a suggestion and is only ever applied when the trader clicks
 * to apply it — the app does not decide direction on their behalf.
 */

const ROWS: { timeframe: Timeframe; label: string }[] = [
  { timeframe: '4H', label: '4H bias' },
  { timeframe: '1H', label: '1H bias' },
  { timeframe: '30M', label: '30M bias' },
  { timeframe: '15M', label: '15M structure' },
  { timeframe: '5M', label: '5M structure' },
];

const TONES: Record<Bias, string> = {
  bullish: 'bg-bull/15 text-bull border-bull/40',
  bearish: 'bg-bear/15 text-bear border-bear/40',
  neutral: 'bg-ink-800 text-ink-300 border-ink-600',
  transitional: 'bg-warn/15 text-warn border-warn/40',
};

const SHORT: Record<Bias, string> = {
  bullish: 'BULL',
  bearish: 'BEAR',
  neutral: 'NEUT',
  transitional: 'TRANS',
};

export function BiasPanel({
  bias,
  suggested,
  suggestionEnabled,
  onChanged,
}: {
  bias: Partial<Record<Timeframe, Bias>>;
  suggested?: { bias: Bias; rationale: string } | null;
  suggestionEnabled?: boolean;
  onChanged?: () => void;
}) {
  const [local, setLocal] = useState(bias);
  const [saving, setSaving] = useState<Timeframe | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setBias = async (timeframe: Timeframe, value: Bias) => {
    setSaving(timeframe);
    setError(null);
    setLocal((current) => ({ ...current, [timeframe]: value }));
    try {
      await put('/api/bias', { timeframe, bias: value, rationale: '' });
      onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save.');
      setLocal(bias);
    } finally {
      setSaving(null);
    }
  };

  return (
    <Panel title="Market regime" subtitle="Your read, per timeframe" bodyClassName="space-y-1.5">
      {ROWS.map((row) => {
        const value = local[row.timeframe] ?? 'neutral';
        return (
          <div key={row.timeframe} className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-2xs uppercase tracking-wide text-ink-400">
              {row.label}
            </span>
            <div className="flex flex-1 gap-1">
              {BIASES.map((option) => (
                <button
                  key={option}
                  type="button"
                  disabled={saving === row.timeframe}
                  onClick={() => void setBias(row.timeframe, option)}
                  className={clsx(
                    'flex-1 rounded border px-1 py-1 text-2xs font-semibold transition-colors',
                    value === option
                      ? TONES[option]
                      : 'border-ink-700 text-ink-500 hover:border-ink-600 hover:text-ink-300',
                  )}
                  title={option}
                >
                  {SHORT[option]}
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {error && <p className="text-2xs text-bear">{error}</p>}

      {suggested && (
        <div className="mt-2 rounded border border-ink-700 bg-ink-850 p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="stat-label">Engine reading (suggestion)</span>
            <Tag
              tone={
                suggested.bias === 'bullish'
                  ? 'bull'
                  : suggested.bias === 'bearish'
                    ? 'bear'
                    : suggested.bias === 'transitional'
                      ? 'warn'
                      : 'neutral'
              }
            >
              {suggested.bias}
            </Tag>
          </div>
          <p className="mt-1 text-2xs leading-relaxed text-ink-400">{suggested.rationale}</p>
          <button
            type="button"
            className="btn btn-ghost mt-1.5 w-full text-xs font-medium text-emerald-400 hover:bg-emerald-500/10 border border-emerald-500/30"
            onClick={() => void setBias('5M', suggested.bias)}
          >
            ⚡ Apply {suggested.bias.toUpperCase()} to 5M structure
          </button>
        </div>
      )}
    </Panel>
  );
}

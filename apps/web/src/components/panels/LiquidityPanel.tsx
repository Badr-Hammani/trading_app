'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { LIQUIDITY_TYPES, type LiquidityLevel } from '@xau/core';
import { EmptyState, Panel, Tag } from '@/components/ui/Panel';
import { del, post } from '@/lib/client';
import { fmtNumber, fmtTime } from '@/lib/format';
import { useAction } from '@/lib/hooks';

const STATUS_TONE = {
  intact: 'neutral',
  swept: 'warn',
  broken: 'bear',
} as const;

export function LiquidityPanel({
  levels,
  price,
  timezone,
  onChanged,
  compact = false,
  stale = false,
}: {
  levels: LiquidityLevel[];
  price: number | null;
  timezone: string;
  onChanged?: () => void;
  compact?: boolean;
  /**
   * True when sweep state could not be recomputed (no candles for this
   * timeframe). The levels are real; their status is as last stored, so the
   * panel must not present "intact" as a fresh finding.
   */
  stale?: boolean;
}) {
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState<(typeof LIQUIDITY_TYPES)[number]>('PDH');
  const [levelPrice, setLevelPrice] = useState('');
  const [notes, setNotes] = useState('');

  const add = useAction(async () => {
    await post('/api/liquidity', {
      type,
      price: Number(levelPrice),
      notes,
      label: type,
    });
    setLevelPrice('');
    setNotes('');
    setShowForm(false);
    onChanged?.();
  });

  const detect = useAction(async () => {
    await post('/api/liquidity', {});
    onChanged?.();
  });

  const remove = useAction(async (id: string) => {
    await del(`/api/liquidity?id=${id}`);
    onChanged?.();
  });

  const sorted = [...levels].sort((a, b) => b.price - a.price);
  const shown = compact ? sorted.slice(0, 12) : sorted;

  return (
    <Panel
      title="Liquidity map"
      subtitle={
        stale
          ? `${levels.length} levels · sweep state not re-checked`
          : `${levels.filter((level) => level.status === 'intact').length} intact · ${levels.filter((level) => level.status === 'swept').length} swept`
      }
      actions={
        <>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() =>
              void fetch('/api/liquidity', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) }).then(
                () => onChanged?.(),
              )
            }
            disabled={detect.busy}
            title="Derive PDH/PDL, session highs and lows, and equal highs/lows from the data"
          >
            Detect
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setShowForm((value) => !value)}>
            {showForm ? 'Cancel' : 'Add'}
          </button>
        </>
      }
      bodyClassName="space-y-2"
    >
      {showForm && (
        <form
          className="space-y-2 rounded border border-ink-700 bg-ink-850 p-2"
          onSubmit={(event) => {
            event.preventDefault();
            void add.run();
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="field-label">Type</label>
              <select
                className="select"
                value={type}
                onChange={(event) => setType(event.target.value as typeof type)}
              >
                {LIQUIDITY_TYPES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Price</label>
              <input
                className="input"
                value={levelPrice}
                onChange={(event) => setLevelPrice(event.target.value)}
                placeholder={price ? price.toFixed(2) : '0.00'}
                required
                inputMode="decimal"
              />
            </div>
          </div>
          <div>
            <label className="field-label">Notes</label>
            <input className="input" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </div>
          {add.error && <p className="text-2xs text-bear">{add.error}</p>}
          <button type="submit" className="btn btn-primary w-full" disabled={add.busy}>
            Add level
          </button>
        </form>
      )}

      {stale && (
        <p className="rounded border border-warn/40 bg-warn/10 px-2 py-1.5 text-2xs leading-relaxed text-warn">
          Sweep status could not be re-checked — this timeframe has no candles loaded. The
          levels and prices are real; the status shown is whatever was last recorded.
        </p>
      )}

      {shown.length === 0 ? (
        <EmptyState
          title="No liquidity marked"
          hint="Add levels by hand, or press Detect to derive PDH/PDL, previous week extremes, session highs and lows, and equal highs/lows from the loaded candles."
        />
      ) : (
        <div className="max-h-72 overflow-y-auto">
          <table className="table-dense">
            <thead className="sticky top-0 bg-ink-900">
              <tr>
                <th>Type</th>
                <th className="text-right">Price</th>
                <th className="text-right">Dist</th>
                <th>Status</th>
                {!compact && <th>Event</th>}
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((level) => {
                const distance = price === null ? null : level.price - price;
                return (
                  <tr key={level.id}>
                    <td>
                      <div className="flex items-center gap-1">
                        <span
                          className={clsx(
                            'h-1.5 w-1.5 rounded-full',
                            level.side === 'buy-side' ? 'bg-bear' : 'bg-bull',
                          )}
                          title={level.side}
                        />
                        <span className="text-2xs">{level.type}</span>
                      </div>
                    </td>
                    <td className="num text-right">{fmtNumber(level.price, 2)}</td>
                    <td
                      className={clsx(
                        'num text-right text-2xs',
                        distance === null ? 'text-ink-500' : distance > 0 ? 'text-ink-300' : 'text-ink-300',
                      )}
                    >
                      {distance === null ? '—' : fmtNumber(distance, 2, { sign: true })}
                    </td>
                    <td>
                      <Tag tone={STATUS_TONE[level.status]}>{level.status}</Tag>
                    </td>
                    {!compact && (
                      <td className="text-2xs text-ink-500">
                        {level.eventTime ? fmtTime(level.eventTime, timezone, 'dd LLL HH:mm') : '—'}
                      </td>
                    )}
                    <td className="text-right">
                      {level.manual && (
                        <button
                          type="button"
                          className="text-2xs text-ink-600 hover:text-bear"
                          onClick={() => void remove.run(level.id)}
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-2xs leading-relaxed text-ink-600">
        A level is only marked swept when price penetrates it meaningfully and then closes back
        through. A wick alone is not a sweep; a close beyond that holds is a break.
      </p>
    </Panel>
  );
}

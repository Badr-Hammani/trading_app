'use client';

import clsx from 'clsx';
import { useState } from 'react';
import {
  GRADE_DESCRIPTIONS,
  MANAGEMENT_MODELS,
  TRADE_GRADES,
  type LiveTradeState,
  type TradeGrade,
} from '@xau/core';
import { EmptyState, Panel, Spinner, Stat, Tag } from '@/components/ui/Panel';
import { post, put, upload } from '@/lib/client';
import { fmtCurrency, fmtIsoDateTime, fmtNumber, fmtR } from '@/lib/format';
import { useAction, usePolling } from '@/lib/hooks';

interface TradeRow {
  id: string;
  direction: 'long' | 'short';
  status: string;
  openedAt: string;
  closedAt: string | null;
  session: string;
  entry: number;
  initialStop: number;
  currentStop: number;
  takeProfit1: number | null;
  takeProfit2: number | null;
  takeProfit3: number | null;
  lotSize: number;
  remainingLots: number;
  riskPercent: number;
  realisedPnl: number;
  resultR: number | null;
  resultCurrency: number | null;
  maeR: number | null;
  mfeR: number | null;
  grade: string | null;
  ruleViolation: boolean;
  setupType: string | null;
  liquidityType: string | null;
  fvgTimeframe: string | null;
  managementModel: string;
  newsPresent: boolean;
  live: LiveTradeState | null;
  journalEntry: {
    emotion: string;
    mistake: string;
    lesson: string;
    confidence: number | null;
    ruleViolation: string;
    notes: string;
  } | null;
  processVsOutcome?: { label: string; tone: 'good' | 'bad' | 'neutral'; note: string } | null;
  screenshots?: { id: string; phase: string; caption: string }[];
  managementEvents?: { id: string; type: string; time: string; price: number | null; percent: number | null; note: string }[];
}

/**
 * Journal and live trade management.
 *
 * Grades measure process. The panel says so out loud, because the whole point
 * is to stop a winning rule break from feeling like a good trade.
 */
export function JournalView() {
  const [filter, setFilter] = useState<'all' | 'open' | 'closed'>('all');
  const [selected, setSelected] = useState<string | null>(null);

  const journal = usePolling<{ trades: TradeRow[] }>(
    `/api/journal${filter === 'all' ? '' : `?status=${filter}`}`,
    30_000,
  );
  const live = usePolling<{
    trades: TradeRow[];
    currentPrice: number | null;
    priceUnavailableReason: string | null;
    currency: string;
  }>('/api/trades?status=open', 15_000);

  const trades = journal.data?.trades ?? [];
  const timezone = 'UTC';
  const openTrades = live.data?.trades ?? [];
  const currency = live.data?.currency ?? 'USD';
  const active = trades.find((trade) => trade.id === selected) ?? null;

  return (
    <div className="space-y-2 p-2">
      {openTrades.length > 0 && (
        <Panel
          title="Live trade management"
          subtitle={
            live.data?.currentPrice !== null && live.data?.currentPrice !== undefined
              ? `Marking to ${fmtNumber(live.data.currentPrice, 2)}`
              : (live.data?.priceUnavailableReason ?? 'Price unavailable')
          }
          bodyClassName="space-y-2"
        >
          {openTrades.map((trade) => (
            <LiveTradeCard
              key={trade.id}
              trade={trade}
              currency={currency}
              onChanged={() => {
                void live.refresh();
                void journal.refresh();
              }}
            />
          ))}
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-2 xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
        <Panel
          title="Trades"
          subtitle={`${trades.length} recorded`}
          actions={
            <div className="flex gap-0.5">
              {(['all', 'open', 'closed'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setFilter(option)}
                  className={clsx(
                    'rounded px-1.5 py-0.5 text-2xs',
                    filter === option ? 'bg-accent/20 text-accent' : 'text-ink-500 hover:bg-ink-800',
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
          }
          bodyClassName="p-0"
        >
          {journal.loading && trades.length === 0 ? (
            <div className="p-3">
              <Spinner />
            </div>
          ) : trades.length === 0 ? (
            <div className="p-3">
              <EmptyState
                title="No trades recorded"
                hint="Record a trade from the Setups page after you place it with your broker."
              />
            </div>
          ) : (
            <div className="max-h-[600px] overflow-y-auto">
              <table className="table-dense">
                <thead className="sticky top-0 bg-ink-900">
                  <tr>
                    <th>Opened</th>
                    <th>Dir</th>
                    <th>Session</th>
                    <th>Setup</th>
                    <th className="text-right">R</th>
                    <th className="text-right">P/L</th>
                    <th>Grade</th>
                    <th>Process</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((trade) => (
                    <tr
                      key={trade.id}
                      onClick={() => setSelected(trade.id)}
                      className={clsx('cursor-pointer', selected === trade.id && 'bg-ink-800')}
                    >
                      <td className="num text-2xs">{fmtIsoDateTime(trade.openedAt, timezone)}</td>
                      <td>
                        <Tag tone={trade.direction === 'long' ? 'bull' : 'bear'}>{trade.direction}</Tag>
                      </td>
                      <td className="text-2xs text-ink-400">{trade.session || '—'}</td>
                      <td className="text-2xs text-ink-400">{trade.setupType ?? '—'}</td>
                      <td
                        className={clsx(
                          'num text-right',
                          trade.resultR === null
                            ? 'text-ink-500'
                            : trade.resultR >= 0
                              ? 'text-bull'
                              : 'text-bear',
                        )}
                      >
                        {trade.resultR === null ? 'open' : fmtR(trade.resultR)}
                      </td>
                      <td
                        className={clsx(
                          'num text-right text-2xs',
                          (trade.resultCurrency ?? 0) >= 0 ? 'text-bull' : 'text-bear',
                        )}
                      >
                        {trade.resultCurrency === null ? '—' : fmtCurrency(trade.resultCurrency, currency)}
                      </td>
                      <td>
                        {trade.grade ? (
                          <Tag tone={trade.grade === 'RULE_BREAK' ? 'bear' : trade.grade.startsWith('A') ? 'bull' : 'neutral'}>
                            {trade.grade}
                          </Tag>
                        ) : (
                          <span className="text-2xs text-ink-600">—</span>
                        )}
                      </td>
                      <td className="text-2xs">
                        {trade.processVsOutcome && (
                          <span
                            className={
                              trade.processVsOutcome.tone === 'good'
                                ? 'text-bull'
                                : trade.processVsOutcome.tone === 'bad'
                                  ? 'text-bear'
                                  : 'text-ink-500'
                            }
                          >
                            {trade.processVsOutcome.label}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {active ? (
          <JournalEditor
            trade={active}
            currency={currency}
            onSaved={() => {
              void journal.refresh();
            }}
          />
        ) : (
          <Panel title="Journal entry">
            <EmptyState title="Select a trade" hint="Pick a row to write it up and grade it." />
          </Panel>
        )}
      </div>
    </div>
  );
}

function LiveTradeCard({
  trade,
  currency,
  onChanged,
}: {
  trade: TradeRow;
  currency: string;
  onChanged: () => void;
}) {
  const [partialPrice, setPartialPrice] = useState('');
  const [partialPercent, setPartialPercent] = useState('50');
  const [closePrice, setClosePrice] = useState('');

  const partial = useAction(async () => {
    await post(`/api/trades/${trade.id}/manage`, {
      type: 'partial_close',
      price: Number(partialPrice),
      percent: Number(partialPercent),
      note: `Partial ${partialPercent}%`,
    });
    setPartialPrice('');
    onChanged();
  });

  const breakeven = useAction(async () => {
    await post(`/api/trades/${trade.id}/manage`, {
      type: 'stop_moved',
      newStop: trade.entry,
      note: 'Moved to breakeven',
    });
    onChanged();
  });

  const closeAll = useAction(async () => {
    await post(`/api/trades/${trade.id}/close`, {
      price: Number(closePrice),
      reason: 'Closed manually',
    });
    setClosePrice('');
    onChanged();
  });

  const model = MANAGEMENT_MODELS.find((entry) => entry.id === trade.managementModel);

  return (
    <div className="rounded border border-ink-700 bg-ink-850 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={trade.direction === 'long' ? 'bull' : 'bear'}>{trade.direction}</Tag>
        <span className="num text-sm text-ink-100">{fmtNumber(trade.entry, 2)}</span>
        <span className="text-2xs text-ink-500">{model?.name ?? trade.managementModel}</span>
        {trade.live?.riskFree && <Tag tone="bull">risk free</Tag>}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-6">
        <Stat label="Current R" value={fmtNumber(trade.live?.currentR, 2)} tone={(trade.live?.currentR ?? 0) >= 0 ? 'bull' : 'bear'} />
        <Stat
          label="Unrealised"
          value={fmtCurrency(trade.live?.unrealisedPnl, currency)}
          tone={(trade.live?.unrealisedPnl ?? 0) >= 0 ? 'bull' : 'bear'}
        />
        <Stat label="Realised" value={fmtCurrency(trade.realisedPnl, currency)} />
        <Stat label="Stop" value={fmtNumber(trade.currentStop, 2)} hint={`dist ${fmtNumber(trade.live?.distanceToStop, 2)}`} />
        <Stat
          label="Next target"
          value={trade.live?.nextTarget ? `${trade.live.nextTarget.label} ${fmtNumber(trade.live.nextTarget.price, 2)}` : '—'}
          hint={trade.live?.nextTarget ? `${fmtNumber(trade.live.nextTarget.r, 2)}R` : undefined}
        />
        <Stat
          label="Remaining"
          value={`${fmtNumber(trade.remainingLots, 2)} lots`}
          hint={`${fmtNumber(trade.live?.remainingPercent, 0)}%`}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div className="w-24">
          <label className="field-label">Partial @</label>
          <input className="input" value={partialPrice} onChange={(e) => setPartialPrice(e.target.value)} inputMode="decimal" />
        </div>
        <div className="w-20">
          <label className="field-label">%</label>
          <input className="input" value={partialPercent} onChange={(e) => setPartialPercent(e.target.value)} inputMode="decimal" />
        </div>
        <button type="button" className="btn btn-default" disabled={partial.busy} onClick={() => void partial.run()}>
          Record partial
        </button>
        <button type="button" className="btn btn-default" disabled={breakeven.busy} onClick={() => void breakeven.run()}>
          Stop to breakeven
        </button>
        <div className="w-24">
          <label className="field-label">Close @</label>
          <input className="input" value={closePrice} onChange={(e) => setClosePrice(e.target.value)} inputMode="decimal" />
        </div>
        <button type="button" className="btn btn-bear" disabled={closeAll.busy} onClick={() => void closeAll.run()}>
          Close remaining
        </button>
      </div>

      {(partial.error || breakeven.error || closeAll.error) && (
        <p className="mt-1 text-2xs text-bear">{partial.error ?? breakeven.error ?? closeAll.error}</p>
      )}
    </div>
  );
}

function JournalEditor({
  trade,
  currency,
  onSaved,
}: {
  trade: TradeRow;
  currency: string;
  onSaved: () => void;
}) {
  const entry = trade.journalEntry;
  const [form, setForm] = useState({
    emotion: entry?.emotion ?? '',
    mistake: entry?.mistake ?? '',
    lesson: entry?.lesson ?? '',
    confidence: entry?.confidence ? String(entry.confidence) : '',
    ruleViolation: entry?.ruleViolation ?? '',
    notes: entry?.notes ?? '',
  });
  const [grade, setGrade] = useState<TradeGrade | null>((trade.grade as TradeGrade) ?? null);

  const save = useAction(async () => {
    await put('/api/journal', {
      tradeId: trade.id,
      ...form,
      confidence: form.confidence === '' ? null : Number(form.confidence),
      grade,
    });
    onSaved();
  });

  const attach = useAction(async (file: File, phase: 'before' | 'after') => {
    const body = new FormData();
    body.set('file', file);
    body.set('tradeId', trade.id);
    body.set('phase', phase);
    await upload('/api/screenshots', body);
    onSaved();
  });

  return (
    <Panel
      title="Journal entry"
      subtitle={`${trade.direction} · ${trade.session}`}
      bodyClassName="space-y-2"
    >
      <div className="grid grid-cols-3 gap-x-3 gap-y-2 rounded border border-ink-700 bg-ink-850 p-2">
        <Stat label="Entry" value={fmtNumber(trade.entry, 2)} />
        <Stat label="Stop" value={fmtNumber(trade.initialStop, 2)} />
        <Stat label="Size" value={`${fmtNumber(trade.lotSize, 2)} lots`} />
        <Stat label="Risk" value={`${fmtNumber(trade.riskPercent, 2)}%`} />
        <Stat
          label="Result"
          value={trade.resultR === null ? 'open' : fmtR(trade.resultR)}
          tone={(trade.resultR ?? 0) >= 0 ? 'bull' : 'bear'}
        />
        <Stat label="P/L" value={fmtCurrency(trade.resultCurrency, currency)} />
        <Stat label="MAE" value={fmtNumber(trade.maeR, 2)} />
        <Stat label="MFE" value={fmtNumber(trade.mfeR, 2)} />
        <Stat label="News" value={trade.newsPresent ? 'yes' : 'no'} />
      </div>

      {trade.processVsOutcome && (
        <div
          className={clsx(
            'rounded border px-2 py-1.5',
            trade.processVsOutcome.tone === 'good'
              ? 'border-bull/40 bg-bull/10'
              : trade.processVsOutcome.tone === 'bad'
                ? 'border-bear/40 bg-bear/10'
                : 'border-ink-700 bg-ink-850',
          )}
        >
          <p className="text-xs font-semibold text-ink-100">{trade.processVsOutcome.label}</p>
          <p className="mt-0.5 text-2xs leading-relaxed text-ink-300">{trade.processVsOutcome.note}</p>
        </div>
      )}

      <div>
        <label className="field-label">Grade — process, not outcome</label>
        <div className="grid grid-cols-5 gap-1">
          {TRADE_GRADES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setGrade(option)}
              title={GRADE_DESCRIPTIONS[option]}
              className={clsx(
                'rounded border px-1 py-1 text-2xs font-semibold',
                grade === option
                  ? option === 'RULE_BREAK'
                    ? 'border-bear/60 bg-bear/15 text-bear'
                    : option.startsWith('A')
                      ? 'border-bull/60 bg-bull/15 text-bull'
                      : 'border-accent/60 bg-accent/15 text-accent'
                  : 'border-ink-700 text-ink-400',
              )}
            >
              {option === 'RULE_BREAK' ? 'BREAK' : option}
            </button>
          ))}
        </div>
        {grade && <p className="mt-1 text-2xs leading-relaxed text-ink-500">{GRADE_DESCRIPTIONS[grade]}</p>}
      </div>

      {(
        [
          ['emotion', 'Emotion'],
          ['mistake', 'Mistake'],
          ['lesson', 'Lesson'],
          ['ruleViolation', 'Rule violation'],
        ] as const
      ).map(([key, label]) => (
        <div key={key}>
          <label className="field-label">{label}</label>
          <input
            className="input"
            value={form[key]}
            onChange={(event) => setForm((value) => ({ ...value, [key]: event.target.value }))}
          />
        </div>
      ))}

      <div>
        <label className="field-label">Confidence (1–10)</label>
        <input
          className="input"
          value={form.confidence}
          onChange={(event) => setForm((value) => ({ ...value, confidence: event.target.value }))}
          inputMode="numeric"
        />
      </div>

      <div>
        <label className="field-label">Notes</label>
        <textarea
          className="input min-h-[90px] resize-y"
          value={form.notes}
          onChange={(event) => setForm((value) => ({ ...value, notes: event.target.value }))}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(['before', 'after'] as const).map((phase) => (
          <div key={phase}>
            <label className="field-label">Screenshot {phase}</label>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="w-full text-2xs text-ink-400 file:mr-2 file:rounded file:border file:border-ink-600 file:bg-ink-800 file:px-2 file:py-1 file:text-2xs file:text-ink-200"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void attach.run(file, phase);
              }}
            />
          </div>
        ))}
      </div>

      {(trade.screenshots?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-1">
          {trade.screenshots!.map((shot) => (
            <a
              key={shot.id}
              href={`/api/screenshots/${shot.id}/file`}
              target="_blank"
              rel="noreferrer"
              className="tag border-ink-600 text-ink-300 hover:border-accent hover:text-accent"
            >
              {shot.phase}
            </a>
          ))}
        </div>
      )}

      {(save.error || attach.error) && <p className="text-2xs text-bear">{save.error ?? attach.error}</p>}

      <button type="button" className="btn btn-primary w-full" disabled={save.busy} onClick={() => void save.run()}>
        {save.busy ? 'Saving…' : 'Save journal entry'}
      </button>
    </Panel>
  );
}

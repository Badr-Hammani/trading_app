'use client';

import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { formatDuration, type SessionStatus, type Statistics } from '@xau/core';
import { EmptyState, Panel, Spinner, Stat, Tag } from '@/components/ui/Panel';
import { patch, post, put } from '@/lib/client';
import { fmtCurrency, fmtIsoDateTime, fmtNumber, fmtR, fmtTime } from '@/lib/format';
import { useAction, usePolling } from '@/lib/hooks';

interface PlanResponse {
  date: string;
  timezone: string;
  plan: Record<string, string> | null;
  sessions: SessionStatus;
  keyLevels: { id: string; type: string; price: number; status: string }[];
  events: { id: string; name: string; time: number; importance: string }[];
  trades: {
    id: string;
    direction: string;
    openedAt: string;
    resultR: number | null;
    resultCurrency: number | null;
    grade: string | null;
    ruleViolation: boolean;
    journalEntry: { lesson: string } | null;
  }[];
  missedSetups: { id: string; reason: string; direction: string; time: string; hypotheticalR: number | null }[];
  statistics: Statistics;
  ruleBreaks: number;
  lessons: string[];
}

interface WeeklyResponse {
  review: {
    weekStart: number;
    weekEnd: number;
    statistics: Statistics;
    bestSetup: { label: string; expectancyR: number | null } | null;
    worstSetup: { label: string; expectancyR: number | null } | null;
    bestSession: { label: string; expectancyR: number | null } | null;
    worstSession: { label: string; expectancyR: number | null } | null;
    ruleAdherencePercent: number | null;
    ruleBreaks: number;
    missedSetups: number;
    missedVsTaken: { takenExpectancyR: number | null; missedExpectancyR: number | null; verdict: string };
    recommendations: string[];
    biggestMistake: string | null;
    bestDecision: string | null;
  };
  timezone: string;
}

interface MissedResponse {
  missed: { id: string; reason: string; direction: string; time: string; session: string; hypotheticalR: number | null; notes: string }[];
  byReason: { reason: string; count: number; withOutcome: number; averageR: number | null }[];
  reasons: readonly string[];
}

/**
 * The daily plan: before, during, after.
 *
 * The "after" half is filled in from the record rather than from memory, and
 * the weekly review deliberately shows at most three things to change.
 */
export function PlanView() {
  const plan = usePolling<PlanResponse>('/api/daily-plan', 60_000);
  const weekly = usePolling<WeeklyResponse>('/api/weekly-review', 0);
  const missed = usePolling<MissedResponse>('/api/missed-setups', 60_000);

  const [form, setForm] = useState<Record<string, string>>({});
  useEffect(() => {
    if (plan.data?.plan) {
      setForm(
        Object.fromEntries(
          Object.entries(plan.data.plan).filter(([, value]) => typeof value === 'string'),
        ) as Record<string, string>,
      );
    }
  }, [plan.data?.plan]);

  const save = useAction(async () => {
    await put('/api/daily-plan', {
      liquidityNotes: form.liquidityNotes ?? '',
      expectedVolatility: form.expectedVolatility ?? '',
      londonPlan: form.londonPlan ?? '',
      newYorkPlan: form.newYorkPlan ?? '',
      noTradeConditions: form.noTradeConditions ?? '',
      duringSessionNotes: form.duringSessionNotes ?? '',
      afterSessionNotes: form.afterSessionNotes ?? '',
      lessons: form.lessons ?? '',
    });
    await plan.refresh();
  });

  const saveWeekly = useAction(async () => {
    await post('/api/weekly-review', {
      notes: form.weeklyNotes ?? '',
      biggestMistake: form.weeklyMistake ?? '',
      bestDecision: form.weeklyDecision ?? '',
    });
    await weekly.refresh();
  });

  const setOutcome = useAction(async (id: string, value: string) => {
    await patch('/api/missed-setups', { id, hypotheticalR: value === '' ? null : Number(value) });
    await missed.refresh();
  });

  const timezone = plan.data?.timezone ?? 'UTC';
  const field = (key: string, label: string, rows = 3) => (
    <div key={key}>
      <label className="field-label">{label}</label>
      <textarea
        className={clsx('input resize-y', rows > 2 ? 'min-h-[70px]' : 'min-h-[44px]')}
        value={form[key] ?? ''}
        onChange={(event) => setForm((value) => ({ ...value, [key]: event.target.value }))}
      />
    </div>
  );

  if (plan.loading && !plan.data) {
    return (
      <div className="p-4">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-2 p-2">
      <div className="grid grid-cols-1 gap-2 xl:grid-cols-3">
        {/* ------------------------------------------------ before session */}
        <Panel title="Before session" subtitle={fmtIsoDateTime(plan.data?.date, timezone, 'cccc dd LLLL')} bodyClassName="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Stat
              label="London"
              value={
                plan.data?.sessions.active.some((entry) => entry.definition.kind === 'london')
                  ? 'OPEN'
                  : 'CLOSED'
              }
              mono={false}
            />
            <Stat
              label="New York"
              value={
                plan.data?.sessions.active.some((entry) => entry.definition.kind === 'newyork')
                  ? 'OPEN'
                  : 'CLOSED'
              }
              mono={false}
            />
          </div>
          {plan.data?.sessions.next && (
            <p className="text-2xs text-ink-500">
              Next: {plan.data.sessions.next.definition.name} in{' '}
              {formatDuration(plan.data.sessions.secondsToNextOpen ?? 0)}
            </p>
          )}

          <div>
            <div className="stat-label mb-1">Key levels</div>
            {(plan.data?.keyLevels.length ?? 0) === 0 ? (
              <p className="text-2xs text-ink-600">None marked yet. Mark them on the Charts page.</p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {plan.data!.keyLevels.slice(0, 12).map((level) => (
                  <Tag key={level.id} tone={level.status === 'intact' ? 'neutral' : 'warn'}>
                    {level.type} {fmtNumber(level.price, 2)}
                  </Tag>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="stat-label mb-1">Major news today</div>
            {(plan.data?.events.length ?? 0) === 0 ? (
              <p className="text-2xs text-ink-600">Nothing loaded for today.</p>
            ) : (
              <ul className="space-y-0.5">
                {plan.data!.events.map((event) => (
                  <li key={event.id} className="flex gap-2 text-2xs">
                    <span className="num text-ink-400">{fmtTime(event.time, timezone)}</span>
                    <span className="text-ink-200">{event.name}</span>
                    {event.importance === 'high' && <Tag tone="bear">high</Tag>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {field('liquidityNotes', 'Liquidity and HTF FVGs')}
          {field('expectedVolatility', 'Expected volatility', 2)}
          {field('londonPlan', 'London plan')}
          {field('newYorkPlan', 'New York plan')}
          {field('noTradeConditions', 'No-trade conditions')}
        </Panel>

        {/* ------------------------------------------------ during session */}
        <Panel title="During session" bodyClassName="space-y-2">
          {field('duringSessionNotes', 'Running notes', 6)}
          <p className="text-2xs leading-relaxed text-ink-600">
            The live setup evaluation, checklist and risk calculator live on the Dashboard and
            Setups pages — this is the place for what you noticed while it was happening.
          </p>
        </Panel>

        {/* ------------------------------------------------- after session */}
        <Panel title="After session" bodyClassName="space-y-2">
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <Stat label="Trades" value={plan.data?.statistics.trades ?? 0} />
            <Stat
              label="R"
              value={fmtR(plan.data?.statistics.totalR)}
              tone={(plan.data?.statistics.totalR ?? 0) >= 0 ? 'bull' : 'bear'}
            />
            <Stat label="P/L" value={fmtCurrency(plan.data?.statistics.totalCurrency)} />
            <Stat
              label="Rule breaks"
              value={plan.data?.ruleBreaks ?? 0}
              tone={(plan.data?.ruleBreaks ?? 0) > 0 ? 'bear' : 'bull'}
            />
            <Stat label="Missed setups" value={plan.data?.missedSetups.length ?? 0} />
            <Stat
              label="Adherence"
              value={
                plan.data?.statistics.ruleAdherencePercent === null ||
                plan.data?.statistics.ruleAdherencePercent === undefined
                  ? '—'
                  : `${Math.round(plan.data.statistics.ruleAdherencePercent)}%`
              }
            />
          </div>

          {(plan.data?.trades.length ?? 0) > 0 && (
            <table className="table-dense">
              <tbody>
                {plan.data!.trades.map((trade) => (
                  <tr key={trade.id}>
                    <td className="num text-2xs">{fmtIsoDateTime(trade.openedAt, timezone, 'HH:mm')}</td>
                    <td>
                      <Tag tone={trade.direction === 'long' ? 'bull' : 'bear'}>{trade.direction}</Tag>
                    </td>
                    <td className={clsx('num text-right text-2xs', (trade.resultR ?? 0) >= 0 ? 'text-bull' : 'text-bear')}>
                      {trade.resultR === null ? 'open' : fmtR(trade.resultR)}
                    </td>
                    <td className="text-2xs">{trade.grade ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {field('afterSessionNotes', 'What happened', 4)}
          {field('lessons', 'Lessons', 3)}

          <button type="button" className="btn btn-primary w-full" disabled={save.busy} onClick={() => void save.run()}>
            {save.busy ? 'Saving…' : 'Save daily plan'}
          </button>
          {save.error && <p className="text-2xs text-bear">{save.error}</p>}
        </Panel>
      </div>

      {/* ---------------------------------------------------- missed trades */}
      <Panel
        title="Missed trade tracker"
        subtitle="Valid setups you did not take — and what they would have done"
        bodyClassName="space-y-2"
      >
        {(missed.data?.byReason.length ?? 0) > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {missed.data!.byReason.map((row) => (
              <div key={row.reason} className="rounded border border-ink-700 bg-ink-850 p-2">
                <div className="stat-label truncate">{row.reason}</div>
                <div className="num text-sm text-ink-100">{row.count}</div>
                <div className="text-2xs text-ink-500">
                  {row.averageR === null ? 'no outcomes logged' : `${fmtR(row.averageR)} avg`}
                </div>
              </div>
            ))}
          </div>
        )}

        {(missed.data?.missed.length ?? 0) === 0 ? (
          <EmptyState
            title="Nothing logged yet"
            hint="Log a skipped setup from the Replay page, or straight after you pass on one live. Without this the session filter can never be evaluated."
          />
        ) : (
          <div className="max-h-72 overflow-y-auto">
            <table className="table-dense">
              <thead className="sticky top-0 bg-ink-900">
                <tr>
                  <th>When</th>
                  <th>Dir</th>
                  <th>Session</th>
                  <th>Reason</th>
                  <th className="text-right">Would-be R</th>
                </tr>
              </thead>
              <tbody>
                {missed.data!.missed.map((row) => (
                  <tr key={row.id}>
                    <td className="num text-2xs">{fmtIsoDateTime(row.time, timezone)}</td>
                    <td>
                      <Tag tone={row.direction === 'long' ? 'bull' : 'bear'}>{row.direction}</Tag>
                    </td>
                    <td className="text-2xs text-ink-400">{row.session}</td>
                    <td className="text-2xs">{row.reason}</td>
                    <td className="text-right">
                      <input
                        className="input w-20 py-0.5 text-right text-2xs"
                        defaultValue={row.hypotheticalR ?? ''}
                        placeholder="R"
                        onBlur={(event) => void setOutcome.run(row.id, event.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* --------------------------------------------------- weekly review */}
      {weekly.data && (
        <Panel
          title="Weekly review"
          subtitle={`${fmtTime(weekly.data.review.weekStart, timezone, 'dd LLL')} – ${fmtTime(weekly.data.review.weekEnd, timezone, 'dd LLL')}`}
          bodyClassName="space-y-2"
        >
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 lg:grid-cols-8">
            <Stat label="Trades" value={weekly.data.review.statistics.trades} />
            <Stat label="R" value={fmtR(weekly.data.review.statistics.totalR)} />
            <Stat label="P/L" value={fmtCurrency(weekly.data.review.statistics.totalCurrency)} />
            <Stat
              label="Win rate"
              value={
                weekly.data.review.statistics.winRate === null
                  ? '—'
                  : `${Math.round(weekly.data.review.statistics.winRate)}%`
              }
            />
            <Stat label="Best setup" value={weekly.data.review.bestSetup?.label ?? '—'} mono={false} />
            <Stat label="Worst setup" value={weekly.data.review.worstSetup?.label ?? '—'} mono={false} />
            <Stat label="Best session" value={weekly.data.review.bestSession?.label ?? '—'} mono={false} />
            <Stat
              label="Adherence"
              value={
                weekly.data.review.ruleAdherencePercent === null
                  ? '—'
                  : `${Math.round(weekly.data.review.ruleAdherencePercent)}%`
              }
              tone={(weekly.data.review.ruleAdherencePercent ?? 100) >= 90 ? 'bull' : 'warn'}
            />
          </div>

          <div className="rounded border border-accent/40 bg-accent/5 p-2">
            <div className="stat-label">What to improve next week</div>
            <ol className="mt-1 space-y-1">
              {weekly.data.review.recommendations.map((item, index) => (
                <li key={item} className="text-xs leading-relaxed text-ink-200">
                  <span className="mr-1.5 text-accent">{index + 1}.</span>
                  {item}
                </li>
              ))}
            </ol>
            <p className="mt-1.5 text-2xs text-ink-600">
              Capped at three on purpose. A list of fifteen changes nothing.
            </p>
          </div>

          <p className="rounded border border-ink-700 bg-ink-850 px-2 py-1.5 text-2xs leading-relaxed text-ink-300">
            {weekly.data.review.missedVsTaken.verdict}
          </p>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {field('weeklyMistake', 'Biggest mistake', 2)}
            {field('weeklyDecision', 'Best decision', 2)}
            {field('weeklyNotes', 'Notes', 2)}
          </div>

          <button type="button" className="btn btn-default" disabled={saveWeekly.busy} onClick={() => void saveWeekly.run()}>
            Save weekly review
          </button>
        </Panel>
      )}
    </div>
  );
}

'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { DateTime } from 'luxon';
import type { EntryModel, ManagementModel, Statistics } from '@xau/core';
import { EmptyState, Panel, Spinner, Stat, Tag } from '@/components/ui/Panel';
import { post } from '@/lib/client';
import { fmtNumber, fmtPercent, fmtR } from '@/lib/format';
import { useAction, usePolling } from '@/lib/hooks';

interface Cell {
  entryModel: string;
  entryModelName: string;
  managementModel: string;
  managementModelName: string;
  statistics: Statistics;
  tradeCount: number;
  runnerSurvivalRate: number | null;
  skippedCount: number;
}

interface MatrixResponse {
  experiment: { id: string; name: string; caveat: string };
  matrix: {
    cells: Cell[];
    bestByExpectancy: Cell | null;
    bestByProfitFactor: Cell | null;
    lowestDrawdown: Cell | null;
    caveat: string;
  };
}

interface LabResponse {
  experiments: {
    id: string;
    name: string;
    question: string;
    kind: string;
    caveat: string;
    createdAt: string;
    cells: {
      id: string;
      entryModel: string;
      managementModel: string;
      tradeCount: number;
      runnerSurvivalRate: number | null;
      statistics: Statistics;
    }[];
  }[];
  entryModels: EntryModel[];
  managementModels: ManagementModel[];
}

/**
 * The Strategy Lab.
 *
 * This is the part that can actually answer "does waiting for the second
 * continuation break outperform an immediate FVG confirmation?" — by running
 * both over the same candles rather than by recalling the last few trades.
 */
export function StrategyLabView() {
  const lab = usePolling<LabResponse>('/api/strategy-lab', 0);
  const [result, setResult] = useState<MatrixResponse | null>(null);
  const [form, setForm] = useState({
    name: 'Entry model comparison',
    question: 'Does more confirmation before entry improve expectancy on XAUUSD?',
    from: DateTime.utc().minus({ months: 6 }).toFormat('yyyy-LL-dd'),
    to: DateTime.utc().toFormat('yyyy-LL-dd'),
    riskPercent: '0.5',
    enforceSessionFilter: true,
    entryModels: ['A', 'B', 'C', 'D'] as string[],
    managementModels: ['A', 'B', 'C', 'D'] as string[],
    minimumTradesForRanking: '20',
  });

  const run = useAction(async () => {
    const payload = await post<MatrixResponse>('/api/strategy-lab', {
      name: form.name,
      question: form.question,
      from: Math.floor(DateTime.fromISO(form.from, { zone: 'utc' }).toSeconds()),
      to: Math.floor(DateTime.fromISO(form.to, { zone: 'utc' }).endOf('day').toSeconds()),
      riskPercent: Number(form.riskPercent),
      enforceSessionFilter: form.enforceSessionFilter,
      entryModels: form.entryModels,
      managementModels: form.managementModels,
      minimumTradesForRanking: Number(form.minimumTradesForRanking),
    });
    setResult(payload);
    await lab.refresh();
  });

  const cells = result?.matrix.cells ?? [];

  return (
    <div className="space-y-2 p-2">
      <div className="grid grid-cols-1 gap-2 xl:grid-cols-[minmax(320px,380px)_minmax(0,1fr)]">
        <Panel title="Run an experiment" bodyClassName="space-y-2">
          <div>
            <label className="field-label">Name</label>
            <input
              className="input"
              value={form.name}
              onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))}
            />
          </div>
          <div>
            <label className="field-label">Question you want answered</label>
            <textarea
              className="input min-h-[60px] resize-y"
              value={form.question}
              onChange={(event) => setForm((value) => ({ ...value, question: event.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="field-label">From</label>
              <input
                type="date"
                className="input"
                value={form.from}
                onChange={(event) => setForm((value) => ({ ...value, from: event.target.value }))}
              />
            </div>
            <div>
              <label className="field-label">To</label>
              <input
                type="date"
                className="input"
                value={form.to}
                onChange={(event) => setForm((value) => ({ ...value, to: event.target.value }))}
              />
            </div>
          </div>

          <div>
            <label className="field-label">Entry models</label>
            <div className="space-y-1">
              {(lab.data?.entryModels ?? []).map((model) => (
                <label key={model.id} className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 hover:bg-ink-850">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3.5 w-3.5 accent-violet-500"
                    checked={form.entryModels.includes(model.id)}
                    onChange={(event) =>
                      setForm((value) => ({
                        ...value,
                        entryModels: event.target.checked
                          ? [...value.entryModels, model.id]
                          : value.entryModels.filter((entry) => entry !== model.id),
                      }))
                    }
                  />
                  <span className="min-w-0">
                    <span className="text-xs text-ink-200">
                      {model.id} — {model.name}
                    </span>
                    <span className="block text-2xs leading-relaxed text-ink-600">{model.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="field-label">Management models</label>
            <div className="space-y-1">
              {(lab.data?.managementModels ?? [])
                .filter((model) => ['A', 'B', 'C', 'D'].includes(model.id))
                .map((model) => (
                  <label key={model.id} className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 hover:bg-ink-850">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-3.5 w-3.5 accent-violet-500"
                      checked={form.managementModels.includes(model.id)}
                      onChange={(event) =>
                        setForm((value) => ({
                          ...value,
                          managementModels: event.target.checked
                            ? [...value.managementModels, model.id]
                            : value.managementModels.filter((entry) => entry !== model.id),
                        }))
                      }
                    />
                    <span className="min-w-0">
                      <span className="text-xs text-ink-200">{model.name}</span>
                      <span className="block text-2xs leading-relaxed text-ink-600">{model.description}</span>
                    </span>
                  </label>
                ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="field-label">Risk %</label>
              <input
                className="input"
                value={form.riskPercent}
                onChange={(event) => setForm((value) => ({ ...value, riskPercent: event.target.value }))}
              />
            </div>
            <div>
              <label className="field-label">Min trades to rank</label>
              <input
                className="input"
                value={form.minimumTradesForRanking}
                onChange={(event) =>
                  setForm((value) => ({ ...value, minimumTradesForRanking: event.target.value }))
                }
              />
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-300">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-violet-500"
              checked={form.enforceSessionFilter}
              onChange={(event) =>
                setForm((value) => ({ ...value, enforceSessionFilter: event.target.checked }))
              }
            />
            Only take trades inside permitted sessions
          </label>

          {run.error && (
            <p className="rounded border border-bear/40 bg-bear/10 px-2 py-1 text-2xs text-bear">{run.error}</p>
          )}

          <button type="button" className="btn btn-primary w-full" disabled={run.busy} onClick={() => void run.run()}>
            {run.busy ? 'Running every combination…' : 'Run experiment'}
          </button>

          <p className="text-2xs leading-relaxed text-ink-600">
            Every combination runs over identical candles with identical R targets, so the only
            difference between cells is the model itself.
          </p>
        </Panel>

        <div className="space-y-2">
          {run.busy && (
            <Panel title="Running">
              <Spinner label="Simulating every entry × management combination" />
            </Panel>
          )}

          {result && (
            <>
              <Panel title="Best of this run" bodyClassName="space-y-2">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Best label="Highest expectancy" cell={result.matrix.bestByExpectancy} />
                  <Best label="Highest profit factor" cell={result.matrix.bestByProfitFactor} />
                  <Best label="Lowest drawdown" cell={result.matrix.lowestDrawdown} />
                </div>
                <p className="rounded border border-warn/40 bg-warn/10 px-2 py-1.5 text-2xs leading-relaxed text-warn">
                  {result.matrix.caveat}
                </p>
              </Panel>

              <Panel title="Full matrix" bodyClassName="p-0">
                <div className="overflow-x-auto">
                  <table className="table-dense">
                    <thead>
                      <tr>
                        <th>Entry</th>
                        <th>Management</th>
                        <th className="text-right">Trades</th>
                        <th className="text-right">Win %</th>
                        <th className="text-right">Expectancy</th>
                        <th className="text-right">PF</th>
                        <th className="text-right">Total R</th>
                        <th className="text-right">Max DD</th>
                        <th className="text-right">Avg R</th>
                        <th className="text-right">Runner survival</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...cells]
                        .sort(
                          (a, b) =>
                            (b.statistics.expectancyR ?? -Infinity) - (a.statistics.expectancyR ?? -Infinity),
                        )
                        .map((cell) => (
                          <tr key={`${cell.entryModel}-${cell.managementModel}`}>
                            <td>
                              <Tag tone="accent">{cell.entryModel}</Tag>
                            </td>
                            <td className="text-2xs">{cell.managementModel}</td>
                            <td className="num text-right">{cell.tradeCount}</td>
                            <td className="num text-right">{fmtPercent(cell.statistics.winRate, 0)}</td>
                            <td
                              className={clsx(
                                'num text-right font-semibold',
                                (cell.statistics.expectancyR ?? 0) >= 0 ? 'text-bull' : 'text-bear',
                              )}
                            >
                              {fmtR(cell.statistics.expectancyR)}
                            </td>
                            <td className="num text-right">
                              {cell.statistics.profitFactor === null
                                ? '—'
                                : fmtNumber(cell.statistics.profitFactor, 2)}
                            </td>
                            <td className="num text-right">{fmtR(cell.statistics.totalR)}</td>
                            <td className="num text-right text-bear">
                              {fmtNumber(cell.statistics.maxDrawdownR, 2)}R
                            </td>
                            <td className="num text-right">{fmtR(cell.statistics.averageR)}</td>
                            <td className="num text-right">
                              {fmtPercent(cell.runnerSurvivalRate, 0)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </>
          )}

          <Panel title="Saved experiments" bodyClassName="space-y-2">
            {(lab.data?.experiments.length ?? 0) === 0 ? (
              <EmptyState
                title="No experiments run yet"
                hint="Import history under Settings → Data, then run the matrix over a period you actually traded."
              />
            ) : (
              lab.data!.experiments.map((experiment) => {
                const best = [...experiment.cells].sort(
                  (a, b) => (b.statistics.expectancyR ?? -Infinity) - (a.statistics.expectancyR ?? -Infinity),
                )[0];
                return (
                  <div key={experiment.id} className="rounded border border-ink-700 bg-ink-850 p-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-xs font-medium text-ink-100">{experiment.name}</span>
                      <span className="text-2xs text-ink-500">
                        {DateTime.fromISO(experiment.createdAt).toFormat('dd LLL yyyy')}
                      </span>
                    </div>
                    {experiment.question && (
                      <p className="mt-0.5 text-2xs italic leading-relaxed text-ink-400">
                        {experiment.question}
                      </p>
                    )}
                    {best && (
                      <p className="mt-1 text-2xs text-ink-300">
                        Best cell: entry {best.entryModel} × management {best.managementModel} —{' '}
                        <span className={(best.statistics.expectancyR ?? 0) >= 0 ? 'text-bull' : 'text-bear'}>
                          {fmtR(best.statistics.expectancyR)}
                        </span>{' '}
                        over {best.tradeCount} trades
                      </p>
                    )}
                    <p className="mt-1 text-2xs text-ink-600">{experiment.caveat}</p>
                  </div>
                );
              })
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Best({ label, cell }: { label: string; cell: Cell | null }) {
  if (!cell) {
    return (
      <div className="rounded border border-ink-700 bg-ink-850 p-2">
        <div className="stat-label">{label}</div>
        <div className="mt-1 text-2xs text-ink-500">No qualifying variant</div>
      </div>
    );
  }
  return (
    <div className="rounded border border-accent/40 bg-accent/5 p-2">
      <div className="stat-label">{label}</div>
      <div className="mt-1 text-sm text-ink-100">
        Entry {cell.entryModel} × {cell.managementModel}
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <Stat label="Expectancy" value={fmtR(cell.statistics.expectancyR)} />
        <Stat label="Trades" value={cell.tradeCount} />
      </div>
    </div>
  );
}

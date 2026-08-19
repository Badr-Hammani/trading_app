'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { summariseChecklist } from '@xau/core';
import type { RiskResult } from '@xau/core';
import { HeaderStrip } from '@/components/panels/HeaderStrip';
import { SetupStages, ExecutionStatus, STATUS_META } from '@/components/panels/SetupStages';
import { ChecklistPanel } from '@/components/panels/ChecklistPanel';
import { RiskCalculator, EMPTY_RISK_INPUTS, type RiskInputs } from '@/components/panels/RiskCalculator';
import { EmptyState, Panel, Spinner, Tag } from '@/components/ui/Panel';
import { post } from '@/lib/client';
import { fmtIsoDateTime, fmtNumber, parseNumberInput } from '@/lib/format';
import { useAction, usePolling } from '@/lib/hooks';
import { useAppStore } from '@/store/app';
import type { AnalysisResponse } from '@/lib/types';

interface SetupRow {
  id: string;
  direction: string;
  status: string;
  session: string;
  setupType: string | null;
  entry: number | null;
  stopLoss: number | null;
  takeProfit1: number | null;
  riskPercent: number | null;
  createdAt: string;
  missingConditions: string[];
  trade: { id: string; status: string; resultR: number | null } | null;
}

/**
 * The setup builder.
 *
 * The whole page is arranged so that saving a setup and recording a trade are
 * two separate, deliberate actions. Nothing here sends an order anywhere.
 */
export function SetupsView() {
  const { timeframe, direction, setDirection, refreshMs } = useAppStore();
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [risk, setRisk] = useState<RiskInputs>(EMPTY_RISK_INPUTS);
  const [riskResult, setRiskResult] = useState<RiskResult | null>(null);
  const [notes, setNotes] = useState('');
  const [saved, setSaved] = useState<string | null>(null);

  const analysis = usePolling<AnalysisResponse>(`/api/analysis?timeframe=${timeframe}`, refreshMs);
  const setups = usePolling<{ setups: SetupRow[] }>('/api/setups', 60_000);

  const data = analysis.data;
  const timezone = data?.timezone ?? 'UTC';
  const evaluation = direction === 'long' ? data?.long : data?.short;
  const summary = summariseChecklist(direction, checklist);

  const saveSetup = useAction(async () => {
    const result = await post<{ setup: { id: string } }>('/api/setups', {
      direction,
      checklist,
      entry: parseNumberInput(risk.entry),
      stopLoss: parseNumberInput(risk.stopLoss),
      takeProfit1: parseNumberInput(risk.takeProfit1),
      takeProfit2: parseNumberInput(risk.takeProfit2),
      takeProfit3: parseNumberInput(risk.takeProfit3),
      riskPercent: parseNumberInput(risk.riskPercent),
      lotSize: riskResult?.lotSize ?? null,
      notes,
    });
    setSaved(result.setup.id);
    await setups.refresh();
  });

  const recordTrade = useAction(async (setupId: string | null) => {
    const entry = parseNumberInput(risk.entry);
    const stopLoss = parseNumberInput(risk.stopLoss);
    const riskPercent = parseNumberInput(risk.riskPercent);
    if (entry === null || stopLoss === null || riskPercent === null) {
      throw new Error('Entry, stop loss and risk percent are required before recording a trade.');
    }
    await post('/api/trades', {
      setupId,
      direction,
      entry,
      stopLoss,
      takeProfit1: parseNumberInput(risk.takeProfit1),
      takeProfit2: parseNumberInput(risk.takeProfit2),
      takeProfit3: parseNumberInput(risk.takeProfit3),
      riskPercent,
      lotSize: riskResult?.lotSize ?? null,
      notes,
    });
    setSaved(null);
    setChecklist({});
    setNotes('');
    await setups.refresh();
  });

  return (
    <div className="space-y-2 p-2">
      <HeaderStrip newsRisk={evaluation?.newsRisk ?? null} />

      <div className="grid grid-cols-1 gap-2 xl:grid-cols-3">
        <div className="space-y-2">
          <Panel title="Direction" bodyClassName="p-2">
            <div className="flex gap-1">
              {(['long', 'short'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setDirection(option);
                    setRisk((value) => ({ ...value, direction: option }));
                  }}
                  className={clsx(
                    'flex-1 rounded border px-2 py-1.5 text-xs font-medium uppercase',
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

          {analysis.loading && !evaluation ? (
            <Panel title="Model">
              <Spinner />
            </Panel>
          ) : evaluation ? (
            <SetupStages evaluation={evaluation} />
          ) : (
            <Panel title="Model">
              <EmptyState
                title="No market data"
                hint="Import candles under Settings → Data or configure a provider to evaluate the model."
              />
            </Panel>
          )}
        </div>

        <div className="space-y-2">
          <ChecklistPanel
            direction={direction}
            state={checklist}
            onChange={setChecklist}
            onApplySuggestion={
              data?.dominant?.direction === direction
                ? () => setChecklist(data.dominant!.checklist.state)
                : undefined
            }
          />
          {evaluation && (
            <Panel title="Execution status" bodyClassName="p-2">
              <ExecutionStatus evaluation={evaluation} />
            </Panel>
          )}
        </div>

        <div className="space-y-2">
          <RiskCalculator inputs={risk} onChange={setRisk} onResult={setRiskResult} compact />

          <Panel title="Record" bodyClassName="space-y-2">
            <div>
              <label className="field-label">Notes</label>
              <textarea
                className="input min-h-[70px] resize-y"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="What made this setup, and what would invalidate it?"
              />
            </div>

            {evaluation && (
              <div className="rounded border border-ink-700 bg-ink-850 px-2 py-1.5">
                <div className="flex items-center justify-between">
                  <span className="stat-label">Engine</span>
                  <Tag tone={STATUS_META[evaluation.setupStatus].tone}>
                    {STATUS_META[evaluation.setupStatus].label}
                  </Tag>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="stat-label">Your checklist</span>
                  <Tag tone={summary.qualified ? 'bull' : 'neutral'}>
                    {summary.mandatoryChecked}/{summary.mandatoryTotal}
                  </Tag>
                </div>
              </div>
            )}

            <button
              type="button"
              className="btn btn-primary w-full"
              disabled={saveSetup.busy}
              onClick={() => void saveSetup.run()}
            >
              {saveSetup.busy ? 'Saving…' : 'Save setup'}
            </button>

            <button
              type="button"
              className={clsx('btn w-full', direction === 'long' ? 'btn-bull' : 'btn-bear')}
              disabled={recordTrade.busy}
              onClick={() => void recordTrade.run(saved)}
            >
              {recordTrade.busy ? 'Recording…' : 'Record trade I placed'}
            </button>

            {(saveSetup.error || recordTrade.error) && (
              <p className="rounded border border-bear/40 bg-bear/10 px-2 py-1 text-2xs text-bear">
                {saveSetup.error ?? recordTrade.error}
              </p>
            )}

            <p className="text-2xs leading-relaxed text-ink-600">
              Recording a trade logs a decision you already made with your broker. This application
              has no order execution and will not place anything for you.
            </p>
          </Panel>
        </div>
      </div>

      <Panel title="Saved setups" subtitle={`${setups.data?.setups.length ?? 0} recorded`} bodyClassName="p-0">
        {(setups.data?.setups.length ?? 0) === 0 ? (
          <div className="p-3">
            <EmptyState title="No setups saved yet" />
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <table className="table-dense">
              <thead className="sticky top-0 bg-ink-900">
                <tr>
                  <th>Created</th>
                  <th>Dir</th>
                  <th>Status</th>
                  <th>Session</th>
                  <th>Type</th>
                  <th className="text-right">Entry</th>
                  <th className="text-right">Stop</th>
                  <th>Outcome</th>
                </tr>
              </thead>
              <tbody>
                {setups.data!.setups.map((setup) => (
                  <tr key={setup.id}>
                    <td className="num text-2xs">{fmtIsoDateTime(setup.createdAt, timezone)}</td>
                    <td>
                      <Tag tone={setup.direction === 'long' ? 'bull' : 'bear'}>{setup.direction}</Tag>
                    </td>
                    <td className="text-2xs">{setup.status}</td>
                    <td className="text-2xs text-ink-400">{setup.session || '—'}</td>
                    <td className="text-2xs text-ink-400">{setup.setupType ?? '—'}</td>
                    <td className="num text-right text-2xs">{fmtNumber(setup.entry, 2)}</td>
                    <td className="num text-right text-2xs">{fmtNumber(setup.stopLoss, 2)}</td>
                    <td className="text-2xs">
                      {setup.trade ? (
                        <span className={setup.trade.resultR && setup.trade.resultR >= 0 ? 'text-bull' : 'text-bear'}>
                          {setup.trade.resultR === null
                            ? 'open'
                            : `${setup.trade.resultR >= 0 ? '+' : ''}${setup.trade.resultR.toFixed(2)}R`}
                        </span>
                      ) : (
                        <span className="text-ink-600">not traded</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

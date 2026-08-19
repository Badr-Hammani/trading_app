'use client';

import { useEffect, useState } from 'react';
import clsx from 'clsx';
import type { InstrumentSpec, RiskResult } from '@xau/core';
import { Panel, Stat } from '@/components/ui/Panel';
import { post } from '@/lib/client';
import { fmtCurrency, fmtNumber, parseNumberInput } from '@/lib/format';

export interface RiskInputs {
  direction: 'long' | 'short';
  entry: string;
  stopLoss: string;
  takeProfit1: string;
  takeProfit2: string;
  takeProfit3: string;
  riskPercent: string;
}

export const EMPTY_RISK_INPUTS: RiskInputs = {
  direction: 'long',
  entry: '',
  stopLoss: '',
  takeProfit1: '',
  takeProfit2: '',
  takeProfit3: '',
  riskPercent: '0.5',
};

interface RiskResponse {
  result: RiskResult;
  instrument: InstrumentSpec;
  accountBalance: number;
  currency: string;
  presets: readonly number[];
  maxRiskPercent: number;
  specNote: string;
}

/**
 * Position sizing.
 *
 * The calculation steps are always visible. The trader should be able to check
 * the arithmetic rather than trust a number that appeared in a box.
 */
export function RiskCalculator({
  inputs,
  onChange,
  onResult,
  compact = false,
}: {
  inputs: RiskInputs;
  onChange: (inputs: RiskInputs) => void;
  onResult?: (result: RiskResult | null) => void;
  compact?: boolean;
}) {
  const [response, setResponse] = useState<RiskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSteps, setShowSteps] = useState(!compact);

  const entry = parseNumberInput(inputs.entry);
  const stopLoss = parseNumberInput(inputs.stopLoss);
  const riskPercent = parseNumberInput(inputs.riskPercent);

  useEffect(() => {
    if (entry === null || stopLoss === null || riskPercent === null) {
      setResponse(null);
      onResult?.(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const payload = await post<RiskResponse>('/api/risk', {
          direction: inputs.direction,
          entry,
          stopLoss,
          takeProfit1: parseNumberInput(inputs.takeProfit1),
          takeProfit2: parseNumberInput(inputs.takeProfit2),
          takeProfit3: parseNumberInput(inputs.takeProfit3),
          riskPercent,
        });
        if (cancelled) return;
        setResponse(payload);
        setError(null);
        onResult?.(payload.result);
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : 'Calculation failed.');
        setResponse(null);
        onResult?.(null);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    inputs.direction,
    inputs.entry,
    inputs.stopLoss,
    inputs.takeProfit1,
    inputs.takeProfit2,
    inputs.takeProfit3,
    inputs.riskPercent,
  ]);

  const result = response?.result;
  const currency = response?.currency ?? 'USD';

  const set = (patch: Partial<RiskInputs>) => onChange({ ...inputs, ...patch });

  return (
    <Panel
      title="Risk calculator"
      subtitle={
        response ? `Balance ${fmtCurrency(response.accountBalance, currency, 0)}` : 'Position sizing'
      }
      bodyClassName="space-y-2"
    >
      <div className="flex gap-1">
        {(['long', 'short'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => set({ direction: option })}
            className={clsx(
              'flex-1 rounded border px-2 py-1 text-xs font-medium uppercase',
              inputs.direction === option
                ? option === 'long'
                  ? 'border-bull/50 bg-bull/15 text-bull'
                  : 'border-bear/50 bg-bear/15 text-bear'
                : 'border-ink-700 text-ink-400 hover:border-ink-600',
            )}
          >
            {option}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Entry" value={inputs.entry} onChange={(value) => set({ entry: value })} />
        <Field label="Stop loss" value={inputs.stopLoss} onChange={(value) => set({ stopLoss: value })} />
        <Field label="TP1" value={inputs.takeProfit1} onChange={(value) => set({ takeProfit1: value })} />
        <Field label="TP2" value={inputs.takeProfit2} onChange={(value) => set({ takeProfit2: value })} />
        <Field label="TP3" value={inputs.takeProfit3} onChange={(value) => set({ takeProfit3: value })} />
        <div>
          <label className="field-label">Risk %</label>
          <input
            className="input"
            value={inputs.riskPercent}
            onChange={(event) => set({ riskPercent: event.target.value })}
            inputMode="decimal"
          />
        </div>
      </div>

      <div className="flex gap-1">
        {(response?.presets ?? [0.25, 0.5, 1]).map((preset) => (
          <button
            key={preset}
            type="button"
            className={clsx(
              'btn flex-1',
              Number(inputs.riskPercent) === preset ? 'btn-primary' : 'btn-default',
            )}
            onClick={() => set({ riskPercent: String(preset) })}
          >
            {preset}%
          </button>
        ))}
      </div>

      {error && <p className="rounded border border-bear/40 bg-bear/10 px-2 py-1 text-2xs text-bear">{error}</p>}

      {result && (
        <>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 rounded border border-ink-700 bg-ink-850 p-2">
            <Stat
              label="Position size"
              value={result.lotSize > 0 ? `${fmtNumber(result.lotSize, 2)} lots` : '—'}
              tone={result.valid ? 'info' : 'warn'}
              hint={`${fmtNumber(result.units, 2)} units`}
            />
            <Stat
              label="Dollar risk"
              value={fmtCurrency(result.actualRiskAmount, currency)}
              hint={`${fmtNumber(result.actualRiskPercent, 2)}% of balance`}
            />
            <Stat label="Stop distance" value={fmtNumber(result.stopDistance, 2)} />
            <Stat
              label="Max R:R"
              value={result.maxRR === null ? '—' : `${fmtNumber(result.maxRR, 2)}R`}
            />
          </div>

          {result.targets.length > 0 && (
            <table className="table-dense">
              <thead>
                <tr>
                  <th>Target</th>
                  <th className="text-right">Price</th>
                  <th className="text-right">R</th>
                  <th className="text-right">P/L</th>
                </tr>
              </thead>
              <tbody>
                {result.targets.map((target) => (
                  <tr key={target.label}>
                    <td>{target.label}</td>
                    <td className="num text-right">{fmtNumber(target.price, 2)}</td>
                    <td className="num text-right">{fmtNumber(target.rMultiple, 2)}R</td>
                    <td className="num text-right text-bull">{fmtCurrency(target.profit, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {result.warnings.map((warning) => (
            <p
              key={warning}
              className="rounded border border-warn/40 bg-warn/10 px-2 py-1 text-2xs leading-relaxed text-warn"
            >
              {warning}
            </p>
          ))}
          {result.errors.map((message) => (
            <p
              key={message}
              className="rounded border border-bear/40 bg-bear/10 px-2 py-1 text-2xs leading-relaxed text-bear"
            >
              {message}
            </p>
          ))}

          <button
            type="button"
            className="btn btn-ghost w-full"
            onClick={() => setShowSteps((value) => !value)}
          >
            {showSteps ? 'Hide calculation' : 'Show calculation'}
          </button>

          {showSteps && (
            <ol className="space-y-0.5 rounded border border-ink-800 bg-ink-950 p-2 font-mono text-2xs leading-relaxed text-ink-400">
              {result.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          )}

          {response && (
            <p className="text-2xs leading-relaxed text-ink-600">{response.specNote}</p>
          )}
        </>
      )}
    </Panel>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="field-label">{label}</label>
      <input
        className="input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode="decimal"
        placeholder="—"
      />
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import type { InstrumentSpec } from '@xau/core';
import { RiskCalculator, EMPTY_RISK_INPUTS, type RiskInputs } from '@/components/panels/RiskCalculator';
import { Panel, Spinner, Stat } from '@/components/ui/Panel';
import { patch, put } from '@/lib/client';
import { fmtCurrency, fmtNumber } from '@/lib/format';
import { useAction, usePolling } from '@/lib/hooks';
import { useAppStore } from '@/store/app';

interface AccountResponse {
  accounts: { id: string; name: string; broker: string; currency: string; balance: number; isDefault: boolean }[];
  instruments: (InstrumentSpec & { id: string; brokerNote: string })[];
}

/**
 * Risk page.
 *
 * The contract specification is editable here because sizing depends on it
 * entirely, and gold contract sizes differ between brokers. Getting this wrong
 * makes every position size wrong by the same factor.
 */
export function RiskView() {
  const [inputs, setInputs] = useState<RiskInputs>(EMPTY_RISK_INPUTS);
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null);
  const consumePendingTrade = useAppStore((state) => state.consumePendingTrade);

  // A signal loaded on the dashboard arrives here. Consumed once, so coming
  // back later does not silently overwrite whatever is being worked on.
  useEffect(() => {
    const pending = consumePendingTrade();
    if (!pending) return;
    const text = (value: number | null): string =>
      value === null || !Number.isFinite(value) ? '' : String(value);
    setInputs((current) => ({
      ...current,
      direction: pending.direction,
      entry: text(pending.entry),
      stopLoss: text(pending.stopLoss),
      takeProfit1: text(pending.takeProfit1),
      takeProfit2: text(pending.takeProfit2),
      takeProfit3: text(pending.takeProfit3),
    }));
    setLoadedFrom(pending.label);
  }, [consumePendingTrade]);
  const account = usePolling<AccountResponse>('/api/account', 0);

  const primary = account.data?.accounts.find((entry) => entry.isDefault) ?? account.data?.accounts[0];
  const instrument = account.data?.instruments.find((entry) => entry.symbol === 'XAUUSD');

  return (
    <div className="grid grid-cols-1 gap-2 p-2 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <div className="space-y-2">
        {loadedFrom && (
          <p className="rounded-card border border-accent/40 bg-accent/10 px-2.5 py-2 text-2xs leading-relaxed text-ink-200">
            Prefilled from <span className="font-semibold text-accent">{loadedFrom}</span>. These
            are the signal&rsquo;s levels — edit anything before sizing.
          </p>
        )}
        <RiskCalculator inputs={inputs} onChange={setInputs} />
      </div>

      <div className="space-y-2">
        {account.loading ? (
          <Panel title="Account">
            <Spinner />
          </Panel>
        ) : (
          <>
            {primary && <AccountForm account={primary} onSaved={() => void account.refresh()} />}
            {instrument && <InstrumentForm instrument={instrument} onSaved={() => void account.refresh()} />}
          </>
        )}

        <Panel title="How the size is derived" bodyClassName="space-y-2 text-2xs leading-relaxed text-ink-400">
          <p>
            Risk amount = balance × risk %. Risk per lot = stop distance × the account-currency value
            of a 1.00 price move for one lot, which comes from the contract specification rather
            than a fixed assumption about gold.
          </p>
          <p>
            Position size = risk amount ÷ risk per lot, rounded <strong>down</strong> to the broker
            lot step. Rounding down means the realised risk is always at or below the intended risk,
            never above it.
          </p>
          <p>
            If the result falls below the broker minimum, the calculator reports that rather than
            rounding up into a larger position than you asked for.
          </p>
        </Panel>

        {instrument && (
          <Panel title="Worked example" bodyClassName="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="1.00 move / lot"
              value={fmtCurrency(instrument.tickValue / instrument.tickSize, instrument.quoteCurrency)}
            />
            <Stat label="Contract size" value={`${fmtNumber(instrument.contractSize, 0)} units`} />
            <Stat label="Lot step" value={fmtNumber(instrument.lotStep, 2)} />
            <Stat label="Min lot" value={fmtNumber(instrument.minLot, 2)} />
          </Panel>
        )}
      </div>
    </div>
  );
}

function AccountForm({
  account,
  onSaved,
}: {
  account: { id: string; name: string; broker: string; currency: string; balance: number };
  onSaved: () => void;
}) {
  const [name, setName] = useState(account.name);
  const [broker, setBroker] = useState(account.broker);
  const [balance, setBalance] = useState(String(account.balance));
  const [currency, setCurrency] = useState(account.currency);

  const save = useAction(async () => {
    await put('/api/account', {
      id: account.id,
      name,
      broker,
      currency,
      balance: Number(balance),
      isDefault: true,
    });
    onSaved();
  });

  return (
    <Panel title="Account" bodyClassName="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="field-label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="field-label">Broker</label>
          <input className="input" value={broker} onChange={(e) => setBroker(e.target.value)} />
        </div>
        <div>
          <label className="field-label">Balance</label>
          <input className="input" value={balance} onChange={(e) => setBalance(e.target.value)} inputMode="decimal" />
        </div>
        <div>
          <label className="field-label">Currency</label>
          <input className="input" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} />
        </div>
      </div>
      {save.error && <p className="text-2xs text-bear">{save.error}</p>}
      <button type="button" className="btn btn-primary" disabled={save.busy} onClick={() => void save.run()}>
        Save account
      </button>
    </Panel>
  );
}

function InstrumentForm({
  instrument,
  onSaved,
}: {
  instrument: InstrumentSpec & { brokerNote: string };
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    contractSize: String(instrument.contractSize),
    tickSize: String(instrument.tickSize),
    tickValue: String(instrument.tickValue),
    minLot: String(instrument.minLot),
    maxLot: String(instrument.maxLot),
    lotStep: String(instrument.lotStep),
    pricePrecision: String(instrument.pricePrecision),
    brokerNote: instrument.brokerNote,
  });

  const save = useAction(async () => {
    await patch('/api/account', {
      symbol: instrument.symbol,
      displayName: instrument.displayName,
      quoteCurrency: instrument.quoteCurrency,
      contractSize: Number(form.contractSize),
      tickSize: Number(form.tickSize),
      tickValue: Number(form.tickValue),
      minLot: Number(form.minLot),
      maxLot: Number(form.maxLot),
      lotStep: Number(form.lotStep),
      pricePrecision: Number(form.pricePrecision),
      brokerNote: form.brokerNote,
    });
    onSaved();
  });

  const field = (key: keyof typeof form, label: string) => (
    <div key={key}>
      <label className="field-label">{label}</label>
      <input
        className="input"
        value={form[key]}
        onChange={(event) => setForm((value) => ({ ...value, [key]: event.target.value }))}
        inputMode="decimal"
      />
    </div>
  );

  return (
    <Panel
      title={`Contract specification · ${instrument.symbol}`}
      subtitle="Confirm these against your own broker"
      bodyClassName="space-y-2"
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {field('contractSize', 'Contract size')}
        {field('tickSize', 'Tick size')}
        {field('tickValue', 'Tick value')}
        {field('pricePrecision', 'Price decimals')}
        {field('minLot', 'Min lot')}
        {field('maxLot', 'Max lot')}
        {field('lotStep', 'Lot step')}
      </div>
      <div>
        <label className="field-label">Note</label>
        <input
          className="input"
          value={form.brokerNote}
          onChange={(event) => setForm((value) => ({ ...value, brokerNote: event.target.value }))}
        />
      </div>
      {save.error && <p className="text-2xs text-bear">{save.error}</p>}
      <button type="button" className="btn btn-primary" disabled={save.busy} onClick={() => void save.run()}>
        Save specification
      </button>
      <p className="text-2xs leading-relaxed text-ink-600">
        Changing these changes every future position size. Historical trades keep the size that was
        actually taken.
      </p>
    </Panel>
  );
}

'use client';

import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { TIMEFRAMES, formatHhMm, parseHhMm } from '@xau/core';
import { Panel, Spinner, Tag } from '@/components/ui/Panel';
import { patch, post, put, upload } from '@/lib/client';
import { fmtIsoDateTime } from '@/lib/format';
import { useAction, usePolling } from '@/lib/hooks';

interface SessionRow {
  id: string;
  name: string;
  kind: string;
  timezone: string;
  startMinutes: number;
  endMinutes: number;
  days: number[];
  tradingPermitted: boolean;
  enabled: boolean;
  color: string;
}

interface SettingsResponse {
  user: { email: string; displayName: string; timezone: string };
  settings: Record<string, unknown> | null;
  account: { balance: number; currency: string } | null;
  sessions: SessionRow[];
  strategyVersions: { id: string; version: string; name: string; isActive: boolean; createdAt: string; notes: string }[];
  providers: { id: string; name: string; configured: boolean; website?: string; setupHint?: string }[];
  safety: Record<string, string>;
}

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function SettingsView() {
  const settings = usePolling<SettingsResponse>('/api/settings', 0);
  const series = usePolling<{ series: { id: string; symbol: string; timeframe: string; provider: string; barCount: number; importedFrom: string | null; firstTime: string; lastTime: string; gapCount: number }[] }>(
    '/api/market/import',
    0,
  );
  const telegram = usePolling<{ configured: boolean; enabled: boolean; chatId: string | null; commands: { command: string; description: string }[] }>(
    '/api/telegram',
    0,
  );

  if (settings.loading && !settings.data) {
    return (
      <div className="p-4">
        <Spinner />
      </div>
    );
  }

  const data = settings.data;
  if (!data) return <div className="p-4 text-xs text-bear">{settings.error}</div>;

  return (
    <div className="grid grid-cols-1 gap-2 p-2 xl:grid-cols-2">
      <div className="space-y-2">
        <ProfileSection data={data} onSaved={() => void settings.refresh()} />
        <StrategySection data={data} onSaved={() => void settings.refresh()} />
        <SessionsSection sessions={data.sessions} onSaved={() => void settings.refresh()} />
      </div>

      <div className="space-y-2">
        <ProvidersSection providers={data.providers} />
        <DataSection series={series.data?.series ?? []} onImported={() => void series.refresh()} timezone={data.user.timezone} />
        <StrategyVersionsSection versions={data.strategyVersions} onSaved={() => void settings.refresh()} />
        <TelegramSection state={telegram.data} onSaved={() => void telegram.refresh()} />
        <Panel title="Safety" bodyClassName="space-y-1.5">
          {Object.entries(data.safety).map(([key, value]) => (
            <p key={key} className="text-2xs leading-relaxed text-ink-400">
              · {value}
            </p>
          ))}
        </Panel>
      </div>
    </div>
  );
}

function ProfileSection({ data, onSaved }: { data: SettingsResponse; onSaved: () => void }) {
  const [displayName, setDisplayName] = useState(data.user.displayName);
  const [timezone, setTimezone] = useState(data.user.timezone);

  const save = useAction(async () => {
    await patch('/api/settings', { displayName, timezone });
    onSaved();
  });

  return (
    <Panel title="Profile" bodyClassName="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="field-label">Name</label>
          <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div>
          <label className="field-label">Timezone (IANA)</label>
          <input className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        </div>
      </div>
      <p className="text-2xs text-ink-600">
        Every session window and event time in the app is converted into this zone.
      </p>
      {save.error && <p className="text-2xs text-bear">{save.error}</p>}
      <button type="button" className="btn btn-primary" disabled={save.busy} onClick={() => void save.run()}>
        Save profile
      </button>
    </Panel>
  );
}

function StrategySection({ data, onSaved }: { data: SettingsResponse; onSaved: () => void }) {
  const s = (data.settings ?? {}) as Record<string, never>;
  const [form, setForm] = useState({
    defaultRiskPercent: String((s.defaultRiskPercent as unknown as number) ?? 0.5),
    maxRiskPercent: String((s.maxRiskPercent as unknown as number) ?? 1),
    minDisplacementScore: String((s.minDisplacementScore as unknown as number) ?? 60),
    maxFvgMitigation: String((s.maxFvgMitigation as unknown as number) ?? 0.9),
    newsWindowMinutes: String((s.newsWindowMinutes as unknown as number) ?? 30),
    maxBarsFromStructureBreak: String((s.maxBarsFromStructureBreak as unknown as number) ?? 24),
    sensitivity: ((s.sensitivity as unknown as string) ?? 'balanced') as 'conservative' | 'balanced' | 'sensitive',
    requireChoch: Boolean(s.requireChoch),
    requireFvgAfterStructure: (s.requireFvgAfterStructure as unknown as boolean) ?? true,
    enforceSessionFilter: (s.enforceSessionFilter as unknown as boolean) ?? true,
    newsFilterEnabled: Boolean(s.newsFilterEnabled),
    manualBlockActive: Boolean(s.manualBlockActive),
    manualBlockReason: ((s.manualBlockReason as unknown as string) ?? ''),
    aiBiasSuggestionEnabled: Boolean(s.aiBiasSuggestionEnabled),
    aiAssistantEnabled: (s.aiAssistantEnabled as unknown as boolean) ?? true,
  });

  const save = useAction(async () => {
    await patch('/api/settings', {
      defaultRiskPercent: Number(form.defaultRiskPercent),
      maxRiskPercent: Number(form.maxRiskPercent),
      minDisplacementScore: Number(form.minDisplacementScore),
      maxFvgMitigation: Number(form.maxFvgMitigation),
      newsWindowMinutes: Number(form.newsWindowMinutes),
      maxBarsFromStructureBreak: Number(form.maxBarsFromStructureBreak),
      sensitivity: form.sensitivity,
      requireChoch: form.requireChoch,
      requireFvgAfterStructure: form.requireFvgAfterStructure,
      enforceSessionFilter: form.enforceSessionFilter,
      newsFilterEnabled: form.newsFilterEnabled,
      manualBlockActive: form.manualBlockActive,
      manualBlockReason: form.manualBlockReason,
      aiBiasSuggestionEnabled: form.aiBiasSuggestionEnabled,
      aiAssistantEnabled: form.aiAssistantEnabled,
    });
    onSaved();
  });

  const num = (key: keyof typeof form, label: string, hint?: string) => (
    <div key={key}>
      <label className="field-label">{label}</label>
      <input
        className="input"
        value={String(form[key])}
        onChange={(event) => setForm((value) => ({ ...value, [key]: event.target.value }))}
        inputMode="decimal"
      />
      {hint && <p className="mt-0.5 text-2xs text-ink-600">{hint}</p>}
    </div>
  );

  const toggle = (key: keyof typeof form, label: string, hint?: string) => (
    <label key={key} className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-ink-850">
      <input
        type="checkbox"
        className="mt-0.5 h-3.5 w-3.5 accent-violet-500"
        checked={Boolean(form[key])}
        onChange={(event) => setForm((value) => ({ ...value, [key]: event.target.checked }))}
      />
      <span className="min-w-0">
        <span className="text-xs text-ink-200">{label}</span>
        {hint && <span className="block text-2xs leading-relaxed text-ink-600">{hint}</span>}
      </span>
    </label>
  );

  return (
    <Panel title="Strategy rules" subtitle="Applied by the engine everywhere" bodyClassName="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        {num('defaultRiskPercent', 'Default risk %')}
        {num('maxRiskPercent', 'Maximum risk %', 'Trades above this are flagged as rule breaks.')}
        {num('minDisplacementScore', 'Min displacement score', '0–100')}
        {num('maxFvgMitigation', 'Max FVG mitigation', '0–1; beyond this a zone is no longer offered')}
        {num('newsWindowMinutes', 'News window (min)')}
        {num('maxBarsFromStructureBreak', 'Max bars after break')}
      </div>

      <div>
        <label className="field-label">Structure sensitivity</label>
        <div className="flex gap-1">
          {(['conservative', 'balanced', 'sensitive'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setForm((value) => ({ ...value, sensitivity: option }))}
              className={clsx(
                'flex-1 rounded border px-2 py-1 text-2xs capitalize',
                form.sensitivity === option
                  ? 'border-accent/60 bg-accent/15 text-accent'
                  : 'border-ink-700 text-ink-400',
              )}
            >
              {option}
            </button>
          ))}
        </div>
        <p className="mt-0.5 text-2xs text-ink-600">
          Conservative needs five bars either side of a pivot plus a full ATR of separation.
          Sensitive takes two bars and no filter.
        </p>
      </div>

      <div className="space-y-0.5">
        {toggle('requireChoch', 'Require CHoCH rather than any BOS')}
        {toggle('requireFvgAfterStructure', 'Execution FVG must form after the structure break')}
        {toggle('enforceSessionFilter', 'Only mark execution-ready inside a permitted session')}
        {toggle(
          'newsFilterEnabled',
          'Block execution near high-impact news',
          'Off by default. The News Impact Analyzer measures whether this helps before you commit to it.',
        )}
        {toggle('aiAssistantEnabled', 'Enable the AI mentor')}
        {toggle(
          'aiBiasSuggestionEnabled',
          'Experimental: allow one-click apply of the engine bias suggestion',
          'The engine never writes your bias on its own; this only adds a button.',
        )}
        {toggle('manualBlockActive', 'Manual block — I am not trading right now')}
      </div>

      {form.manualBlockActive && (
        <div>
          <label className="field-label">Reason</label>
          <input
            className="input"
            value={form.manualBlockReason}
            onChange={(event) => setForm((value) => ({ ...value, manualBlockReason: event.target.value }))}
            placeholder="Tired / travelling / drawdown rule"
          />
        </div>
      )}

      {save.error && <p className="text-2xs text-bear">{save.error}</p>}
      <button type="button" className="btn btn-primary" disabled={save.busy} onClick={() => void save.run()}>
        Save rules
      </button>
    </Panel>
  );
}

function SessionsSection({ sessions, onSaved }: { sessions: SessionRow[]; onSaved: () => void }) {
  const [rows, setRows] = useState(sessions);
  useEffect(() => setRows(sessions), [sessions]);

  const save = useAction(async () => {
    await put('/api/sessions', {
      sessions: rows.map((row) => ({
        name: row.name,
        kind: row.kind,
        timezone: row.timezone,
        startMinutes: row.startMinutes,
        endMinutes: row.endMinutes,
        days: row.days,
        tradingPermitted: row.tradingPermitted,
        enabled: row.enabled,
        color: row.color,
      })),
    });
    onSaved();
  });

  const update = (index: number, patchRow: Partial<SessionRow>) =>
    setRows((value) => value.map((row, i) => (i === index ? { ...row, ...patchRow } : row)));

  return (
    <Panel
      title="Sessions"
      subtitle="Times are stored in each session's own zone, so DST is handled for you"
      bodyClassName="space-y-2"
    >
      {rows.map((row, index) => (
        <div key={row.id} className="space-y-1.5 rounded border border-ink-700 bg-ink-850 p-2">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: row.color }} />
            <input
              className="input flex-1 py-1"
              value={row.name}
              onChange={(event) => update(index, { name: event.target.value })}
            />
            <label className="flex items-center gap-1 text-2xs text-ink-400">
              <input
                type="checkbox"
                className="h-3 w-3 accent-violet-500"
                checked={row.enabled}
                onChange={(event) => update(index, { enabled: event.target.checked })}
              />
              on
            </label>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="field-label">Start</label>
              <input
                className="input py-1"
                value={formatHhMm(row.startMinutes)}
                onChange={(event) => {
                  try {
                    update(index, { startMinutes: parseHhMm(event.target.value) });
                  } catch {
                    /* keep the previous value while the field is mid-edit */
                  }
                }}
              />
            </div>
            <div>
              <label className="field-label">End</label>
              <input
                className="input py-1"
                value={formatHhMm(row.endMinutes)}
                onChange={(event) => {
                  try {
                    update(index, { endMinutes: parseHhMm(event.target.value) });
                  } catch {
                    /* keep the previous value while the field is mid-edit */
                  }
                }}
              />
            </div>
            <div>
              <label className="field-label">Timezone</label>
              <input
                className="input py-1"
                value={row.timezone}
                onChange={(event) => update(index, { timezone: event.target.value })}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <div className="flex gap-0.5">
              {DAY_LABELS.map((label, dayIndex) => {
                const day = dayIndex + 1;
                const on = row.days.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() =>
                      update(index, {
                        days: on ? row.days.filter((d) => d !== day) : [...row.days, day].sort(),
                      })
                    }
                    className={clsx(
                      'h-5 w-5 rounded text-2xs',
                      on ? 'bg-accent/20 text-accent' : 'bg-ink-800 text-ink-600',
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <label className="flex items-center gap-1 text-2xs">
              <input
                type="checkbox"
                className="h-3 w-3 accent-emerald-500"
                checked={row.tradingPermitted}
                onChange={(event) => update(index, { tradingPermitted: event.target.checked })}
              />
              <span className={row.tradingPermitted ? 'text-bull' : 'text-ink-500'}>
                execution permitted
              </span>
            </label>
          </div>
        </div>
      ))}

      {save.error && <p className="text-2xs text-bear">{save.error}</p>}
      <button type="button" className="btn btn-primary" disabled={save.busy} onClick={() => void save.run()}>
        Save sessions
      </button>
    </Panel>
  );
}

function ProvidersSection({ providers }: { providers: SettingsResponse['providers'] }) {
  return (
    <Panel title="Data providers" subtitle="Keys live in .env and never reach the browser" bodyClassName="space-y-1.5">
      {providers.map((provider) => (
        <div key={provider.id} className="flex items-start justify-between gap-2 rounded border border-ink-700 bg-ink-850 px-2 py-1.5">
          <div className="min-w-0">
            <div className="text-xs text-ink-200">{provider.name}</div>
            {provider.setupHint && (
              <div className="text-2xs text-ink-600">{provider.setupHint}</div>
            )}
          </div>
          <Tag tone={provider.configured ? 'bull' : 'neutral'}>
            {provider.configured ? 'configured' : 'not set'}
          </Tag>
        </div>
      ))}
      <p className="text-2xs leading-relaxed text-ink-600">
        None of these are required. Imported CSV keeps charts, replay, backtesting, the journal and
        statistics fully usable with no keys at all.
      </p>
    </Panel>
  );
}

function DataSection({
  series,
  onImported,
  timezone,
}: {
  series: { id: string; symbol: string; timeframe: string; provider: string; barCount: number; importedFrom: string | null; firstTime: string; lastTime: string; gapCount: number }[];
  onImported: () => void;
  timezone: string;
}) {
  const [timeframe, setTimeframe] = useState('5M');
  const [tz, setTz] = useState('UTC');
  const [report, setReport] = useState<{ imported: number; storedBars: number; report: { duplicatesRemoved: number; gaps: unknown[]; invalidRows: unknown[]; inconsistentBars: number } } | null>(null);

  const importCsv = useAction(async (file: File) => {
    const body = new FormData();
    body.set('file', file);
    body.set('timeframe', timeframe);
    body.set('timezone', tz);
    const result = await importFile(body);
    setReport(result);
    onImported();
  });

  return (
    <Panel title="Data" subtitle="Import OHLCV history — no API key needed" bodyClassName="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="field-label">Timeframe</label>
          <select className="select" value={timeframe} onChange={(e) => setTimeframe(e.target.value)}>
            {TIMEFRAMES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label">CSV timezone</label>
          <input className="input" value={tz} onChange={(e) => setTz(e.target.value)} />
        </div>
      </div>

      <input
        type="file"
        accept=".csv,text/csv"
        className="w-full text-xs text-ink-400 file:mr-2 file:rounded file:border file:border-ink-600 file:bg-ink-800 file:px-2 file:py-1 file:text-xs file:text-ink-200"
        disabled={importCsv.busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void importCsv.run(file);
        }}
      />

      {importCsv.busy && <Spinner label="Importing" />}
      {importCsv.error && <p className="text-2xs text-bear">{importCsv.error}</p>}

      {report && (
        <div className="rounded border border-ink-700 bg-ink-850 p-2 text-2xs leading-relaxed text-ink-300">
          Imported {report.imported} bars ({report.storedBars} stored).
          {' '}Duplicates removed: {report.report.duplicatesRemoved}.
          {' '}Gaps found: {report.report.gaps.length}.
          {' '}Unusable rows: {report.report.invalidRows.length}.
          {' '}Inconsistent bars: {report.report.inconsistentBars}.
          <span className="mt-1 block text-ink-600">
            Gaps are reported rather than filled — an invented candle is worse than a visible hole.
          </span>
        </div>
      )}

      {series.length > 0 && (
        <table className="table-dense">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>TF</th>
              <th>Source</th>
              <th className="text-right">Bars</th>
              <th className="text-right">Gaps</th>
              <th>Range</th>
            </tr>
          </thead>
          <tbody>
            {series.map((row) => (
              <tr key={row.id}>
                <td className="text-2xs">{row.symbol}</td>
                <td className="text-2xs">{row.timeframe}</td>
                <td className="truncate text-2xs text-ink-500">{row.importedFrom ?? row.provider}</td>
                <td className="num text-right text-2xs">{row.barCount}</td>
                <td className="num text-right text-2xs">{row.gapCount}</td>
                <td className="text-2xs text-ink-500">
                  {fmtIsoDateTime(row.firstTime, timezone, 'dd LLL yy')} –{' '}
                  {fmtIsoDateTime(row.lastTime, timezone, 'dd LLL yy')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex flex-wrap gap-1">
        {(['trades', 'journal', 'statistics', 'events', 'missed', 'candles'] as const).map((dataset) => (
          <a key={dataset} className="btn btn-default" href={`/api/export?dataset=${dataset}&format=csv`}>
            Export {dataset}
          </a>
        ))}
      </div>
    </Panel>
  );
}

async function importFile(body: FormData) {
  return upload<{ imported: number; storedBars: number; report: { duplicatesRemoved: number; gaps: unknown[]; invalidRows: unknown[]; inconsistentBars: number } }>(
    '/api/market/import',
    body,
  );
}

function StrategyVersionsSection({
  versions,
  onSaved,
}: {
  versions: SettingsResponse['strategyVersions'];
  onSaved: () => void;
}) {
  const [version, setVersion] = useState('');
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');

  const create = useAction(async () => {
    await post('/api/strategy-versions', { version, name, notes, activate: true });
    setVersion('');
    setName('');
    setNotes('');
    onSaved();
  });

  const activate = useAction(async (id: string) => {
    await patch('/api/strategy-versions', { id, activate: true });
    onSaved();
  });

  return (
    <Panel
      title="Strategy versions"
      subtitle="Rules are snapshotted, so past results keep the rules they were taken under"
      bodyClassName="space-y-2"
    >
      {versions.map((entry) => (
        <div key={entry.id} className="flex items-start justify-between gap-2 rounded border border-ink-700 bg-ink-850 px-2 py-1.5">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="num text-xs text-ink-100">{entry.version}</span>
              {entry.isActive && <Tag tone="bull">active</Tag>}
            </div>
            <div className="truncate text-2xs text-ink-400">{entry.name}</div>
            {entry.notes && <div className="text-2xs leading-relaxed text-ink-600">{entry.notes}</div>}
          </div>
          {!entry.isActive && (
            <button type="button" className="btn btn-ghost shrink-0" onClick={() => void activate.run(entry.id)}>
              Activate
            </button>
          )}
        </div>
      ))}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="field-label">New version</label>
          <input className="input" value={version} onChange={(e) => setVersion(e.target.value)} placeholder="v1.1" />
        </div>
        <div>
          <label className="field-label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="field-label">What changed</label>
        <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {create.error && <p className="text-2xs text-bear">{create.error}</p>}
      <button
        type="button"
        className="btn btn-default"
        disabled={create.busy || !version || !name}
        onClick={() => void create.run()}
      >
        Snapshot current rules as a new version
      </button>
    </Panel>
  );
}

function TelegramSection({
  state,
  onSaved,
}: {
  state: { configured: boolean; enabled: boolean; chatId: string | null; commands: { command: string; description: string }[] } | null;
  onSaved: () => void;
}) {
  const [chatId, setChatId] = useState(state?.chatId ?? '');
  const [output, setOutput] = useState<string | null>(null);
  useEffect(() => setChatId(state?.chatId ?? ''), [state?.chatId]);

  const save = useAction(async () => {
    await patch('/api/settings', { telegramEnabled: true, telegramChatId: chatId || null });
    onSaved();
  });

  const preview = useAction(async (command: string) => {
    const result = await post<{ text: string }>('/api/telegram', { command, send: false });
    setOutput(result.text.replace(/<[^>]+>/g, ''));
  });

  return (
    <Panel
      title="Telegram"
      subtitle={state?.configured ? 'Bot token configured' : 'Optional — set TELEGRAM_BOT_TOKEN in .env'}
      bodyClassName="space-y-2"
    >
      <div>
        <label className="field-label">Chat id</label>
        <input className="input" value={chatId} onChange={(e) => setChatId(e.target.value)} />
      </div>
      <button type="button" className="btn btn-default" disabled={save.busy} onClick={() => void save.run()}>
        Save chat id
      </button>

      <div className="flex flex-wrap gap-1">
        {(state?.commands ?? []).map((entry) => (
          <button
            key={entry.command}
            type="button"
            className="btn btn-ghost"
            title={entry.description}
            onClick={() => void preview.run(entry.command)}
          >
            /{entry.command}
          </button>
        ))}
      </div>

      {output && (
        <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded border border-ink-700 bg-ink-950 p-2 font-mono text-2xs leading-relaxed text-ink-300">
          {output}
        </pre>
      )}

      <p className="text-2xs leading-relaxed text-ink-600">
        The bot reports state only. There is no command that opens, modifies or closes a position.
      </p>
    </Panel>
  );
}

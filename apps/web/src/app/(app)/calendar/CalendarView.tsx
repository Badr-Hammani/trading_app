'use client';

import clsx from 'clsx';
import { useState } from 'react';
import { DateTime } from 'luxon';
import { formatDuration } from '@xau/core';
import { DataUnavailable, EmptyState, Panel, Spinner, Tag } from '@/components/ui/Panel';
import { del, post } from '@/lib/client';
import { fmtNumber, fmtTime } from '@/lib/format';
import { useAction, useNow, usePolling } from '@/lib/hooks';

interface CalendarEventRow {
  id: string;
  name: string;
  country: string;
  time: number;
  importance: 'high' | 'medium' | 'low';
  category: string | null;
  previous: number | null;
  forecast: number | null;
  actual: number | null;
  unit: string | null;
  surprise: number | null;
  source: string;
  pointInTime: boolean;
}

interface CalendarResponse {
  result: { status: 'ok' | 'unavailable'; message?: string };
  events: CalendarEventRow[];
  newsRisk: { message: string; eventNearby: boolean; minutesToEvent: number | null } | null;
  provider: { name: string; configured: boolean; setupHint?: string };
  pointInTime: boolean;
  timezone: string;
}

/**
 * Economic calendar, filtered to what actually moves gold.
 *
 * Events are shown with a countdown and a warning band. Trading is never
 * blocked from here unless the trader has switched the news filter on in
 * Settings — the News Impact Analyzer exists to test whether that filter is
 * worth having.
 */
export function CalendarView() {
  const [goldOnly, setGoldOnly] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const now = useNow();

  const calendar = usePolling<CalendarResponse>(
    `/api/calendar?goldOnly=${goldOnly}`,
    5 * 60_000,
  );

  const timezone = calendar.data?.timezone ?? 'UTC';
  const events = calendar.data?.events ?? [];
  const upcoming = events.filter((event) => event.time >= now - 3600);
  const past = events.filter((event) => event.time < now - 3600);

  const remove = useAction(async (id: string) => {
    await del(`/api/calendar?id=${id}`);
    await calendar.refresh();
  });

  return (
    <div className="space-y-2 p-2">
      {calendar.data?.newsRisk?.eventNearby && (
        <div className="rounded-card border border-warn/50 bg-warn/10 px-3 py-2">
          <p className="text-sm font-semibold text-warn">{calendar.data.newsRisk.message}</p>
          <p className="mt-0.5 text-2xs text-ink-300">
            This is a warning, not a block. Trading is only prevented if you enable the news filter
            in Settings.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Panel
          title="Upcoming events"
          subtitle={calendar.data?.provider.name}
          actions={
            <>
              <label className="flex cursor-pointer items-center gap-1 text-2xs text-ink-400">
                <input
                  type="checkbox"
                  checked={goldOnly}
                  onChange={(event) => setGoldOnly(event.target.checked)}
                  className="h-3 w-3 accent-violet-500"
                />
                Gold-relevant only
              </label>
              <button type="button" className="btn btn-ghost" onClick={() => setShowForm((v) => !v)}>
                {showForm ? 'Cancel' : 'Add event'}
              </button>
            </>
          }
          bodyClassName="p-0"
        >
          {showForm && <AddEventForm timezone={timezone} onSaved={() => { setShowForm(false); void calendar.refresh(); }} />}

          {calendar.loading && events.length === 0 ? (
            <div className="p-3">
              <Spinner />
            </div>
          ) : calendar.data?.result.status === 'unavailable' ? (
            <div className="p-3">
              <DataUnavailable
                reason={calendar.data.result.message}
                hint="Set TRADING_ECONOMICS_API_KEY for an automatic calendar, or add the events you care about by hand — the countdown and news filter work identically either way."
              />
            </div>
          ) : upcoming.length === 0 ? (
            <div className="p-3">
              <EmptyState title="No upcoming events loaded" />
            </div>
          ) : (
            <div className="max-h-[560px] overflow-y-auto">
              <table className="table-dense">
                <thead className="sticky top-0 bg-ink-900">
                  <tr>
                    <th>When</th>
                    <th>Event</th>
                    <th>Impact</th>
                    <th className="text-right">Prev</th>
                    <th className="text-right">Fcst</th>
                    <th className="text-right">Actual</th>
                    <th className="text-right">Surprise</th>
                    <th>Source</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map((event) => {
                    const seconds = event.time - now;
                    const imminent = seconds > 0 && seconds < 3600;
                    return (
                      <tr key={`${event.id}-${event.time}`} className={clsx(imminent && 'bg-warn/5')}>
                        <td className="whitespace-nowrap">
                          <div className="num text-2xs text-ink-200">
                            {fmtTime(event.time, timezone, 'ccc dd HH:mm')}
                          </div>
                          <div className={clsx('text-2xs', imminent ? 'text-warn' : 'text-ink-600')}>
                            {seconds > 0 ? `in ${formatDuration(seconds)}` : 'released'}
                          </div>
                        </td>
                        <td>
                          <div className="text-xs text-ink-100">{event.name}</div>
                          <div className="text-2xs text-ink-600">{event.country}</div>
                        </td>
                        <td>
                          <Tag
                            tone={
                              event.importance === 'high'
                                ? 'bear'
                                : event.importance === 'medium'
                                  ? 'warn'
                                  : 'neutral'
                            }
                          >
                            {event.importance}
                          </Tag>
                        </td>
                        <td className="num text-right text-2xs">{fmtNumber(event.previous, 2)}</td>
                        <td className="num text-right text-2xs">{fmtNumber(event.forecast, 2)}</td>
                        <td className="num text-right text-2xs">{fmtNumber(event.actual, 2)}</td>
                        <td
                          className={clsx(
                            'num text-right text-2xs',
                            event.surprise === null
                              ? 'text-ink-600'
                              : event.surprise > 0
                                ? 'text-bull'
                                : 'text-bear',
                          )}
                        >
                          {fmtNumber(event.surprise, 2, { sign: true })}
                        </td>
                        <td className="text-2xs text-ink-600">
                          {event.source}
                          {event.pointInTime && (
                            <span className="ml-1 text-info" title="Point-in-time snapshot">
                              PIT
                            </span>
                          )}
                        </td>
                        <td className="text-right">
                          {event.source === 'manual' && (
                            <button
                              type="button"
                              className="text-2xs text-ink-600 hover:text-bear"
                              onClick={() => void remove.run(event.id)}
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
        </Panel>

        <div className="space-y-2">
          <Panel title="Priority events for gold" bodyClassName="space-y-1">
            <ul className="space-y-0.5 text-2xs leading-relaxed text-ink-400">
              {[
                'FOMC / Federal Funds Rate',
                'CPI and Core CPI',
                'PCE and Core PCE',
                'Nonfarm Payrolls and Unemployment Rate',
                'GDP',
                'ISM Manufacturing and Services',
                'Retail Sales',
                'Jobless Claims',
                'Powell and Fed speeches',
                'Treasury auctions and yield-sensitive releases',
              ].map((item) => (
                <li key={item}>· {item}</li>
              ))}
            </ul>
            <p className="pt-1 text-2xs leading-relaxed text-ink-600">
              The gold filter matches on these. Turn it off above to see the full calendar.
            </p>
          </Panel>

          <Panel title="Point-in-time data" bodyClassName="space-y-1.5">
            <p className="text-2xs leading-relaxed text-ink-400">
              Backtests read only point-in-time rows — the figures as they were published, not as
              later revised. Rows marked <span className="text-info">PIT</span> are safe for a
              historical run; anything else is deliberately excluded rather than substituted.
            </p>
          </Panel>

          {past.length > 0 && (
            <Panel title="Recent releases" bodyClassName="p-0">
              <table className="table-dense">
                <tbody>
                  {past
                    .slice(-8)
                    .reverse()
                    .map((event) => (
                      <tr key={`${event.id}-past`}>
                        <td className="num text-2xs text-ink-500">
                          {fmtTime(event.time, timezone, 'dd HH:mm')}
                        </td>
                        <td className="text-2xs">{event.name}</td>
                        <td
                          className={clsx(
                            'num text-right text-2xs',
                            event.surprise === null
                              ? 'text-ink-600'
                              : event.surprise > 0
                                ? 'text-bull'
                                : 'text-bear',
                          )}
                        >
                          {fmtNumber(event.surprise, 2, { sign: true })}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function AddEventForm({ timezone, onSaved }: { timezone: string; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [country, setCountry] = useState('United States');
  const [when, setWhen] = useState('');
  const [importance, setImportance] = useState<'high' | 'medium' | 'low'>('high');
  const [previous, setPrevious] = useState('');
  const [forecast, setForecast] = useState('');

  const save = useAction(async () => {
    const parsed = DateTime.fromISO(when, { zone: timezone });
    if (!parsed.isValid) throw new Error('Enter a valid date and time.');
    await post('/api/calendar', {
      name,
      country,
      time: Math.floor(parsed.toSeconds()),
      importance,
      previous: previous === '' ? null : Number(previous),
      forecast: forecast === '' ? null : Number(forecast),
    });
    onSaved();
  });

  return (
    <form
      className="space-y-2 border-b border-ink-700 bg-ink-850 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save.run();
      }}
    >
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="field-label">Event</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="field-label">Country</label>
          <input className="input" value={country} onChange={(e) => setCountry(e.target.value)} />
        </div>
        <div>
          <label className="field-label">When ({timezone})</label>
          <input
            className="input"
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="field-label">Impact</label>
          <select
            className="select"
            value={importance}
            onChange={(e) => setImportance(e.target.value as typeof importance)}
          >
            <option value="high">high</option>
            <option value="medium">medium</option>
            <option value="low">low</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="field-label">Previous</label>
            <input className="input" value={previous} onChange={(e) => setPrevious(e.target.value)} />
          </div>
          <div>
            <label className="field-label">Forecast</label>
            <input className="input" value={forecast} onChange={(e) => setForecast(e.target.value)} />
          </div>
        </div>
      </div>
      {save.error && <p className="text-2xs text-bear">{save.error}</p>}
      <button type="submit" className="btn btn-primary" disabled={save.busy}>
        Add event
      </button>
    </form>
  );
}

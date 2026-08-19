'use client';

import clsx from 'clsx';
import { formatDuration } from '@xau/core';
import { Tag } from '@/components/ui/Panel';
import { fmtCurrency, fmtNumber, fmtPercent, fmtTime } from '@/lib/format';
import { useNow, usePolling } from '@/lib/hooks';
import type { QuoteResponse } from '@/lib/types';

/**
 * The header strip.
 *
 * Price, session, news and the trade-allowed status in one line. "Trade
 * allowed" is deliberately a status the trader reads, not a gate the app
 * enforces — except where they have explicitly asked it to block.
 */
export function HeaderStrip({
  newsRisk,
  refreshMs = 15_000,
}: {
  newsRisk?: { message: string; minutesToEvent: number | null; eventNearby: boolean } | null;
  refreshMs?: number;
}) {
  const { data, error } = usePolling<QuoteResponse>('/api/market/quote', refreshMs);
  const now = useNow();

  const quote = data?.quote;
  const priceOk = quote?.status === 'ok';
  const timezone = data?.timezone ?? 'UTC';
  const change = data?.change ?? null;

  const executionAllowed = Boolean(data?.session.executionWindow) && !data?.manualBlock.active;

  return (
    <div className="flex flex-wrap items-stretch gap-px overflow-hidden rounded-card border border-ink-700 bg-ink-700 text-xs">
      <Cell className="min-w-[180px] bg-ink-900">
        <div className="stat-label">{data?.symbol ?? 'XAUUSD'}</div>
        {priceOk ? (
          <div className="flex items-baseline gap-2">
            <span className="num text-lg font-semibold text-ink-100">
              {fmtNumber(quote.data.mid, 2)}
            </span>
            {change && (
              <span className={clsx('num text-xs', change.absolute >= 0 ? 'text-bull' : 'text-bear')}>
                {fmtNumber(change.absolute, 2, { sign: true })} ({fmtPercent(change.percent, 2, true)})
              </span>
            )}
          </div>
        ) : (
          <div className="text-warn">DATA UNAVAILABLE</div>
        )}
        {quote?.status === 'unavailable' && (
          <div className="mt-0.5 text-2xs leading-tight text-ink-500">{quote.message}</div>
        )}
        {priceOk && quote.data.delayed && (
          <div className="mt-0.5 text-2xs text-warn">Delayed feed</div>
        )}
      </Cell>

      <Cell className="bg-ink-900">
        <div className="stat-label">Bid / Ask</div>
        <div className="num text-ink-200">
          {priceOk && quote.data.bid !== null ? fmtNumber(quote.data.bid, 2) : '—'} /{' '}
          {priceOk && quote.data.ask !== null ? fmtNumber(quote.data.ask, 2) : '—'}
        </div>
        <div className="mt-0.5 text-2xs text-ink-500">
          Spread{' '}
          {priceOk && quote.data.spread !== null ? (
            <span className="num text-ink-300">{fmtNumber(quote.data.spread, 2)}</span>
          ) : (
            <span className="text-ink-500">not published by this provider</span>
          )}
        </div>
      </Cell>

      <Cell className="bg-ink-900">
        <div className="stat-label">Session</div>
        <div className="text-ink-100">
          {data?.session.activeNames.length ? data.session.activeNames.join(' + ') : 'None'}
        </div>
        <div className="mt-0.5 text-2xs text-ink-500">
          {data?.session.secondsToActiveClose != null
            ? `Closes in ${formatDuration(data.session.secondsToActiveClose)}`
            : data?.session.next
              ? `${data.session.next.definition.name} in ${formatDuration(data.session.secondsToNextOpen ?? 0)}`
              : 'No session scheduled'}
        </div>
      </Cell>

      <Cell className="bg-ink-900">
        <div className="stat-label">Market</div>
        <div
          className={clsx(
            data?.market === 'open' ? 'text-bull' : data?.market === 'weekend' ? 'text-ink-400' : 'text-warn',
          )}
        >
          {(data?.market ?? 'unknown').toUpperCase()}
        </div>
        <div className="mt-0.5 num text-2xs text-ink-500">
          {fmtTime(now, timezone, 'ccc dd LLL HH:mm:ss')}
        </div>
      </Cell>

      <Cell className="bg-ink-900">
        <div className="stat-label">Next high-impact event</div>
        {newsRisk?.eventNearby ? (
          <div className="text-warn">
            {newsRisk.minutesToEvent !== null && newsRisk.minutesToEvent >= 0
              ? `HIGH IMPACT EVENT IN ${newsRisk.minutesToEvent} MIN`
              : 'HIGH IMPACT EVENT JUST PASSED'}
          </div>
        ) : (
          <div className="text-ink-300">{newsRisk?.message ?? 'No calendar loaded'}</div>
        )}
      </Cell>

      <Cell className={clsx(executionAllowed ? 'bg-bull/10' : 'bg-ink-900')}>
        <div className="stat-label">Execution</div>
        <div className={clsx('font-semibold', executionAllowed ? 'text-bull' : 'text-warn')}>
          {data?.manualBlock.active
            ? 'BLOCKED'
            : executionAllowed
              ? 'TRADE ALLOWED'
              : 'NO EXECUTION WINDOW'}
        </div>
        {data?.manualBlock.active && (
          <div className="mt-0.5 text-2xs text-ink-400">{data.manualBlock.reason || 'Manual block'}</div>
        )}
      </Cell>

      {error && (
        <Cell className="bg-bear/10">
          <div className="stat-label">Feed</div>
          <div className="text-bear">{error}</div>
        </Cell>
      )}
    </div>
  );
}

function Cell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx('flex-1 px-3 py-2', className)}>{children}</div>;
}

export function AccountBadge({ balance, currency }: { balance: number; currency: string }) {
  return <Tag tone="neutral">{fmtCurrency(balance, currency, 0)}</Tag>;
}

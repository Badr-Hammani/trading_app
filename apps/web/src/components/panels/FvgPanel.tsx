'use client';

import clsx from 'clsx';
import type { FvgZone } from '@xau/core';
import { EmptyState, Panel, Tag } from '@/components/ui/Panel';
import { fmtNumber, fmtTime } from '@/lib/format';

const STATUS_TONE = {
  fresh: 'bull',
  partially_mitigated: 'warn',
  fully_mitigated: 'neutral',
  invalidated: 'bear',
} as const;

/**
 * FVG list.
 *
 * Dead zones are kept and faded rather than removed. The point is that a
 * violated gap stays visible as history while never being offered as a live
 * location again — and that a new gap over the same prices is a new row.
 */
export function FvgPanel({
  zones,
  price,
  timezone,
  compact = false,
}: {
  zones: (FvgZone & { quality?: number })[];
  price: number | null;
  timezone: string;
  compact?: boolean;
}) {
  const live = zones.filter(
    (zone) => zone.status === 'fresh' || zone.status === 'partially_mitigated',
  );
  const dead = zones.filter(
    (zone) => zone.status === 'fully_mitigated' || zone.status === 'invalidated',
  );

  const ordered = [...live].sort((a, b) => b.createdTime - a.createdTime);
  const shownLive = compact ? ordered.slice(0, 6) : ordered;
  const shownDead = compact ? [] : dead.slice(-8).reverse();

  return (
    <Panel
      title="FVG manager"
      subtitle={`${live.length} live · ${dead.length} dead`}
      bodyClassName="space-y-2"
    >
      {shownLive.length === 0 ? (
        <EmptyState
          title="No live fair value gaps"
          hint="Zones appear as displacement creates them. A gap is a location to watch, never a reason to enter."
        />
      ) : (
        <div className="space-y-1">
          {shownLive.map((zone) => (
            <ZoneRow key={zone.id} zone={zone} price={price} timezone={timezone} />
          ))}
        </div>
      )}

      {shownDead.length > 0 && (
        <details className="rounded border border-ink-800">
          <summary className="cursor-pointer px-2 py-1 text-2xs uppercase tracking-wide text-ink-500">
            Dead zones ({dead.length}) — kept, never reused
          </summary>
          <div className="space-y-1 p-1.5">
            {shownDead.map((zone) => (
              <ZoneRow key={zone.id} zone={zone} price={price} timezone={timezone} faded />
            ))}
          </div>
        </details>
      )}
    </Panel>
  );
}

function ZoneRow({
  zone,
  price,
  timezone,
  faded = false,
}: {
  zone: FvgZone & { quality?: number };
  price: number | null;
  timezone: string;
  faded?: boolean;
}) {
  const inZone = price !== null && price <= zone.high && price >= zone.low;

  return (
    <div
      className={clsx(
        'rounded border px-2 py-1.5',
        faded
          ? 'border-ink-800 bg-ink-900/50 opacity-60'
          : zone.direction === 'bullish'
            ? 'border-bull/30 bg-bull/5'
            : 'border-bear/30 bg-bear/5',
        inZone && !faded && 'ring-1 ring-accent/50',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Tag tone={zone.direction === 'bullish' ? 'bull' : 'bear'}>{zone.timeframe}</Tag>
          <span className="num text-xs text-ink-100">
            {fmtNumber(zone.low, 2)} – {fmtNumber(zone.high, 2)}
          </span>
        </div>
        <Tag tone={STATUS_TONE[zone.status]}>{zone.status.replace(/_/g, ' ')}</Tag>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-ink-500">
        <span>mid {fmtNumber(zone.midpoint, 2)}</span>
        <span>size {fmtNumber(zone.size, 2)}</span>
        <span>{Math.round(zone.mitigation * 100)}% mitigated</span>
        {zone.quality !== undefined && <span>quality {zone.quality}/100</span>}
        <span>{fmtTime(zone.createdTime, timezone, 'dd LLL HH:mm')}</span>
        {inZone && <span className="text-accent">price is inside</span>}
      </div>
    </div>
  );
}

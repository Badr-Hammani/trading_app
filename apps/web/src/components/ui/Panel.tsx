import clsx from 'clsx';
import type { ReactNode } from 'react';

export function Panel({
  title,
  actions,
  children,
  className,
  bodyClassName,
  subtitle,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx('panel flex min-h-0 flex-col', className)}>
      {(title || actions) && (
        <header className="panel-header shrink-0">
          <div className="min-w-0">
            {title && <h2 className="panel-title truncate">{title}</h2>}
            {subtitle && <p className="mt-0.5 truncate text-2xs text-ink-500">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className={clsx('panel-body min-h-0 flex-1', bodyClassName)}>{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  tone = 'neutral',
  hint,
  mono = true,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: 'neutral' | 'bull' | 'bear' | 'warn' | 'info';
  hint?: ReactNode;
  mono?: boolean;
}) {
  const toneClasses = {
    neutral: 'text-ink-100',
    bull: 'text-bull',
    bear: 'text-bear',
    warn: 'text-warn',
    info: 'text-info',
  } as const;

  return (
    <div className="min-w-0">
      <div className="stat-label truncate">{label}</div>
      <div className={clsx('truncate text-sm', mono && 'font-mono tabular-nums', toneClasses[tone])}>
        {value}
      </div>
      {hint && <div className="mt-0.5 truncate text-2xs text-ink-500">{hint}</div>}
    </div>
  );
}

export function Tag({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'bull' | 'bear' | 'warn' | 'info' | 'accent';
  className?: string;
}) {
  const tones = {
    neutral: 'border-ink-600 text-ink-300',
    bull: 'border-bull/50 bg-bull/10 text-bull',
    bear: 'border-bear/50 bg-bear/10 text-bear',
    warn: 'border-warn/50 bg-warn/10 text-warn',
    info: 'border-info/50 bg-info/10 text-info',
    accent: 'border-accent/50 bg-accent/10 text-accent',
  } as const;

  return <span className={clsx('tag', tones[tone], className)}>{children}</span>;
}

/**
 * The DATA UNAVAILABLE state.
 *
 * Used everywhere a provider cannot answer. It always shows the reason: the
 * trader needs to know whether a number is missing because nothing is
 * configured or because the feed just died.
 */
export function DataUnavailable({
  reason,
  hint,
  compact = false,
}: {
  reason?: string | null;
  hint?: string | null;
  compact?: boolean;
}) {
  return (
    <div
      className={clsx(
        'rounded border border-dashed border-ink-600 bg-ink-850/60 text-ink-400',
        compact ? 'px-2 py-1.5' : 'px-3 py-4',
      )}
    >
      <div className="text-2xs font-semibold uppercase tracking-[0.14em] text-warn">
        Data unavailable
      </div>
      {reason && <p className="mt-1 text-xs leading-relaxed text-ink-300">{reason}</p>}
      {hint && <p className="mt-1 text-2xs text-ink-500">{hint}</p>}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded border border-dashed border-ink-700 px-4 py-8 text-center">
      <p className="text-xs text-ink-300">{title}</p>
      {hint && <p className="mt-1 max-w-md text-2xs leading-relaxed text-ink-500">{hint}</p>}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-2xs uppercase tracking-[0.14em] text-ink-500">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
      {label}
    </div>
  );
}

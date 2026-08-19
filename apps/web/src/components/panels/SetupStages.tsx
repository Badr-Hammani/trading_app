'use client';

import clsx from 'clsx';
import type { SetupEvaluation, SetupStatus } from '@xau/core';
import { Panel, Tag } from '@/components/ui/Panel';

/**
 * The seven stages.
 *
 * Shown as an ordered sequence because the order is the model: a fresh FVG
 * with no sweep behind it is not the same setup as one that followed a sweep,
 * and collapsing them into a single "signal" is the mistake the app exists
 * to prevent.
 */

export const STATUS_META: Record<
  SetupStatus,
  { label: string; tone: 'bull' | 'bear' | 'warn' | 'neutral' | 'accent'; blurb: string }
> = {
  qualified: {
    label: 'SETUP QUALIFIED',
    tone: 'bull',
    blurb: 'Every mandatory condition is met. Executing is still your decision.',
  },
  caution: {
    label: 'CAUTION',
    tone: 'warn',
    blurb: 'Conditions met, but something nearby warrants care.',
  },
  valid_out_of_session: {
    label: 'VALID · NO EXECUTION WINDOW',
    tone: 'accent',
    blurb: 'Technically valid but outside your session. Log it as a missed setup.',
  },
  forming: { label: 'SETUP FORMING', tone: 'neutral', blurb: 'Waiting for the remaining stages.' },
  no_setup: { label: 'NO SETUP', tone: 'neutral', blurb: 'Nothing in the model has begun.' },
  blocked: { label: 'EXECUTION BLOCKED', tone: 'bear', blurb: 'A filter or manual block is active.' },
};

const STAGE_TONE = {
  met: 'border-bull/40 bg-bull/10',
  partial: 'border-warn/40 bg-warn/10',
  not_met: 'border-ink-700 bg-ink-850',
  unknown: 'border-ink-700 bg-ink-850',
} as const;

const STAGE_MARK = { met: '✓', partial: '~', not_met: '·', unknown: '?' } as const;

export function SetupStages({
  evaluation,
  compact = false,
}: {
  evaluation: SetupEvaluation;
  compact?: boolean;
}) {
  const meta = STATUS_META[evaluation.setupStatus];

  return (
    <Panel
      title={`${evaluation.direction} model`}
      subtitle={compact ? undefined : evaluation.summary}
      actions={<Tag tone={meta.tone}>{meta.label}</Tag>}
      bodyClassName="space-y-1.5"
    >
      <ol className="space-y-1">
        {evaluation.stages.map((stage, index) => (
          <li
            key={stage.stage}
            className={clsx('rounded border px-2 py-1.5', STAGE_TONE[stage.state])}
          >
            <div className="flex items-start gap-2">
              <span
                className={clsx(
                  'mt-px w-4 shrink-0 text-center text-xs font-bold',
                  stage.state === 'met' ? 'text-bull' : stage.state === 'partial' ? 'text-warn' : 'text-ink-500',
                )}
              >
                {STAGE_MARK[stage.state]}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xs text-ink-500">{index + 1}</span>
                  <span className="text-xs font-medium text-ink-100">{stage.label}</span>
                </div>
                {!compact && stage.evidence.length > 0 && (
                  <ul className="mt-0.5 space-y-0.5">
                    {stage.evidence.map((item) => (
                      <li key={item} className="text-2xs leading-relaxed text-ink-300">
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
                {stage.missing.length > 0 && (
                  <ul className="mt-0.5 space-y-0.5">
                    {stage.missing.map((item) => (
                      <li key={item} className="text-2xs leading-relaxed text-ink-500">
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="rounded border border-ink-700 bg-ink-850 px-2 py-1.5">
        <p className="text-2xs leading-relaxed text-ink-400">{meta.blurb}</p>
      </div>

      {!compact && (
        <p className="text-2xs leading-relaxed text-ink-600">
          An FVG is a location, not an entry. Reaching one satisfies stage 6, never stage 7.
        </p>
      )}
    </Panel>
  );
}

/** The three-line execution status from the spec's session filter section. */
export function ExecutionStatus({ evaluation }: { evaluation: SetupEvaluation }) {
  const technical = evaluation.stages
    .filter((stage) => stage.stage !== 'entry_confirmation')
    .every((stage) => stage.state === 'met');
  const meta = STATUS_META[evaluation.setupStatus];

  return (
    <div className="space-y-1 rounded border border-ink-700 bg-ink-850 px-2.5 py-2 font-mono text-2xs">
      <Row label="TECHNICAL SETUP" value={technical ? 'VALID' : 'INCOMPLETE'} tone={technical ? 'bull' : 'neutral'} />
      <Row
        label="SESSION"
        value={evaluation.sessionName.toUpperCase()}
        tone={evaluation.sessionValid ? 'bull' : 'warn'}
      />
      <Row
        label="NEWS"
        value={
          evaluation.newsRisk.eventNearby && evaluation.newsRisk.minutesToEvent !== null
            ? `HIGH IMPACT IN ${evaluation.newsRisk.minutesToEvent} MIN`
            : 'CLEAR'
        }
        tone={evaluation.newsRisk.eventNearby ? 'warn' : 'bull'}
      />
      <Row label="EXECUTION STATUS" value={meta.label} tone={meta.tone === 'accent' ? 'warn' : meta.tone} />
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'bull' | 'bear' | 'warn' | 'neutral';
}) {
  const tones = {
    bull: 'text-bull',
    bear: 'text-bear',
    warn: 'text-warn',
    neutral: 'text-ink-300',
  } as const;
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-500">{label}:</span>
      <span className={tones[tone]}>{value}</span>
    </div>
  );
}

'use client';

import clsx from 'clsx';
import { useMemo } from 'react';
import { CHECKLIST_GROUPS, checklistFor, summariseChecklist } from '@xau/core';
import { Panel, Tag } from '@/components/ui/Panel';

/**
 * The setup builder checklist.
 *
 * Ticking every mandatory box shows SETUP QUALIFIED and nothing else happens:
 * no order, no automatic entry. Qualification is a record of the trader's own
 * judgement, which is what the journal later grades.
 */
export function ChecklistPanel({
  direction,
  state,
  onChange,
  onApplySuggestion,
  readOnly = false,
}: {
  direction: 'long' | 'short';
  state: Record<string, boolean>;
  onChange?: (state: Record<string, boolean>) => void;
  onApplySuggestion?: () => void;
  readOnly?: boolean;
}) {
  const items = useMemo(() => checklistFor(direction), [direction]);
  const summary = useMemo(() => summariseChecklist(direction, state), [direction, state]);

  const toggle = (id: string) => {
    if (readOnly || !onChange) return;
    onChange({ ...state, [id]: !state[id] });
  };

  return (
    <Panel
      title="Setup checklist"
      subtitle={`${summary.mandatoryChecked}/${summary.mandatoryTotal} mandatory conditions`}
      actions={
        <>
          {onApplySuggestion && !readOnly && (
            <button type="button" className="btn btn-ghost" onClick={onApplySuggestion}>
              Prefill from engine
            </button>
          )}
          <Tag tone={summary.qualified ? 'bull' : 'neutral'}>
            {summary.qualified ? 'SETUP QUALIFIED' : 'INCOMPLETE'}
          </Tag>
        </>
      }
      bodyClassName="space-y-2"
    >
      <div className="h-1 w-full overflow-hidden rounded-full bg-ink-800">
        <div
          className={clsx('h-full transition-all', summary.qualified ? 'bg-bull' : 'bg-accent')}
          style={{ width: `${summary.completionPercent}%` }}
        />
      </div>

      {CHECKLIST_GROUPS.map((group) => {
        const groupItems = items.filter((item) => item.group === group);
        if (groupItems.length === 0) return null;

        return (
          <div key={group}>
            <div className="stat-label mb-1">{group}</div>
            <div className="space-y-0.5">
              {groupItems.map((item) => (
                <label
                  key={item.id}
                  className={clsx(
                    'flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 transition-colors',
                    state[item.id] ? 'bg-bull/5' : 'hover:bg-ink-850',
                    readOnly && 'cursor-default',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(state[item.id])}
                    onChange={() => toggle(item.id)}
                    disabled={readOnly}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-emerald-500"
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={clsx(
                        'text-xs',
                        state[item.id] ? 'text-ink-100' : 'text-ink-300',
                        !item.mandatory && 'italic',
                      )}
                    >
                      {item.label}
                      {!item.mandatory && <span className="ml-1 text-2xs text-ink-600">optional</span>}
                    </span>
                    {item.hint && (
                      <span className="block text-2xs leading-relaxed text-ink-600">{item.hint}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </div>
        );
      })}

      {summary.qualified ? (
        <div className="rounded border border-bull/40 bg-bull/10 px-2 py-1.5">
          <p className="text-xs font-semibold text-bull">SETUP QUALIFIED</p>
          <p className="mt-0.5 text-2xs leading-relaxed text-ink-300">
            Every mandatory condition is ticked. The application does not place trades — executing
            this is your decision, taken with your broker.
          </p>
        </div>
      ) : (
        summary.missing.length > 0 && (
          <div className="rounded border border-ink-700 bg-ink-850 px-2 py-1.5">
            <p className="stat-label">Still missing</p>
            <ul className="mt-0.5 space-y-0.5">
              {summary.missing.map((item) => (
                <li key={item} className="text-2xs text-ink-400">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )
      )}
    </Panel>
  );
}

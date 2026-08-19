'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { DataUnavailable, Panel, Spinner, Tag } from '@/components/ui/Panel';
import { post, upload } from '@/lib/client';
import { useAction } from '@/lib/hooks';

interface AiResult {
  available: boolean;
  text: string;
  sections: {
    observed: string[];
    interpretation: string[];
    missing: string[];
    assessment: string;
  } | null;
  redacted: boolean;
  notice: string | null;
  disclaimer: string;
  model: string | null;
  reason?: string;
}

const SUGGESTIONS = [
  'Summarise the current market context.',
  'What is the 5M structure telling me right now?',
  'Where is the most obvious liquidity, and has any of it been taken?',
  'What would have to happen for my long model to be complete?',
  'Review my last five trades and tell me what keeps repeating.',
  'Which of my mistakes shows up most often in the journal?',
];

/**
 * The AI mentor.
 *
 * Responses are filtered server-side before they arrive: the assistant cannot
 * tell the trader to buy or sell, and cannot claim certainty. What survives
 * is evidence, interpretation, and what is still missing.
 */
export function AiMentorView() {
  const [message, setMessage] = useState('');
  const [history, setHistory] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [latest, setLatest] = useState<AiResult | null>(null);
  const [screenshot, setScreenshot] = useState<{ id: string; url: string } | null>(null);
  const [imageResult, setImageResult] = useState<AiResult | null>(null);

  const ask = useAction(async (text: string) => {
    const result = await post<AiResult>('/api/ai/chat', {
      message: text,
      history: history.slice(-10),
      includeContext: true,
    });
    setLatest(result);
    if (result.available) {
      setHistory((value) => [
        ...value,
        { role: 'user', content: text },
        { role: 'assistant', content: result.text },
      ]);
    }
    setMessage('');
  });

  const analyseImage = useAction(async (file: File) => {
    const body = new FormData();
    body.set('file', file);
    body.set('phase', 'analysis');
    const uploaded = await upload<{ screenshot: { id: string } }>('/api/screenshots', body);
    setScreenshot({ id: uploaded.screenshot.id, url: `/api/screenshots/${uploaded.screenshot.id}/file` });
    const result = await post<AiResult>('/api/ai/screenshot', {
      screenshotId: uploaded.screenshot.id,
      question: '',
    });
    setImageResult(result);
  });

  return (
    <div className="grid grid-cols-1 gap-2 p-2 xl:grid-cols-2">
      <div className="space-y-2">
        <Panel
          title="Mentor"
          subtitle="Evidence and uncertainty — never a directive"
          actions={latest?.model ? <Tag tone="neutral">{latest.model}</Tag> : undefined}
          bodyClassName="space-y-2"
        >
          <div className="flex flex-wrap gap-1">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="btn btn-default text-left"
                disabled={ask.busy}
                onClick={() => void ask.run(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>

          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (message.trim()) void ask.run(message.trim());
            }}
          >
            <textarea
              className="input min-h-[80px] resize-y"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Ask about structure, liquidity, your journal, or what is missing from the current setup."
            />
            <button type="submit" className="btn btn-primary w-full" disabled={ask.busy || !message.trim()}>
              {ask.busy ? 'Thinking…' : 'Ask'}
            </button>
          </form>

          {ask.error && (
            <p className="rounded border border-bear/40 bg-bear/10 px-2 py-1 text-2xs text-bear">{ask.error}</p>
          )}

          {ask.busy && <Spinner label="Reading the current market state" />}

          {latest && <AiAnswer result={latest} />}
        </Panel>

        {history.length > 2 && (
          <Panel title="Conversation" bodyClassName="space-y-2">
            {history.slice(0, -2).map((entry, index) => (
              <div
                key={`${entry.role}-${index}`}
                className={clsx(
                  'rounded border px-2 py-1.5 text-2xs leading-relaxed',
                  entry.role === 'user'
                    ? 'border-ink-700 bg-ink-850 text-ink-200'
                    : 'border-accent/30 bg-accent/5 text-ink-300',
                )}
              >
                <div className="stat-label mb-0.5">{entry.role === 'user' ? 'You' : 'Mentor'}</div>
                <pre className="whitespace-pre-wrap font-sans">{entry.content}</pre>
              </div>
            ))}
          </Panel>
        )}
      </div>

      <div className="space-y-2">
        <Panel
          title="Chart screenshot analysis"
          subtitle="Separates what is visible from what is inferred"
          bodyClassName="space-y-2"
        >
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="w-full text-xs text-ink-400 file:mr-2 file:rounded file:border file:border-ink-600 file:bg-ink-800 file:px-2 file:py-1 file:text-xs file:text-ink-200"
            disabled={analyseImage.busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void analyseImage.run(file);
            }}
          />

          {analyseImage.busy && <Spinner label="Reading the chart" />}
          {analyseImage.error && (
            <p className="rounded border border-bear/40 bg-bear/10 px-2 py-1 text-2xs text-bear">
              {analyseImage.error}
            </p>
          )}

          {screenshot && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={screenshot.url}
              alt="Uploaded chart"
              className="max-h-72 w-full rounded border border-ink-700 object-contain"
            />
          )}

          {imageResult && <AiAnswer result={imageResult} />}

          <p className="text-2xs leading-relaxed text-ink-600">
            Reading a picture is inherently uncertain — the instrument, timeframe and data behind it
            cannot be verified from an image. The answer is structured to keep that visible.
          </p>
        </Panel>

        <Panel title="What the mentor will not do" bodyClassName="space-y-1.5">
          <ul className="space-y-1 text-2xs leading-relaxed text-ink-400">
            <li>· Tell you to buy or sell. Directives are stripped before the response reaches you.</li>
            <li>· Claim certainty. &ldquo;Guaranteed&rdquo; and &ldquo;will definitely&rdquo; are filtered out.</li>
            <li>· Treat an FVG touch as a setup.</li>
            <li>· Invent a price, level or event it was not given.</li>
          </ul>
          <p className="text-2xs leading-relaxed text-ink-600">
            These are enforced in code, not just requested in the prompt.
          </p>
        </Panel>
      </div>
    </div>
  );
}

function AiAnswer({ result }: { result: AiResult }) {
  if (!result.available) {
    return (
      <DataUnavailable
        reason={result.reason ?? 'The AI mentor is not available.'}
        hint="Set ANTHROPIC_API_KEY in .env to enable it. Every other part of the application works without it."
      />
    );
  }

  return (
    <div className="space-y-2">
      {result.redacted && result.notice && (
        <p className="rounded border border-warn/40 bg-warn/10 px-2 py-1.5 text-2xs leading-relaxed text-warn">
          {result.notice}
        </p>
      )}

      {result.sections ? (
        <div className="space-y-1.5">
          <Section title="Observed" items={result.sections.observed} tone="info" />
          <Section title="Interpretation" items={result.sections.interpretation} tone="accent" />
          <Section title="Missing" items={result.sections.missing} tone="warn" />
          <div className="rounded border border-ink-700 bg-ink-850 px-2 py-1.5">
            <div className="stat-label">Assessment</div>
            <p className="mt-0.5 text-xs font-medium text-ink-100">{result.sections.assessment}</p>
          </div>
        </div>
      ) : (
        <pre className="whitespace-pre-wrap rounded border border-ink-700 bg-ink-850 p-2 font-sans text-xs leading-relaxed text-ink-200">
          {result.text}
        </pre>
      )}

      <p className="text-2xs leading-relaxed text-ink-600">{result.disclaimer}</p>
    </div>
  );
}

function Section({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: 'info' | 'accent' | 'warn';
}) {
  if (items.length === 0) return null;
  const tones = {
    info: 'border-info/30 bg-info/5',
    accent: 'border-accent/30 bg-accent/5',
    warn: 'border-warn/30 bg-warn/5',
  } as const;

  return (
    <div className={clsx('rounded border px-2 py-1.5', tones[tone])}>
      <div className="stat-label">{title}</div>
      <ul className="mt-0.5 space-y-0.5">
        {items.map((item) => (
          <li key={item} className="text-2xs leading-relaxed text-ink-200">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

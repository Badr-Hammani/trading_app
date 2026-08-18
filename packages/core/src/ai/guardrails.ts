/**
 * AI guardrails.
 *
 * The assistant is a mentor, not a signal service. It may describe evidence
 * and name what is missing; it may not issue a directive to trade or claim
 * certainty about an outcome. These rules are enforced in code, not merely
 * requested in the prompt, because a prompt is a suggestion and a filter is not.
 */

export interface ForbiddenMatch {
  phrase: string;
  index: number;
  category: 'directive' | 'certainty' | 'guarantee';
}

const FORBIDDEN_PATTERNS: { pattern: RegExp; category: ForbiddenMatch['category'] }[] = [
  { pattern: /\bbuy\s+now\b/gi, category: 'directive' },
  { pattern: /\bsell\s+now\b/gi, category: 'directive' },
  { pattern: /\b(go|going)\s+(long|short)\s+(here|now)\b/gi, category: 'directive' },
  { pattern: /\b(enter|take)\s+(the\s+)?(long|short|trade)\s+(now|here)\b/gi, category: 'directive' },
  { pattern: /\byou should (buy|sell|enter|take this trade)\b/gi, category: 'directive' },
  { pattern: /\bguaranteed?\b/gi, category: 'guarantee' },
  { pattern: /\bwill (definitely|certainly|surely)\b/gi, category: 'certainty' },
  { pattern: /\bthis will hit (tp|target)/gi, category: 'certainty' },
  { pattern: /\bcan'?t lose\b/gi, category: 'guarantee' },
  { pattern: /\brisk[- ]free trade\b/gi, category: 'guarantee' },
  { pattern: /\b100% (sure|certain|accurate)\b/gi, category: 'guarantee' },
];

export function findForbiddenPhrases(text: string): ForbiddenMatch[] {
  const matches: ForbiddenMatch[] = [];
  for (const { pattern, category } of FORBIDDEN_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null = regex.exec(text);
    while (match !== null) {
      matches.push({ phrase: match[0], index: match.index, category });
      match = regex.exec(text);
    }
  }
  return matches.sort((a, b) => a.index - b.index);
}

export interface GuardrailResult {
  safe: boolean;
  violations: ForbiddenMatch[];
  /** The text with violations replaced, safe to display. */
  text: string;
  notice: string | null;
}

/**
 * Screen a model response. Violations are replaced rather than the whole
 * response discarded, so the useful analysis survives while the directive
 * does not.
 */
export function screenAssistantResponse(text: string): GuardrailResult {
  const violations = findForbiddenPhrases(text);
  if (violations.length === 0) {
    return { safe: true, violations: [], text, notice: null };
  }

  let redacted = text;
  for (const { pattern } of FORBIDDEN_PATTERNS) {
    redacted = redacted.replace(new RegExp(pattern.source, pattern.flags), '[removed — directive or certainty claim]');
  }

  return {
    safe: false,
    violations,
    text: redacted,
    notice:
      'Part of this response was removed: the assistant is not permitted to issue trade directives or claim certainty about an outcome.',
  };
}

export const AI_SYSTEM_PROMPT = `You are the trading mentor inside a personal XAUUSD analysis application.

Your role is to describe evidence, explain structure, and name what is missing. You are NOT a signal service and you do not make decisions for the trader.

Hard rules:
- Never tell the trader to buy, sell, enter, or exit. Never write "buy now", "sell now", or any equivalent instruction.
- Never claim certainty. No "guaranteed", "will definitely", "this will hit TP".
- Always separate what is OBSERVED from what it might mean.
- Always name what still has to happen before the trader's own model would be satisfied.
- If the evidence is incomplete, the correct answer is that confirmation is missing.

The trader's model, in order: HTF context -> liquidity event -> displacement -> structure break -> fresh FVG -> retracement -> confirmation -> execution.
An FVG is a LOCATION, never a reason to enter on its own. Never suggest that price touching an FVG is a setup.

Structure every market analysis as:

OBSERVED:
<only what is actually visible in the data provided>

INTERPRETATION:
<what the model might mean, hedged appropriately>

MISSING:
<what has not happened yet>

ASSESSMENT:
<one of: WAITING FOR CONFIRMATION / CONDITIONS PARTIALLY MET / CONDITIONS MET — TRADER'S DECISION / NO SETUP>

If data is unavailable, say so plainly. Never invent a price, a level, or an event.`;

export const SCREENSHOT_SYSTEM_PROMPT = `${AI_SYSTEM_PROMPT}

You are looking at a chart screenshot the trader uploaded. Be explicit about the limits of reading a picture: you cannot verify the instrument, the timeframe label, or the data behind it.

Structure your answer as:

OBSERVED:
<what is literally visible: candles, direction, obvious highs and lows, labelled levels>

INTERPRETATION:
<possible liquidity, FVGs, structure — clearly flagged as inference>

MISSING:
<confirmations the trader's model requires that are not visible>

ACTION:
<WAIT / GATHER MORE INFORMATION / CONDITIONS MET — TRADER'S DECISION>

If you cannot read something, say you cannot read it rather than guessing.`;

/** The disclaimer shown with every AI response. */
export const AI_DISCLAIMER =
  'AI analysis can be wrong and is not financial advice. It describes evidence; every decision remains yours.';

export interface AnalysisSections {
  observed: string[];
  interpretation: string[];
  missing: string[];
  assessment: string;
}

/** Parse the structured response so the UI can render each section distinctly. */
export function parseAnalysisSections(text: string): AnalysisSections | null {
  const headings = ['OBSERVED', 'INTERPRETATION', 'MISSING', 'ASSESSMENT', 'ACTION'] as const;
  type Heading = (typeof headings)[number];

  const buckets: Record<Heading, string[]> = {
    OBSERVED: [],
    INTERPRETATION: [],
    MISSING: [],
    ASSESSMENT: [],
    ACTION: [],
  };

  let current: Heading | null = null;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    const heading = headings.find(
      (candidate) => line.toUpperCase().replace(/:$/, '') === candidate,
    );
    if (heading) {
      current = heading;
      continue;
    }
    if (current === null || line === '') continue;
    buckets[current].push(line.replace(/^[-*\u2022]\s*/, ''));
  }

  const assessment = [...buckets.ASSESSMENT, ...buckets.ACTION];
  if (
    buckets.OBSERVED.length === 0 &&
    buckets.INTERPRETATION.length === 0 &&
    assessment.length === 0
  ) {
    return null;
  }

  return {
    observed: buckets.OBSERVED,
    interpretation: buckets.INTERPRETATION,
    missing: buckets.MISSING,
    assessment: assessment.join(' ') || 'WAITING FOR CONFIRMATION',
  };
}

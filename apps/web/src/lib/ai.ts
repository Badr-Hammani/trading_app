import { env } from './env';
import { AI_DISCLAIMER, screenAssistantResponse, parseAnalysisSections } from '@xau/core';

/**
 * Anthropic API client for the mentor.
 *
 * Every response passes through the guardrails before it reaches the trader.
 * The prompt asks the model not to issue directives; the filter enforces it,
 * because a prompt is a request and a filter is a guarantee.
 */

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string | AiContentBlock[];
}

export type AiContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

export interface AiResult {
  available: boolean;
  text: string;
  sections: ReturnType<typeof parseAnalysisSections>;
  redacted: boolean;
  notice: string | null;
  disclaimer: string;
  model: string | null;
  reason?: string;
}

export function aiConfigured(): boolean {
  return Boolean(env.anthropicApiKey);
}

export async function askAssistant(
  systemPrompt: string,
  messages: AiMessage[],
  maxTokens = 1400,
): Promise<AiResult> {
  if (!aiConfigured()) {
    return {
      available: false,
      text: '',
      sections: null,
      redacted: false,
      notice: null,
      disclaimer: AI_DISCLAIMER,
      model: null,
      reason:
        'No ANTHROPIC_API_KEY is configured. The AI mentor is optional — every other part of the application works without it.',
    };
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.anthropicApiKey!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env.aiModel,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    return {
      available: false,
      text: '',
      sections: null,
      redacted: false,
      notice: null,
      disclaimer: AI_DISCLAIMER,
      model: env.aiModel,
      reason: `The AI provider returned ${response.status}. ${detail.slice(0, 300)}`,
    };
  }

  const payload = (await response.json()) as {
    content?: { type: string; text?: string }[];
  };

  const raw = (payload.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
    .trim();

  const screened = screenAssistantResponse(raw);

  return {
    available: true,
    text: screened.text,
    sections: parseAnalysisSections(screened.text),
    redacted: !screened.safe,
    notice: screened.notice,
    disclaimer: AI_DISCLAIMER,
    model: env.aiModel,
  };
}

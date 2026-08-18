import { describe, expect, it } from 'vitest';
import { findForbiddenPhrases, parseAnalysisSections, screenAssistantResponse } from './guardrails.js';

describe('AI guardrails', () => {
  it('catches trade directives', () => {
    expect(findForbiddenPhrases('You should buy now at 2400').length).toBeGreaterThan(0);
    expect(findForbiddenPhrases('Sell now before the drop').length).toBeGreaterThan(0);
    expect(findForbiddenPhrases('Go long here').length).toBeGreaterThan(0);
  });

  it('catches certainty and guarantee claims', () => {
    expect(findForbiddenPhrases('This will hit TP1 easily')[0]!.category).toBe('certainty');
    expect(findForbiddenPhrases('A guaranteed setup')[0]!.category).toBe('guarantee');
    expect(findForbiddenPhrases('Price will definitely reverse')[0]!.category).toBe('certainty');
  });

  it('passes evidence-led analysis untouched', () => {
    const text =
      'OBSERVED:\nPrice swept the prior low.\n\nINTERPRETATION:\nPotential sell-side sweep.\n\nMISSING:\nNo bullish displacement yet.\n\nASSESSMENT:\nWAITING FOR CONFIRMATION';
    const result = screenAssistantResponse(text);
    expect(result.safe).toBe(true);
    expect(result.text).toBe(text);
  });

  it('redacts the violation but keeps the analysis', () => {
    const result = screenAssistantResponse(
      'OBSERVED:\nPrice swept the low.\n\nASSESSMENT:\nYou should buy now.',
    );
    expect(result.safe).toBe(false);
    expect(result.text).toMatch(/Price swept the low/);
    expect(result.text).not.toMatch(/buy now/i);
    expect(result.notice).toMatch(/not permitted/);
  });

  it('parses the structured sections', () => {
    const sections = parseAnalysisSections(
      'OBSERVED:\n- Price swept the prior low\n- Range expanded\n\nINTERPRETATION:\n- Possible sweep\n\nMISSING:\n- No displacement\n\nACTION:\nWAIT',
    );
    expect(sections).not.toBeNull();
    expect(sections!.observed).toHaveLength(2);
    expect(sections!.missing[0]).toBe('No displacement');
    expect(sections!.assessment).toBe('WAIT');
  });
});

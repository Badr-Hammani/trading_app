import { describe, expect, it } from 'vitest';
import { processVsOutcome, suggestGrade } from './grading.js';

const fullChecklist = {
  total: 17,
  mandatoryTotal: 15,
  checked: 17,
  mandatoryChecked: 15,
  qualified: true,
  missing: [] as string[],
  completionPercent: 100,
};

const base = {
  checklist: fullChecklist,
  ruleViolations: [] as string[],
  sessionValid: true,
  riskWithinLimit: true,
  confirmationTaken: true,
  newsPresent: false,
  newsFilterEnabled: false,
};

describe('trade grading', () => {
  it('grades a fully aligned trade A+', () => {
    expect(suggestGrade(base).grade).toBe('A+');
  });

  it('downgrades to A when a high-impact event was nearby', () => {
    expect(suggestGrade({ ...base, newsPresent: true }).grade).toBe('A');
  });

  it('marks a trade taken outside the session as a rule break', () => {
    const result = suggestGrade({ ...base, sessionValid: false });
    expect(result.grade).toBe('RULE_BREAK');
    expect(result.reasons.join(' ')).toMatch(/outside a permitted session/i);
  });

  it('marks over-sized risk as a rule break', () => {
    expect(suggestGrade({ ...base, riskWithinLimit: false }).grade).toBe('RULE_BREAK');
  });

  it('grades partial conditions B or C by how much was missing', () => {
    const b = suggestGrade({
      ...base,
      checklist: { ...fullChecklist, mandatoryChecked: 13, qualified: false, missing: ['LTF reaction', 'Fresh FVG'] },
      confirmationTaken: false,
    });
    expect(b.grade).toBe('B');

    const c = suggestGrade({
      ...base,
      checklist: { ...fullChecklist, mandatoryChecked: 7, qualified: false, missing: ['many'] },
      confirmationTaken: false,
    });
    expect(c.grade).toBe('C');
  });

  it('separates process quality from the result', () => {
    const losingGood = processVsOutcome('A+', -1);
    expect(losingGood.tone).toBe('good');
    expect(losingGood.note).toMatch(/Repeat this trade/);

    const winningBad = processVsOutcome('RULE_BREAK', 2);
    expect(winningBad.tone).toBe('bad');
    expect(winningBad.note).toMatch(/Do not repeat/);
  });
});

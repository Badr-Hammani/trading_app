import { describe, expect, it } from 'vitest';
import { computeStatistics, groupStatistics, newsImpactAnalysis } from './statistics.js';
import type { AnalyticsTrade } from './types.js';

function trade(overrides: Partial<AnalyticsTrade> & { id: string; resultR: number }): AnalyticsTrade {
  return {
    openTime: 1000,
    closeTime: 2000,
    direction: 'long',
    session: 'London',
    setupType: 'Sweep + CHoCH',
    entryModel: 'C',
    managementModel: 'A',
    liquidityType: 'PDL',
    fvgTimeframe: '5M',
    fvgQuality: 70,
    grade: 'A',
    ruleViolation: false,
    resultCurrency: overrides.resultR * 100,
    maeR: null,
    mfeR: null,
    newsPresent: false,
    riskPercent: 0.5,
    dayOfWeek: 1,
    hourOfDay: 10,
    ...overrides,
  };
}

describe('statistics', () => {
  const trades = [
    trade({ id: '1', resultR: 1 }),
    trade({ id: '2', resultR: -1 }),
    trade({ id: '3', resultR: 2 }),
    trade({ id: '4', resultR: -1 }),
    trade({ id: '5', resultR: 0 }),
  ];

  it('separates wins, losses and breakevens', () => {
    const stats = computeStatistics(trades);
    expect(stats.trades).toBe(5);
    expect(stats.wins).toBe(2);
    expect(stats.losses).toBe(2);
    expect(stats.breakevens).toBe(1);
    expect(stats.winRate).toBeCloseTo(40, 6);
  });

  it('computes expectancy, profit factor and drawdown', () => {
    const stats = computeStatistics(trades);
    expect(stats.totalR).toBeCloseTo(1, 6);
    expect(stats.expectancyR).toBeCloseTo(0.2, 6);
    expect(stats.profitFactor).toBeCloseTo(1.5, 6);
    expect(stats.maxDrawdownR).toBeCloseTo(1, 6);
    expect(stats.maxConsecutiveLosses).toBe(1);
  });

  it('tracks the equity curve in R', () => {
    const stats = computeStatistics(trades);
    expect(stats.equityCurveR).toEqual([1, 0, 2, 1, 1]);
  });

  it('ignores open trades', () => {
    const stats = computeStatistics([...trades, trade({ id: '6', resultR: 0, resultCurrency: null })
      , { ...trade({ id: '7', resultR: 0 }), resultR: null }]);
    expect(stats.trades).toBe(6);
  });

  it('returns nulls rather than zeros for an empty sample', () => {
    const stats = computeStatistics([]);
    expect(stats.trades).toBe(0);
    expect(stats.winRate).toBeNull();
    expect(stats.expectancyR).toBeNull();
  });

  it('counts a rule break against adherence', () => {
    const stats = computeStatistics([
      trade({ id: '1', resultR: 2, grade: 'RULE_BREAK', ruleViolation: true }),
      trade({ id: '2', resultR: 1, grade: 'A+' }),
    ]);
    expect(stats.ruleAdherencePercent).toBeCloseTo(50, 6);
  });

  it('groups by an arbitrary key', () => {
    const grouped = groupStatistics(
      [trade({ id: '1', resultR: 1, session: 'London' }), trade({ id: '2', resultR: -1, session: 'New York' })],
      (item) => item.session,
    );
    expect(grouped.map((group) => group.key)).toEqual(['London', 'New York']);
  });

  it('refuses to draw a news conclusion from a small sample', () => {
    const analysis = newsImpactAnalysis(trades);
    expect(analysis.sampleSufficient).toBe(false);
    expect(analysis.verdict).toMatch(/Not enough data/);
  });
});

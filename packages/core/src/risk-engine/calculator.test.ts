import { describe, expect, it } from 'vitest';
import { XAUUSD_DEFAULT_SPEC } from '../types/market.js';
import { calculateRisk, profitFor, rMultiple, valuePerPricePerLot } from './calculator.js';

const base = {
  accountBalance: 10000,
  riskPercent: 1,
  entry: 2000,
  stopLoss: 1990,
  takeProfit1: 2010,
  takeProfit2: 2020,
  takeProfit3: null,
  direction: 'long' as const,
  instrument: XAUUSD_DEFAULT_SPEC,
};

describe('risk calculator', () => {
  it('derives the per-lot value from the contract spec, not an assumption', () => {
    expect(valuePerPricePerLot(XAUUSD_DEFAULT_SPEC)).toBe(100);
    // A broker with a 10 oz contract must produce a different answer.
    expect(
      valuePerPricePerLot({ ...XAUUSD_DEFAULT_SPEC, contractSize: 10, tickValue: 0.1 }),
    ).toBeCloseTo(10, 6);
  });

  it('sizes the position from balance, risk and stop distance', () => {
    const result = calculateRisk(base);

    expect(result.valid).toBe(true);
    expect(result.stopDistance).toBe(10);
    expect(result.intendedRiskAmount).toBe(100);
    expect(result.lotSize).toBeCloseTo(0.1, 6);
    expect(result.units).toBeCloseTo(10, 6);
    expect(result.actualRiskAmount).toBeCloseTo(100, 6);
    expect(result.actualRiskPercent).toBeCloseTo(1, 6);
  });

  it('shows the arithmetic that produced the size', () => {
    const result = calculateRisk(base);
    expect(result.steps.join('\n')).toMatch(/Risk per lot/);
    expect(result.steps.join('\n')).toMatch(/Raw position size/);
  });

  it('projects R and profit for each target', () => {
    const result = calculateRisk(base);
    const tp1 = result.targets.find((target) => target.label === 'TP1')!;
    const tp2 = result.targets.find((target) => target.label === 'TP2')!;

    expect(tp1.rMultiple).toBeCloseTo(1, 6);
    expect(tp1.profit).toBeCloseTo(100, 6);
    expect(tp2.rMultiple).toBeCloseTo(2, 6);
    expect(result.maxRR).toBeCloseTo(2, 6);
  });

  it('rounds down to the lot step rather than over-risking', () => {
    const result = calculateRisk({ ...base, accountBalance: 3333, riskPercent: 0.5 });
    const step = XAUUSD_DEFAULT_SPEC.lotStep;
    expect(Math.round(result.lotSize / step) * step).toBeCloseTo(result.lotSize, 6);
    expect(result.actualRiskAmount).toBeLessThanOrEqual(result.intendedRiskAmount + 1e-9);
  });

  it('rejects a long whose stop sits above the entry', () => {
    const result = calculateRisk({ ...base, stopLoss: 2010 });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/below the entry/);
  });

  it('warns when the size falls below the broker minimum', () => {
    const result = calculateRisk({ ...base, accountBalance: 50, riskPercent: 0.25 });
    expect(result.valid).toBe(false);
    expect(result.warnings.join(' ')).toMatch(/broker minimum/);
  });

  it('warns when risk exceeds the configured maximum', () => {
    const result = calculateRisk({ ...base, riskPercent: 3, maxRiskPercent: 1 });
    expect(result.warnings.join(' ')).toMatch(/exceeds your configured maximum/);
  });

  it('ignores a target on the wrong side of the entry', () => {
    const result = calculateRisk({ ...base, takeProfit2: 1980 });
    expect(result.targets.map((target) => target.label)).not.toContain('TP2');
    expect(result.warnings.join(' ')).toMatch(/wrong side/);
  });

  it('computes realised R and currency P/L', () => {
    expect(rMultiple(2000, 1990, 2020, 'long')).toBeCloseTo(2, 6);
    expect(rMultiple(2000, 2010, 1980, 'short')).toBeCloseTo(2, 6);
    expect(profitFor(2000, 2010, 0.1, 'long', XAUUSD_DEFAULT_SPEC)).toBeCloseTo(100, 6);
    expect(profitFor(2000, 2010, 0.1, 'short', XAUUSD_DEFAULT_SPEC)).toBeCloseTo(-100, 6);
  });
});

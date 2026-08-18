import type { Direction, InstrumentSpec } from '../types/market.js';

/**
 * Risk calculator.
 *
 * Every number the calculator produces comes with the arithmetic that made it
 * (`steps`). Position size is never chosen silently: the trader sees the
 * division that produced the lot size before it is used anywhere.
 */

export interface RiskInput {
  accountBalance: number;
  riskPercent: number;
  entry: number;
  stopLoss: number;
  takeProfit1: number | null;
  takeProfit2: number | null;
  takeProfit3: number | null;
  direction: Direction;
  instrument: InstrumentSpec;
  /** Override the calculated size with a manually chosen lot size. */
  manualLotSize?: number | null;
  /** Hard ceiling from the user's rules; the result is flagged when exceeded. */
  maxRiskPercent?: number;
}

export interface TargetProjection {
  label: 'TP1' | 'TP2' | 'TP3';
  price: number;
  distance: number;
  rMultiple: number;
  profit: number;
}

export interface RiskResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** Account-currency value of a one-unit price move for one standard lot. */
  valuePerPricePerLot: number;
  stopDistance: number;
  intendedRiskAmount: number;
  /** Lot size after rounding to the broker's lot step. */
  lotSize: number;
  /** Base-asset units the lot size represents (lots x contract size). */
  units: number;
  /** Risk actually taken once the lot size is rounded. */
  actualRiskAmount: number;
  actualRiskPercent: number;
  targets: TargetProjection[];
  /** Reward:risk of the furthest configured target. */
  maxRR: number | null;
  steps: string[];
}

export function valuePerPricePerLot(instrument: InstrumentSpec): number {
  if (instrument.tickSize <= 0) return instrument.contractSize;
  return instrument.tickValue / instrument.tickSize;
}

function roundToStep(value: number, step: number): number {
  if (step <= 0) return value;
  const rounded = Math.floor(value / step + 1e-9) * step;
  const decimals = (String(step).split('.')[1] ?? '').length;
  return Number(rounded.toFixed(decimals));
}

export function calculateRisk(input: RiskInput): RiskResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const steps: string[] = [];
  const { instrument } = input;

  if (!(input.accountBalance > 0)) errors.push('Account balance must be greater than zero.');
  if (!(input.riskPercent > 0)) errors.push('Risk percent must be greater than zero.');
  if (!Number.isFinite(input.entry)) errors.push('Entry price is required.');
  if (!Number.isFinite(input.stopLoss)) errors.push('Stop loss is required.');

  const stopDistance = Math.abs(input.entry - input.stopLoss);
  if (stopDistance <= 0) errors.push('Stop loss must differ from entry.');

  if (input.direction === 'long' && input.stopLoss >= input.entry) {
    errors.push('A long stop loss must sit below the entry.');
  }
  if (input.direction === 'short' && input.stopLoss <= input.entry) {
    errors.push('A short stop loss must sit above the entry.');
  }

  const perPrice = valuePerPricePerLot(instrument);
  const intendedRiskAmount = (input.accountBalance * input.riskPercent) / 100;

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      warnings,
      valuePerPricePerLot: perPrice,
      stopDistance,
      intendedRiskAmount,
      lotSize: 0,
      units: 0,
      actualRiskAmount: 0,
      actualRiskPercent: 0,
      targets: [],
      maxRR: null,
      steps,
    };
  }

  steps.push(
    `Contract spec: 1 lot = ${instrument.contractSize} units, tick ${instrument.tickSize} = ${instrument.tickValue} ${instrument.quoteCurrency}`,
  );
  steps.push(
    `Value of a 1.00 price move per lot = ${instrument.tickValue} / ${instrument.tickSize} = ${perPrice.toFixed(2)} ${instrument.quoteCurrency}`,
  );
  steps.push(
    `Risk amount = ${input.accountBalance.toFixed(2)} x ${input.riskPercent}% = ${intendedRiskAmount.toFixed(2)} ${instrument.quoteCurrency}`,
  );
  steps.push(`Stop distance = |${input.entry} - ${input.stopLoss}| = ${stopDistance.toFixed(instrument.pricePrecision)}`);

  const riskPerLot = stopDistance * perPrice;
  steps.push(
    `Risk per lot = ${stopDistance.toFixed(instrument.pricePrecision)} x ${perPrice.toFixed(2)} = ${riskPerLot.toFixed(2)} ${instrument.quoteCurrency}`,
  );

  const rawLots = riskPerLot > 0 ? intendedRiskAmount / riskPerLot : 0;
  steps.push(
    `Raw position size = ${intendedRiskAmount.toFixed(2)} / ${riskPerLot.toFixed(2)} = ${rawLots.toFixed(4)} lots`,
  );

  let lotSize = input.manualLotSize ?? roundToStep(rawLots, instrument.lotStep);
  if (input.manualLotSize != null) {
    steps.push(`Manual override: ${input.manualLotSize} lots`);
  } else {
    steps.push(`Rounded DOWN to broker lot step ${instrument.lotStep} = ${lotSize} lots`);
  }

  if (lotSize < instrument.minLot) {
    warnings.push(
      `Calculated size ${lotSize} is below the broker minimum ${instrument.minLot}. Reduce risk, widen the account, or skip the trade.`,
    );
    lotSize = 0;
  }
  if (lotSize > instrument.maxLot) {
    warnings.push(`Size capped at the broker maximum ${instrument.maxLot} lots.`);
    lotSize = instrument.maxLot;
  }

  const actualRiskAmount = lotSize * riskPerLot;
  const actualRiskPercent =
    input.accountBalance > 0 ? (actualRiskAmount / input.accountBalance) * 100 : 0;

  const ceiling = input.maxRiskPercent;
  if (ceiling != null && actualRiskPercent > ceiling + 1e-9) {
    warnings.push(
      `Risk ${actualRiskPercent.toFixed(2)}% exceeds your configured maximum of ${ceiling}%.`,
    );
  }

  const targets: TargetProjection[] = [];
  const targetInputs: [TargetProjection['label'], number | null][] = [
    ['TP1', input.takeProfit1],
    ['TP2', input.takeProfit2],
    ['TP3', input.takeProfit3],
  ];

  for (const [label, price] of targetInputs) {
    if (price == null || !Number.isFinite(price)) continue;
    const favourable =
      input.direction === 'long' ? price > input.entry : price < input.entry;
    if (!favourable) {
      warnings.push(`${label} at ${price} is on the wrong side of the entry and was ignored.`);
      continue;
    }
    const distance = Math.abs(price - input.entry);
    targets.push({
      label,
      price,
      distance,
      rMultiple: stopDistance > 0 ? distance / stopDistance : 0,
      profit: distance * perPrice * lotSize,
    });
  }

  const maxRR = targets.length > 0 ? Math.max(...targets.map((t) => t.rMultiple)) : null;

  return {
    valid: lotSize > 0,
    errors,
    warnings,
    valuePerPricePerLot: perPrice,
    stopDistance,
    intendedRiskAmount,
    lotSize,
    units: lotSize * instrument.contractSize,
    actualRiskAmount,
    actualRiskPercent,
    targets,
    maxRR,
    steps,
  };
}

/** Realised R for a closed position, given the average exit. */
export function rMultiple(
  entry: number,
  stopLoss: number,
  exit: number,
  direction: Direction,
): number | null {
  const risk = Math.abs(entry - stopLoss);
  if (risk <= 0) return null;
  const move = direction === 'long' ? exit - entry : entry - exit;
  return move / risk;
}

/** Account-currency P/L for a partial or full exit. */
export function profitFor(
  entry: number,
  exit: number,
  lots: number,
  direction: Direction,
  instrument: InstrumentSpec,
): number {
  const move = direction === 'long' ? exit - entry : entry - exit;
  return move * valuePerPricePerLot(instrument) * lots;
}

export const RISK_PRESETS = [0.25, 0.5, 1] as const;

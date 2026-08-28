import type { Direction, Timeframe } from '../types/market.js';
import type { SetupEvaluation, SetupStatus } from './types.js';
import type { EvaluateSetupInput } from './engine.js';
import { evaluateSetup } from './engine.js';

export interface TradingSignal {
  id: string;
  type: 'BUY' | 'SELL';
  direction: Direction;
  timeframe: Timeframe;
  symbol: string;
  status: SetupStatus;
  qualityScore: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  /**
   * Reward-to-risk for EACH target, so a caller can never show one target's
   * price beside another target's ratio. `riskRewardRatio` is TP1's, because
   * TP1 is what the signal card displays.
   */
  riskRewardRatio: number;
  riskRewardTp1: number;
  riskRewardTp2: number;
  riskRewardTp3: number;
  fvgId: string | null;
  liquidityLevelId: string | null;
  summary: string;
  timestamp: number;
}

export interface DetectSignalsOptions extends Omit<EvaluateSetupInput, 'direction'> {
  symbol?: string;
  directionsToTest?: Direction[];
}

/**
 * Detect signals by evaluating setups for both long (BUY) and short (SELL) directions.
 */
export function detectSignals(options: DetectSignalsOptions): TradingSignal[] {
  const symbol = options.symbol ?? 'XAUUSD';
  const directions: Direction[] = options.directionsToTest ?? ['long', 'short'];
  const signals: TradingSignal[] = [];

  for (const dir of directions) {
    const evalInput: EvaluateSetupInput = {
      ...options,
      direction: dir,
    };

    const evaluation: SetupEvaluation = evaluateSetup(evalInput);
    const { setupStatus, fvg, liquiditySweep, displacement, missingConditions, summary } = evaluation;

    // We generate signals when setup is qualified, caution, or forming
    if (setupStatus === 'qualified' || setupStatus === 'caution' || setupStatus === 'forming') {
      const type: 'BUY' | 'SELL' = dir === 'long' ? 'BUY' : 'SELL';
      const entryPrice = fvg?.midpoint ?? options.price;

      // Determine Stop Loss: structural invalidation (FVG low/high or sweep) with ATR buffer
      let stopLoss: number;
      const recentWindow = options.candles.slice(-10);
      const atr = options.candles.length > 1 ? Math.abs(options.candles[options.candles.length - 1]!.high - options.candles[options.candles.length - 1]!.low) : 1.0;

      if (dir === 'long') {
        const structuralLow = fvg?.low ?? liquiditySweep?.price ?? Math.min(...recentWindow.map((c) => c.low));
        stopLoss = structuralLow - Math.max(0.3, atr * 0.25);
      } else {
        const structuralHigh = fvg?.high ?? liquiditySweep?.price ?? Math.max(...recentWindow.map((c) => c.high));
        stopLoss = structuralHigh + Math.max(0.3, atr * 0.25);
      }

      const risk = Math.abs(entryPrice - stopLoss);
      if (risk <= 0) continue;

      const tp1 = dir === 'long' ? entryPrice + risk * 2 : entryPrice - risk * 2;
      const tp2 = dir === 'long' ? entryPrice + risk * 3 : entryPrice - risk * 3;

      // TP3 aims at the opposite liquidity pool, but only when that pool is
      // genuinely FURTHER than TP2. A level sitting between TP1 and TP2 is a
      // nearer target, not a third one: taking it made TP3 land closer than
      // TP2, so the card listed targets that ran backwards.
      let tp3: number;
      const oppositeSide = dir === 'long' ? 'buy-side' : 'sell-side';
      const beyondTp2 = (price: number): boolean =>
        dir === 'long' ? price > tp2 : price < tp2;
      const targetLevel = options.liquidity
        .filter(
          (l) =>
            l.side === oppositeSide &&
            l.status === 'intact' &&
            (dir === 'long' ? l.price > entryPrice : l.price < entryPrice) &&
            beyondTp2(l.price),
        )
        // Nearest qualifying pool, so TP3 is reachable rather than the furthest
        // level that happens to be on the books.
        .sort((a, b) => Math.abs(a.price - entryPrice) - Math.abs(b.price - entryPrice))[0];

      if (targetLevel) {
        tp3 = targetLevel.price;
      } else {
        tp3 = dir === 'long' ? entryPrice + risk * 4.5 : entryPrice - risk * 4.5;
      }

      const qualityScore = Math.round(displacement?.score ?? 70);

      // One ratio per target. Deriving a single "the" ratio from TP2 and then
      // rendering it next to TP1 overstated the reward on the target actually
      // shown by 50%.
      const ratioFor = (target: number): number =>
        Number((Math.abs(target - entryPrice) / risk).toFixed(1));
      const rrTp1 = ratioFor(tp1);
      const rrTp2 = ratioFor(tp2);
      const rrTp3 = ratioFor(tp3);

      signals.push({
        id: `${type.toLowerCase()}-${options.executionTimeframe}-${options.at}-${Math.round(entryPrice)}`,
        type,
        direction: dir,
        timeframe: options.executionTimeframe,
        symbol,
        status: setupStatus,
        qualityScore,
        entryPrice: Number(entryPrice.toFixed(2)),
        stopLoss: Number(stopLoss.toFixed(2)),
        takeProfit1: Number(tp1.toFixed(2)),
        takeProfit2: Number(tp2.toFixed(2)),
        takeProfit3: Number(tp3.toFixed(2)),
        riskRewardRatio: rrTp1,
        riskRewardTp1: rrTp1,
        riskRewardTp2: rrTp2,
        riskRewardTp3: rrTp3,
        fvgId: fvg?.id ?? null,
        liquidityLevelId: liquiditySweep?.levelId ?? null,
        summary: summary || `${type} signal forming at ${entryPrice.toFixed(2)}`,
        timestamp: options.at,
      });
    }
  }

  return signals;
}

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
  riskRewardRatio: number;
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

      // Target opposite liquidity level for TP3 if available AND in trade direction
      let tp3: number;
      const oppositeSide = dir === 'long' ? 'buy-side' : 'sell-side';
      const targetLevel = options.liquidity.find(
        (l) => l.side === oppositeSide && l.status === 'intact' && (dir === 'long' ? l.price > entryPrice : l.price < entryPrice),
      );

      if (targetLevel) {
        tp3 = targetLevel.price;
      } else {
        tp3 = dir === 'long' ? entryPrice + risk * 4.5 : entryPrice - risk * 4.5;
      }

      const qualityScore = Math.round(displacement?.score ?? 70);
      const rr = Number((Math.abs(tp2 - entryPrice) / risk).toFixed(1));

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
        riskRewardRatio: rr,
        fvgId: fvg?.id ?? null,
        liquidityLevelId: liquiditySweep?.levelId ?? null,
        summary: summary || `${type} signal forming at ${entryPrice.toFixed(2)}`,
        timestamp: options.at,
      });
    }
  }

  return signals;
}

import type { Candle, Timeframe } from '../types/market.js';

/**
 * Replay controller.
 *
 * The single rule this class enforces: nothing beyond the cursor is ever
 * returned. Lookahead bias is not something to "be careful about" — the API
 * simply has no way to see a future candle.
 */

export interface ReplayState {
  cursor: number;
  playing: boolean;
  /** Bars advanced per tick. */
  speed: number;
  /** Milliseconds between ticks. */
  intervalMs: number;
}

export class ReplaySession {
  private readonly all: Candle[];

  private index: number;

  readonly timeframe: Timeframe;

  constructor(candles: Candle[], timeframe: Timeframe, startIndex = 0) {
    this.all = [...candles].sort((a, b) => a.time - b.time);
    this.timeframe = timeframe;
    this.index = Math.max(0, Math.min(startIndex, this.all.length - 1));
  }

  get length(): number {
    return this.all.length;
  }

  get cursor(): number {
    return this.index;
  }

  get atEnd(): boolean {
    return this.index >= this.all.length - 1;
  }

  /** Candles the trader is allowed to see. Never includes the future. */
  visible(): Candle[] {
    return this.all.slice(0, this.index + 1);
  }

  current(): Candle | null {
    return this.all[this.index] ?? null;
  }

  /** Current time, i.e. "now" for every engine during replay. */
  now(): number {
    return this.current()?.time ?? 0;
  }

  step(bars = 1): Candle | null {
    this.index = Math.min(this.all.length - 1, this.index + Math.max(1, bars));
    return this.current();
  }

  stepBack(bars = 1): Candle | null {
    this.index = Math.max(0, this.index - Math.max(1, bars));
    return this.current();
  }

  seek(index: number): void {
    this.index = Math.max(0, Math.min(index, this.all.length - 1));
  }

  /** Jump to the first bar at or after `time`. */
  seekTime(time: number): void {
    const found = this.all.findIndex((candle) => candle.time >= time);
    this.seek(found === -1 ? this.all.length - 1 : found);
  }

  /**
   * Everything after the cursor. Intended solely for the backtest simulator's
   * fill logic, which must be able to resolve a trade's outcome. Never expose
   * this to the UI.
   */
  futureForSimulation(): Candle[] {
    return this.all.slice(this.index + 1);
  }
}

export const REPLAY_SPEEDS = [0.5, 1, 2, 4, 8, 16] as const;

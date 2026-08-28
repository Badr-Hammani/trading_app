'use client';

import { create } from 'zustand';
import type { Timeframe } from '@xau/core';

/**
 * Shared client state.
 *
 * Only genuinely cross-page state lives here: the selected timeframe, the
 * replay cursor, and the direction being evaluated. Everything else stays
 * local to its page so a stale store never shows the wrong market.
 */

/**
 * A signal handed from the dashboard to the risk calculator.
 *
 * The two live on different pages, so the numbers travel through the store
 * rather than through props. Consumed once and cleared, so returning to the
 * risk page later does not silently repopulate it with a stale signal.
 */
export interface PendingTrade {
  direction: 'long' | 'short';
  entry: number;
  stopLoss: number;
  takeProfit1: number | null;
  takeProfit2: number | null;
  takeProfit3: number | null;
  label: string;
}

export interface AppState {
  timeframe: Timeframe;
  direction: 'long' | 'short';
  /** Replay cursor as epoch seconds; null means live. */
  replayAt: number | null;
  /** Auto-refresh interval for live data, in ms. 0 disables it. */
  refreshMs: number;
  /** Set by the dashboard when a signal is loaded; read once by /risk. */
  pendingTrade: PendingTrade | null;
  setTimeframe: (timeframe: Timeframe) => void;
  setDirection: (direction: 'long' | 'short') => void;
  setReplayAt: (at: number | null) => void;
  setRefreshMs: (ms: number) => void;
  setPendingTrade: (trade: PendingTrade | null) => void;
  /** Returns the pending trade and clears it, so it is applied exactly once. */
  consumePendingTrade: () => PendingTrade | null;
}

export const useAppStore = create<AppState>((set, get) => ({
  timeframe: '5M',
  direction: 'long',
  replayAt: null,
  refreshMs: 30_000,
  pendingTrade: null,
  setTimeframe: (timeframe) => set({ timeframe }),
  setDirection: (direction) => set({ direction }),
  setReplayAt: (replayAt) => set({ replayAt }),
  setRefreshMs: (refreshMs) => set({ refreshMs }),
  setPendingTrade: (pendingTrade) => set({ pendingTrade }),
  consumePendingTrade: () => {
    const trade = get().pendingTrade;
    if (trade) set({ pendingTrade: null });
    return trade;
  },
}));

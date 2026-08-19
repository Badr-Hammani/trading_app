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

export interface AppState {
  timeframe: Timeframe;
  direction: 'long' | 'short';
  /** Replay cursor as epoch seconds; null means live. */
  replayAt: number | null;
  /** Auto-refresh interval for live data, in ms. 0 disables it. */
  refreshMs: number;
  setTimeframe: (timeframe: Timeframe) => void;
  setDirection: (direction: 'long' | 'short') => void;
  setReplayAt: (at: number | null) => void;
  setRefreshMs: (ms: number) => void;
}

export const useAppStore = create<AppState>((set) => ({
  timeframe: '5M',
  direction: 'long',
  replayAt: null,
  refreshMs: 30_000,
  setTimeframe: (timeframe) => set({ timeframe }),
  setDirection: (direction) => set({ direction }),
  setReplayAt: (replayAt) => set({ replayAt }),
  setRefreshMs: (refreshMs) => set({ refreshMs }),
}));

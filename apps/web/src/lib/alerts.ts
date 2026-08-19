/** Alert taxonomy, shared by the API routes and the UI. */

export const ALERT_TYPES = [
  'price_reaches_liquidity',
  'fvg_touched',
  'liquidity_swept',
  'structure_broken',
  'displacement_detected',
  'session_opened',
  'session_closing',
  'news_approaching',
  'tp1_hit',
  'tp2_hit',
  'sl_hit',
  'price_level',
] as const;

export type AlertType = (typeof ALERT_TYPES)[number];

export const ALERT_CHANNELS = ['in-app', 'browser', 'telegram', 'email'] as const;

export type AlertChannel = (typeof ALERT_CHANNELS)[number];

export const ALERT_LABELS: Record<AlertType, string> = {
  price_reaches_liquidity: 'Price reaches a liquidity level',
  fvg_touched: 'FVG touched',
  liquidity_swept: 'Liquidity swept',
  structure_broken: 'Structure broken',
  displacement_detected: 'Displacement detected',
  session_opened: 'Session opened',
  session_closing: 'Session closing',
  news_approaching: 'High-impact news approaching',
  tp1_hit: 'TP1 hit',
  tp2_hit: 'TP2 hit',
  sl_hit: 'Stop loss hit',
  price_level: 'Price reaches a specific level',
};

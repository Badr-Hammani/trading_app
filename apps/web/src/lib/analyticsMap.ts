import { DateTime } from 'luxon';
import type { AnalyticsTrade } from '@xau/core';

/** Project stored trade rows into the shared analytics shape. */
export interface TradeRowForAnalytics {
  id: string;
  openedAt: Date;
  closedAt: Date | null;
  direction: string;
  session: string;
  setupType: string | null;
  entryModel: string | null;
  managementModel: string;
  liquidityType: string | null;
  fvgTimeframe: string | null;
  fvgQuality: number | null;
  grade: string | null;
  ruleViolation: boolean;
  resultR: number | null;
  resultCurrency: number | null;
  maeR: number | null;
  mfeR: number | null;
  newsPresent: boolean;
  riskPercent: number;
}

export function tradeRowsToAnalytics(
  rows: TradeRowForAnalytics[],
  timezone: string,
): AnalyticsTrade[] {
  return rows.map((row) => {
    const local = DateTime.fromJSDate(row.openedAt, { zone: 'utc' }).setZone(timezone);
    return {
      id: row.id,
      openTime: Math.floor(row.openedAt.getTime() / 1000),
      closeTime: row.closedAt ? Math.floor(row.closedAt.getTime() / 1000) : null,
      direction: row.direction as AnalyticsTrade['direction'],
      session: row.session,
      setupType: row.setupType,
      entryModel: row.entryModel,
      managementModel: row.managementModel,
      liquidityType: row.liquidityType,
      fvgTimeframe: row.fvgTimeframe,
      fvgQuality: row.fvgQuality,
      grade: row.grade as AnalyticsTrade['grade'],
      ruleViolation: row.ruleViolation,
      resultR: row.resultR,
      resultCurrency: row.resultCurrency,
      maeR: row.maeR,
      mfeR: row.mfeR,
      newsPresent: row.newsPresent,
      riskPercent: row.riskPercent,
      dayOfWeek: local.weekday,
      hourOfDay: local.hour,
    };
  });
}

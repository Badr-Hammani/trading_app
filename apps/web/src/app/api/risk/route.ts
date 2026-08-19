import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { loadUserContext } from '@/lib/context';
import { handleRouteError, json, parseBody } from '@/lib/api';
import { calculateRisk, RISK_PRESETS } from '@xau/core';

export const dynamic = 'force-dynamic';

const schema = z.object({
  accountBalance: z.number().positive().optional(),
  riskPercent: z.number().positive(),
  entry: z.number(),
  stopLoss: z.number(),
  takeProfit1: z.number().nullable().optional(),
  takeProfit2: z.number().nullable().optional(),
  takeProfit3: z.number().nullable().optional(),
  direction: z.enum(['long', 'short']),
  manualLotSize: z.number().positive().nullable().optional(),
});

/**
 * Position sizing.
 *
 * The response always carries `steps`: the arithmetic behind the lot size.
 * The application never picks a size without showing how it got there.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(request, schema);
    const context = await loadUserContext(user.id);

    const result = calculateRisk({
      accountBalance: body.accountBalance ?? context.accountBalance,
      riskPercent: body.riskPercent,
      entry: body.entry,
      stopLoss: body.stopLoss,
      takeProfit1: body.takeProfit1 ?? null,
      takeProfit2: body.takeProfit2 ?? null,
      takeProfit3: body.takeProfit3 ?? null,
      direction: body.direction,
      instrument: context.instrument,
      manualLotSize: body.manualLotSize ?? null,
      maxRiskPercent: context.rules.maxRiskPercent,
    });

    return json({
      result,
      instrument: context.instrument,
      accountBalance: body.accountBalance ?? context.accountBalance,
      currency: context.accountCurrency,
      presets: RISK_PRESETS,
      maxRiskPercent: context.rules.maxRiskPercent,
      specNote:
        'Contract specification comes from Settings → Instruments. Confirm it against your own broker before trading — gold contract sizes differ between brokers.',
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function GET() {
  try {
    const user = await requireUser();
    const context = await loadUserContext(user.id);
    return json({
      instrument: context.instrument,
      accountBalance: context.accountBalance,
      currency: context.accountCurrency,
      defaultRiskPercent: context.settings.defaultRiskPercent,
      maxRiskPercent: context.rules.maxRiskPercent,
      presets: RISK_PRESETS,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

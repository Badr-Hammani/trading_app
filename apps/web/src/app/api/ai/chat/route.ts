import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { handleRouteError, json, parseBody } from '@/lib/api';
import { loadBias, loadCandles, loadUserContext } from '@/lib/context';
import { analyse } from '@/lib/analysis';
import { rowToEvent, rowToLiquidity } from '@/lib/serialize';
import { askAssistant } from '@/lib/ai';
import {
  AI_SYSTEM_PROMPT,
  formatInZone,
  startOfLocalDay,
  type Bias,
  type Timeframe,
} from '@xau/core';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const schema = z.object({
  message: z.string().min(1).max(4000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
    .max(20)
    .default([]),
  // Attach the current market state so the mentor reasons about real data
  // rather than whatever it remembers about gold.
  includeContext: z.boolean().default(true),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(request, schema);
    const context = await loadUserContext(user.id);

    if (!context.settings.aiAssistantEnabled) {
      return json({ available: false, reason: 'The AI assistant is switched off in Settings.' });
    }

    let contextBlock = '';
    if (body.includeContext) {
      contextBlock = await buildContextBlock(user.id);
    }

    const result = await askAssistant(AI_SYSTEM_PROMPT, [
      ...body.history.map((entry) => ({ role: entry.role, content: entry.content })),
      {
        role: 'user' as const,
        content: contextBlock
          ? `${contextBlock}\n\n---\n\nTrader's question: ${body.message}`
          : body.message,
      },
    ]);

    return json(result);
  } catch (error) {
    return handleRouteError(error);
  }
}

/**
 * A factual snapshot of the current state. Anything the app does not know is
 * stated as unknown, so the model cannot fill the gap with an invention.
 */
async function buildContextBlock(userId: string): Promise<string> {
  const context = await loadUserContext(userId);
  const at = Math.floor(Date.now() / 1000);

  const candles = await loadCandles(context, '5M', 400);
  if (candles.status !== 'ok') {
    return `MARKET DATA UNAVAILABLE: ${candles.message}\nDo not speculate about prices or levels; say the data is unavailable.`;
  }

  const dayStart = new Date(startOfLocalDay(at, context.timezone) * 1000);
  const [levels, events, biasMap] = await Promise.all([
    prisma.liquidityLevel.findMany({ where: { userId, symbol: context.symbol } }),
    prisma.economicEvent.findMany({
      where: {
        time: { gte: new Date(at * 1000), lte: new Date((at + 2 * 86400) * 1000) },
        OR: [{ userId }, { userId: null }],
      },
      orderBy: { time: 'asc' },
      take: 10,
    }),
    loadBias(userId, context.symbol, dayStart),
  ]);

  const analysis = analyse({
    context,
    candles: candles.data.candles,
    timeframe: '5M',
    at,
    manualLevels: levels.map(rowToLiquidity),
    events: events.map(rowToEvent),
    bias: biasMap as Partial<Record<Timeframe, Bias>>,
  });

  const describe = (side: 'long' | 'short') => {
    const evaluation = side === 'long' ? analysis.long : analysis.short;
    return [
      `${side.toUpperCase()} evaluation — status ${evaluation.setupStatus}`,
      ...evaluation.stages.map(
        (stage) =>
          `  - ${stage.label}: ${stage.state}${stage.evidence.length ? ` (${stage.evidence.join('; ')})` : ''}${
            stage.missing.length ? ` [missing: ${stage.missing.join('; ')}]` : ''
          }`,
      ),
    ].join('\n');
  };

  return [
    `CURRENT STATE (${formatInZone(at, context.timezone, 'yyyy-LL-dd HH:mm')} ${context.timezone})`,
    `Symbol: ${context.symbol}, last 5M close ${analysis.price.toFixed(2)} (provider: ${candles.data.meta.provider})`,
    `Market: ${analysis.market}. Sessions active: ${analysis.session.activeNames.join(', ') || 'none'}. Execution window: ${analysis.session.executionWindow ? 'yes' : 'no'}`,
    `Trader's bias: ${Object.entries(biasMap).map(([tf, bias]) => `${tf} ${bias}`).join(', ') || 'not set'}`,
    `Engine's structural reading (a suggestion, not the trader's bias): ${analysis.suggestedBias.bias} — ${analysis.suggestedBias.rationale}`,
    '',
    'LIQUIDITY:',
    ...analysis.liquidity
      .slice(0, 12)
      .map((level) => `  - ${level.label} ${level.type} @ ${level.price.toFixed(2)} [${level.status}]`),
    '',
    'FVG ZONES (live only):',
    ...analysis.fvgZones
      .filter((zone) => zone.status === 'fresh' || zone.status === 'partially_mitigated')
      .slice(-8)
      .map(
        (zone) =>
          `  - ${zone.direction} ${zone.low.toFixed(2)}-${zone.high.toFixed(2)} [${zone.status}, ${Math.round(zone.mitigation * 100)}% mitigated]`,
      ),
    '',
    'RECENT STRUCTURE:',
    ...analysis.structureEvents
      .slice(-6)
      .map((event) => `  - ${event.scope} ${event.direction} ${event.kind} through ${event.brokenLevel.toFixed(2)}`),
    '',
    `NEWS: ${analysis.long.newsRisk.message}`,
    '',
    describe('long'),
    '',
    describe('short'),
  ].join('\n');
}

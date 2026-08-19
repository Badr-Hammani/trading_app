import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { handleRouteError, json } from '@/lib/api';
import { loadBias, loadCandles, loadUserContext } from '@/lib/context';
import { analyse } from '@/lib/analysis';
import { rowToEvent, rowToLiquidity } from '@/lib/serialize';
import { formatDuration, startOfLocalDay, type Bias, type Timeframe } from '@xau/core';

export const dynamic = 'force-dynamic';

/**
 * Evaluate alert conditions against the current market state.
 *
 * The client polls this; the server owns the condition logic so an alert
 * means the same thing whether it fires in the browser or via Telegram.
 */
export async function POST() {
  try {
    const user = await requireUser();
    const context = await loadUserContext(user.id);
    const at = Math.floor(Date.now() / 1000);

    const alerts = await prisma.alert.findMany({ where: { userId: user.id, enabled: true } });
    if (alerts.length === 0) return json({ fired: [], evaluated: 0 });

    const candles = await loadCandles(context, '5M', 400);
    if (candles.status !== 'ok') {
      return json({ fired: [], evaluated: 0, reason: candles.message });
    }

    const dayStart = new Date(startOfLocalDay(at, context.timezone) * 1000);
    const [levelRows, eventRows, biasMap] = await Promise.all([
      prisma.liquidityLevel.findMany({ where: { userId: user.id, symbol: context.symbol } }),
      prisma.economicEvent.findMany({
        where: {
          time: { gte: new Date(at * 1000), lte: new Date((at + 2 * 86400) * 1000) },
          OR: [{ userId: user.id }, { userId: null }],
        },
        orderBy: { time: 'asc' },
      }),
      loadBias(user.id, context.symbol, dayStart),
    ]);

    const analysis = analyse({
      context,
      candles: candles.data.candles,
      timeframe: '5M',
      at,
      manualLevels: levelRows.map(rowToLiquidity),
      events: eventRows.map(rowToEvent),
      bias: biasMap as Partial<Record<Timeframe, Bias>>,
    });

    const fired: { alertId: string; title: string; body: string }[] = [];

    for (const alert of alerts) {
      const config = (alert.config ?? {}) as Record<string, unknown>;
      const hit = evaluateAlert(alert.type, config, analysis, at);
      if (!hit) continue;

      fired.push({ alertId: alert.id, title: hit.title, body: hit.body });

      await prisma.$transaction([
        prisma.alertNotification.create({
          data: { alertId: alert.id, title: hit.title, body: hit.body, channel: alert.channels[0] ?? 'in-app' },
        }),
        prisma.alert.update({
          where: { id: alert.id },
          data: {
            lastTriggeredAt: new Date(),
            triggerCount: { increment: 1 },
            ...(alert.oneShot ? { enabled: false } : {}),
          },
        }),
      ]);
    }

    return json({ fired, evaluated: alerts.length, price: analysis.price });
  } catch (error) {
    return handleRouteError(error);
  }
}

function evaluateAlert(
  type: string,
  config: Record<string, unknown>,
  analysis: ReturnType<typeof analyse>,
  at: number,
): { title: string; body: string } | null {
  const price = analysis.price;

  switch (type) {
    case 'price_level': {
      const target = Number(config.price);
      const tolerance = Number(config.tolerance ?? 0.5);
      if (!Number.isFinite(target)) return null;
      if (Math.abs(price - target) > tolerance) return null;
      return { title: 'Price level reached', body: `Price ${price.toFixed(2)} reached ${target.toFixed(2)}.` };
    }

    case 'price_reaches_liquidity': {
      const tolerance = Number(config.tolerance ?? 1);
      const near = analysis.liquidity.find(
        (level) => level.status === 'intact' && Math.abs(level.price - price) <= tolerance,
      );
      if (!near) return null;
      return {
        title: 'Price at liquidity',
        body: `${near.label} (${near.type}) at ${near.price.toFixed(2)} — price is ${price.toFixed(2)}.`,
      };
    }

    case 'liquidity_swept': {
      const recent = analysis.liquidity.find(
        (level) => level.status === 'swept' && level.eventTime !== null && at - level.eventTime < 900,
      );
      if (!recent) return null;
      return {
        title: 'LIQUIDITY SWEPT',
        body: `${recent.label} at ${recent.price.toFixed(2)} was swept. This is one stage of the model, not an entry.`,
      };
    }

    case 'fvg_touched': {
      const touched = analysis.fvgZones.find(
        (zone) =>
          zone.status === 'partially_mitigated' &&
          zone.firstTouchTime !== null &&
          at - zone.firstTouchTime < 900,
      );
      if (!touched) return null;
      return {
        title: 'FVG touched',
        body: `Price entered the ${touched.direction} ${touched.timeframe} FVG ${touched.low.toFixed(2)}–${touched.high.toFixed(2)}. A touch is a location, not a signal.`,
      };
    }

    case 'structure_broken': {
      const recent = analysis.structureEvents.filter((event) => at - event.time < 900).pop();
      if (!recent) return null;
      return {
        title: `${recent.scope} ${recent.kind}`,
        body: `${recent.direction} ${recent.kind} through ${recent.brokenLevel.toFixed(2)}.`,
      };
    }

    case 'displacement_detected': {
      const threshold = Number(config.minScore ?? 70);
      const recent = analysis.displacement
        .filter((reading) => at - reading.time < 900 && reading.score >= threshold)
        .pop();
      if (!recent) return null;
      return {
        title: `Displacement ${recent.score}/100`,
        body: `${recent.direction} displacement: ${recent.reasons.join('; ')}.`,
      };
    }

    case 'session_opened': {
      const opened = analysis.session.active.find((occurrence) => at - occurrence.start < 300);
      if (!opened) return null;
      return { title: `${opened.definition.name} open`, body: `${opened.definition.name} session has opened.` };
    }

    case 'session_closing': {
      const warning = Number(config.minutesBefore ?? 15) * 60;
      const seconds = analysis.session.secondsToActiveClose;
      if (seconds === null || seconds > warning) return null;
      return {
        title: 'Session closing',
        body: `${analysis.session.activeNames.join(', ')} closes in ${formatDuration(seconds)}.`,
      };
    }

    case 'news_approaching': {
      const risk = analysis.long.newsRisk;
      const window = Number(config.minutesBefore ?? 30);
      if (!risk.minutesToEvent || risk.minutesToEvent < 0 || risk.minutesToEvent > window) return null;
      return {
        title: `HIGH IMPACT EVENT IN ${risk.minutesToEvent} MINUTES`,
        body: risk.message,
      };
    }

    default:
      return null;
  }
}

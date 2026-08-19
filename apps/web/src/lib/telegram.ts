import { prisma } from './db';
import { env } from './env';
import { loadBias, loadCandles, loadUserContext } from './context';
import { analyse } from './analysis';
import { rowToEvent, rowToLiquidity } from './serialize';
import { tradeRowsToAnalytics } from './analyticsMap';
import {
  computeStatistics,
  formatDuration,
  formatInZone,
  startOfLocalDay,
  startOfLocalWeek,
  type Bias,
  type Timeframe,
} from '@xau/core';

/**
 * Telegram bot.
 *
 * Read-only by design: every command reports state. There is no command that
 * places, modifies or closes a trade, and the bot repeats the same "this is a
 * stage, not a signal" framing the UI uses.
 */

export const TELEGRAM_COMMANDS = [
  { command: 'status', description: 'Market status, session and execution window' },
  { command: 'gold', description: 'XAUUSD price with bias and structure by timeframe' },
  { command: 'calendar', description: 'Upcoming high-impact events for gold' },
  { command: 'setup', description: 'Current setup evaluation and what is missing' },
  { command: 'risk', description: 'Account, risk settings and contract specification' },
  { command: 'journal', description: 'The last few closed trades with grades' },
  { command: 'today', description: "Today's trades, R and rule adherence" },
  { command: 'week', description: 'This week performance summary' },
];

export async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  if (!env.telegramBotToken) return false;
  const response = await fetch(`https://api.telegram.org/bot${env.telegramBotToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  return response.ok;
}

export async function handleTelegramCommand(userId: string, raw: string): Promise<string> {
  const command = raw.trim().split(/\s+/)[0]?.replace(/^\//, '').split('@')[0]?.toLowerCase() ?? '';
  const context = await loadUserContext(userId);
  const at = Math.floor(Date.now() / 1000);

  switch (command) {
    case 'status':
      return statusReport(context, at);
    case 'gold':
      return goldReport(userId, at);
    case 'calendar':
      return calendarReport(userId, at);
    case 'setup':
      return setupReport(userId, at);
    case 'risk':
      return riskReport(context);
    case 'journal':
      return journalReport(userId, context.timezone);
    case 'today':
      return todayReport(userId, context.timezone, at);
    case 'week':
      return weekReport(userId, context.timezone, at);
    default:
      return [
        'Available commands:',
        ...TELEGRAM_COMMANDS.map((entry) => `/${entry.command} — ${entry.description}`),
        '',
        'This bot reports state only. It cannot place or manage trades.',
      ].join('\n');
  }
}

type Context = Awaited<ReturnType<typeof loadUserContext>>;

async function statusReport(context: Context, at: number): Promise<string> {
  const { sessionStatus, marketStatus } = await import('@xau/core');
  const status = sessionStatus(context.sessions, at);

  return [
    `<b>STATUS</b> — ${formatInZone(at, context.timezone, 'ccc dd LLL HH:mm')} (${context.timezone})`,
    `Market: ${marketStatus(at).toUpperCase()}`,
    `Active: ${status.activeNames.join(', ') || 'none'}`,
    status.executionWindow ? 'Execution window: OPEN' : 'Execution window: <b>NO EXECUTION WINDOW</b>',
    status.next
      ? `Next: ${status.next.definition.name} in ${formatDuration(status.secondsToNextOpen ?? 0)}`
      : 'No further sessions scheduled in the next few days.',
    context.manualBlock.active ? `\n<b>MANUAL BLOCK ACTIVE</b>: ${context.manualBlock.reason}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function goldReport(userId: string, at: number): Promise<string> {
  const context = await loadUserContext(userId);
  const quote = await context.providers.marketData.getQuote(context.symbol);
  const dayStart = new Date(startOfLocalDay(at, context.timezone) * 1000);
  const bias = await loadBias(userId, context.symbol, dayStart);

  const { sessionStatus } = await import('@xau/core');
  const status = sessionStatus(context.sessions, at);

  const events = await prisma.economicEvent.findMany({
    where: {
      time: { gte: new Date(at * 1000) },
      importance: 'high',
      OR: [{ userId }, { userId: null }],
    },
    orderBy: { time: 'asc' },
    take: 1,
  });

  const lines = [
    `<b>${context.symbol}: ${quote.status === 'ok' ? quote.data.mid.toFixed(2) : 'DATA UNAVAILABLE'}</b>`,
  ];

  if (quote.status === 'unavailable') lines.push(`<i>${quote.message}</i>`);
  else if (quote.data.delayed) lines.push('<i>Delayed feed.</i>');

  lines.push(
    '',
    `4H: ${(bias['4H'] ?? 'not set').toUpperCase()}`,
    `1H: ${(bias['1H'] ?? 'not set').toUpperCase()}`,
    `30M: ${(bias['30M'] ?? 'not set').toUpperCase()}`,
    `15M: ${(bias['15M'] ?? 'not set').toUpperCase()}`,
    `5M: ${(bias['5M'] ?? 'not set').toUpperCase()}`,
    '',
    ...context.sessions
      .filter((session) => session.enabled && session.kind !== 'overlap')
      .map((session) => {
        const active = status.active.some((entry) => entry.definition.id === session.id);
        return `${session.name}: ${active ? 'OPEN' : 'CLOSED'}`;
      }),
  );

  if (events[0]) {
    const minutes = Math.round((events[0].time.getTime() / 1000 - at) / 60);
    lines.push('', `High impact news:`, `${events[0].name} in ${minutes}m`);
  }

  return lines.join('\n');
}

async function calendarReport(userId: string, at: number): Promise<string> {
  const context = await loadUserContext(userId);
  const result = await context.providers.economic.getCalendar({
    from: at,
    to: at + 7 * 86400,
    minImportance: 'high',
  });

  if (result.status !== 'ok') return `<b>CALENDAR</b>\nDATA UNAVAILABLE — ${result.message}`;
  if (result.data.length === 0) return '<b>CALENDAR</b>\nNo high-impact events in the next 7 days.';

  return [
    '<b>CALENDAR — next 7 days</b>',
    ...result.data
      .slice(0, 12)
      .map(
        (event) =>
          `${formatInZone(event.time, context.timezone, 'ccc dd HH:mm')} — ${event.name} (${event.country})`,
      ),
    '',
    `Times in ${context.timezone}.`,
  ].join('\n');
}

async function setupReport(userId: string, at: number): Promise<string> {
  const context = await loadUserContext(userId);
  const candles = await loadCandles(context, '5M', 400);
  if (candles.status !== 'ok') return `<b>SETUP</b>\nDATA UNAVAILABLE — ${candles.message}`;

  const dayStart = new Date(startOfLocalDay(at, context.timezone) * 1000);
  const [levels, events, bias] = await Promise.all([
    prisma.liquidityLevel.findMany({ where: { userId, symbol: context.symbol } }),
    prisma.economicEvent.findMany({
      where: {
        time: { gte: new Date((at - 3600) * 1000), lte: new Date((at + 86400) * 1000) },
        OR: [{ userId }, { userId: null }],
      },
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
    bias: bias as Partial<Record<Timeframe, Bias>>,
  });

  const side =
    analysis.long.stages.filter((stage) => stage.state === 'met').length >=
    analysis.short.stages.filter((stage) => stage.state === 'met').length
      ? analysis.long
      : analysis.short;

  return [
    `<b>SETUP — ${side.direction.toUpperCase()}</b>`,
    side.summary,
    '',
    ...side.stages.map(
      (stage) => `${stage.state === 'met' ? '✓' : stage.state === 'partial' ? '~' : '·'} ${stage.label}`,
    ),
    '',
    side.missingConditions.length > 0 ? `<b>Missing:</b>\n${side.missingConditions.slice(0, 6).join('\n')}` : '',
    '',
    '<i>Stages of a model, not a signal. Every decision is yours.</i>',
  ]
    .filter(Boolean)
    .join('\n');
}

async function riskReport(context: Context): Promise<string> {
  const { valuePerPricePerLot } = await import('@xau/core');
  return [
    '<b>RISK</b>',
    `Account: ${context.accountBalance.toFixed(2)} ${context.accountCurrency}`,
    `Default risk: ${context.settings.defaultRiskPercent}%`,
    `Maximum risk: ${context.rules.maxRiskPercent}%`,
    '',
    `Contract: 1 lot = ${context.instrument.contractSize} units`,
    `1.00 price move per lot = ${valuePerPricePerLot(context.instrument).toFixed(2)} ${context.instrument.quoteCurrency}`,
    `Lot step ${context.instrument.lotStep}, min ${context.instrument.minLot}`,
    '',
    '<i>Confirm the contract spec against your broker.</i>',
  ].join('\n');
}

async function journalReport(userId: string, timezone: string): Promise<string> {
  const trades = await prisma.trade.findMany({
    where: { userId, status: 'closed' },
    orderBy: { closedAt: 'desc' },
    take: 5,
  });
  if (trades.length === 0) return '<b>JOURNAL</b>\nNo closed trades recorded yet.';

  return [
    '<b>JOURNAL — last 5 closed</b>',
    ...trades.map(
      (trade) =>
        `${formatInZone(Math.floor(trade.openedAt.getTime() / 1000), timezone, 'dd LLL HH:mm')} ${trade.direction.toUpperCase()} ` +
        `${trade.resultR !== null ? `${trade.resultR >= 0 ? '+' : ''}${trade.resultR.toFixed(2)}R` : '—'} ` +
        `[${trade.grade ?? 'ungraded'}]`,
    ),
  ].join('\n');
}

async function todayReport(userId: string, timezone: string, at: number): Promise<string> {
  const dayStart = startOfLocalDay(at, timezone);
  const trades = await prisma.trade.findMany({
    where: { userId, openedAt: { gte: new Date(dayStart * 1000) } },
  });
  const missed = await prisma.missedSetup.count({
    where: { userId, time: { gte: new Date(dayStart * 1000) } },
  });

  const statistics = computeStatistics(tradeRowsToAnalytics(trades, timezone));
  const ruleBreaks = trades.filter((trade) => trade.ruleViolation || trade.grade === 'RULE_BREAK').length;

  return [
    `<b>TODAY — ${formatInZone(at, timezone, 'ccc dd LLL')}</b>`,
    `Trades: ${trades.length} (${statistics.trades} closed)`,
    `R: ${statistics.totalR.toFixed(2)}`,
    `P/L: ${statistics.totalCurrency.toFixed(2)}`,
    `Rule breaks: ${ruleBreaks}`,
    `Missed setups logged: ${missed}`,
  ].join('\n');
}

async function weekReport(userId: string, timezone: string, at: number): Promise<string> {
  const weekStart = startOfLocalWeek(at, timezone);
  const trades = await prisma.trade.findMany({
    where: { userId, openedAt: { gte: new Date(weekStart * 1000) } },
  });
  const statistics = computeStatistics(tradeRowsToAnalytics(trades, timezone));

  return [
    '<b>WEEK</b>',
    `Trades: ${statistics.trades}`,
    `Win rate: ${statistics.winRate === null ? '—' : `${statistics.winRate.toFixed(0)}%`}`,
    `Expectancy: ${statistics.expectancyR === null ? '—' : `${statistics.expectancyR.toFixed(2)}R`}`,
    `Profit factor: ${statistics.profitFactor === null ? '—' : statistics.profitFactor.toFixed(2)}`,
    `Total R: ${statistics.totalR.toFixed(2)}`,
    `Max drawdown: ${statistics.maxDrawdownR.toFixed(2)}R`,
    `Rule adherence: ${statistics.ruleAdherencePercent === null ? '—' : `${statistics.ruleAdherencePercent.toFixed(0)}%`}`,
  ].join('\n');
}

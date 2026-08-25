import {
  DEFAULT_SESSIONS,
  DEFAULT_STRATEGY_RULES,
  XAUUSD_DEFAULT_SPEC,
  type InstrumentSpec,
  type SessionDefinition,
  type StrategyRules,
  type Timeframe,
} from '@xau/core';
import { buildProviders, LocalSeriesProvider, type ProviderBundle } from '@xau/providers';
import { prisma } from './db';
import { env, providerEnv } from './env';
import { rowToEvent, rowsToCandles, toEpoch } from './serialize';

/**
 * Per-user runtime context.
 *
 * Assembles the user's sessions, strategy rules, instrument spec and provider
 * bundle in one place, so every route evaluates setups against exactly the
 * same configuration the dashboard is showing.
 */

export interface UserContext {
  userId: string;
  timezone: string;
  symbol: string;
  sessions: SessionDefinition[];
  rules: StrategyRules;
  instrument: InstrumentSpec;
  accountBalance: number;
  accountCurrency: string;
  providers: ProviderBundle;
  manualBlock: { active: boolean; reason: string };
  strategyVersion: string;
  settings: {
    defaultRiskPercent: number;
    maxRiskPercent: number;
    aiAssistantEnabled: boolean;
    aiBiasSuggestionEnabled: boolean;
    browserNotifications: boolean;
    telegramEnabled: boolean;
    emailAlertsEnabled: boolean;
  };
}

export async function loadUserContext(userId: string): Promise<UserContext> {
  const [user, settings, sessionRows, account, instrument] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.userSettings.findUnique({ where: { userId } }),
    prisma.tradingSession.findMany({ where: { userId }, orderBy: { sortOrder: 'asc' } }),
    prisma.account.findFirst({ where: { userId, isDefault: true } }),
    prisma.instrument.findUnique({ where: { symbol: env.defaultSymbol } }),
  ]);

  const sessions: SessionDefinition[] =
    sessionRows.length > 0
      ? sessionRows.map((row) => ({
          id: row.id,
          name: row.name,
          kind: row.kind as SessionDefinition['kind'],
          timezone: row.timezone,
          startMinutes: row.startMinutes,
          endMinutes: row.endMinutes,
          days: row.days,
          tradingPermitted: row.tradingPermitted,
          enabled: row.enabled,
          color: row.color,
        }))
      : DEFAULT_SESSIONS;

  const rules: StrategyRules = settings
    ? {
        minDisplacementScore: settings.minDisplacementScore,
        requireChoch: settings.requireChoch,
        requireFvgAfterStructure: settings.requireFvgAfterStructure,
        maxFvgMitigation: settings.maxFvgMitigation,
        sensitivity: settings.sensitivity as StrategyRules['sensitivity'],
        enforceSessionFilter: settings.enforceSessionFilter,
        newsFilterEnabled: settings.newsFilterEnabled,
        newsWindowMinutes: settings.newsWindowMinutes,
        maxRiskPercent: settings.maxRiskPercent,
        maxBarsFromStructureBreak: settings.maxBarsFromStructureBreak,
        maxFvgDistanceAtr: DEFAULT_STRATEGY_RULES.maxFvgDistanceAtr,
        maxFvgAgeBars: DEFAULT_STRATEGY_RULES.maxFvgAgeBars,
        invalidateOnOpposingStructure: DEFAULT_STRATEGY_RULES.invalidateOnOpposingStructure,
        requireOriginatingSwingIntact: DEFAULT_STRATEGY_RULES.requireOriginatingSwingIntact,
      }
    : DEFAULT_STRATEGY_RULES;

  const spec: InstrumentSpec = instrument
    ? {
        symbol: instrument.symbol,
        displayName: instrument.displayName,
        contractSize: instrument.contractSize,
        tickSize: instrument.tickSize,
        tickValue: instrument.tickValue,
        pricePrecision: instrument.pricePrecision,
        minLot: instrument.minLot,
        maxLot: instrument.maxLot,
        lotStep: instrument.lotStep,
        quoteCurrency: instrument.quoteCurrency,
      }
    : XAUUSD_DEFAULT_SPEC;

  const providers = buildProviders({
    env: providerEnv(),
    account: account ? { balance: account.balance, currency: account.currency } : null,
    instrumentSpecs: { [spec.symbol]: spec },
    // Imported history keeps the whole application usable with no API keys.
    localSeries: async (symbol, timeframe, from, to, limit) => {
      const series = await prisma.marketDataSeries.findFirst({
        where: { symbol, timeframe, OR: [{ userId }, { userId: null }] },
        orderBy: { lastTime: 'desc' },
      });
      if (!series) return null;

      // If `from` is provided, query ascending starting from `from`.
      // If `to` is provided without `from`, query descending leading up to `to`.
      // If neither is provided, query descending to get the most recent bars.
      const isAscending = Boolean(from);

      const rows = await prisma.marketCandle.findMany({
        where: {
          seriesId: series.id,
          ...(from || to
            ? {
                time: {
                  ...(from ? { gte: new Date(from * 1000) } : {}),
                  ...(to ? { lte: new Date(to * 1000) } : {}),
                },
              }
            : {}),
        },
        orderBy: { time: isAscending ? 'asc' : 'desc' },
        take: limit ?? 1500,
      });

      return {
        candles: rowsToCandles(isAscending ? rows : rows.reverse()),
        importedFrom: series.importedFrom,
      };
    },
    manualEvents: async (from, to) => {
      const rows = await prisma.economicEvent.findMany({
        where: {
          time: { gte: new Date(from * 1000), lte: new Date(to * 1000) },
          OR: [{ userId }, { userId: null }],
        },
        orderBy: { time: 'asc' },
      });
      return rows.map(rowToEvent);
    },
  });

  return {
    userId,
    timezone: user.timezone || env.defaultTimezone,
    symbol: env.defaultSymbol,
    sessions,
    rules,
    instrument: spec,
    accountBalance: account?.balance ?? 0,
    accountCurrency: account?.currency ?? 'USD',
    providers,
    manualBlock: {
      active: settings?.manualBlockActive ?? false,
      reason: settings?.manualBlockReason ?? '',
    },
    strategyVersion: settings?.activeStrategyVersion ?? 'v1.0',
    settings: {
      defaultRiskPercent: settings?.defaultRiskPercent ?? 0.5,
      maxRiskPercent: settings?.maxRiskPercent ?? 1,
      aiAssistantEnabled: settings?.aiAssistantEnabled ?? true,
      aiBiasSuggestionEnabled: settings?.aiBiasSuggestionEnabled ?? true,
      browserNotifications: settings?.browserNotifications ?? false,
      telegramEnabled: settings?.telegramEnabled ?? false,
      emailAlertsEnabled: settings?.emailAlertsEnabled ?? false,
    },
  };
}

/** Candles for a timeframe, from the provider chain (live first, imported last, or preferLocal for Replay). */
export async function loadCandles(
  context: UserContext,
  timeframe: Timeframe,
  limit = 500,
  from?: number,
  to?: number,
  preferLocal = false,
) {
  if (preferLocal) {
    const localLoader = async (sym: string, tf: Timeframe, f?: number, t?: number, l?: number) => {
      const series = await prisma.marketDataSeries.findFirst({
        where: { symbol: sym, timeframe: tf, OR: [{ userId: context.userId }, { userId: null }] },
        orderBy: { lastTime: 'desc' },
      });
      if (!series) return null;

      const isAscending = Boolean(f);
      const rows = await prisma.marketCandle.findMany({
        where: {
          seriesId: series.id,
          ...(f || t
            ? {
                time: {
                  ...(f ? { gte: new Date(f * 1000) } : {}),
                  ...(t ? { lte: new Date(t * 1000) } : {}),
                },
              }
            : {}),
        },
        orderBy: { time: isAscending ? 'asc' : 'desc' },
        take: l ?? limit,
      });

      return {
        candles: rowsToCandles(isAscending ? rows : rows.reverse()),
        importedFrom: series.importedFrom,
      };
    };

    const localProvider = new LocalSeriesProvider(localLoader);
    return localProvider.getCandles({
      symbol: context.symbol,
      timeframe,
      limit,
      from,
      to,
    });
  }

  return context.providers.marketData.getCandles({
    symbol: context.symbol,
    timeframe,
    limit,
    from,
    to,
  });
}

/** The user's stored bias per timeframe for a given local date. */
export async function loadBias(
  userId: string,
  symbol: string,
  date: Date,
): Promise<Partial<Record<Timeframe, string>>> {
  const rows = await prisma.marketBias.findMany({
    where: { userId, symbol, date },
  });
  const map: Partial<Record<Timeframe, string>> = {};
  for (const row of rows) map[row.timeframe as Timeframe] = row.bias;
  return map;
}

export { toEpoch };

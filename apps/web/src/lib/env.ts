/**
 * Environment access.
 *
 * Secrets are read here and nowhere else, and never sent to the client. The
 * UI learns whether a provider is configured through a boolean, never the key.
 */

export const env = {
  databaseUrl: process.env.DATABASE_URL ?? '',
  authSecret: process.env.AUTH_SECRET ?? '',
  cookieSecure: process.env.AUTH_COOKIE_SECURE === 'true',
  defaultTimezone: process.env.DEFAULT_TIMEZONE || 'Africa/Casablanca',
  defaultSymbol: process.env.DEFAULT_SYMBOL || 'XAUUSD',
  uploadDir: process.env.UPLOAD_DIR || './uploads',

  marketDataProvider: process.env.MARKET_DATA_PROVIDER,
  marketDataApiKey: process.env.MARKET_DATA_API_KEY,
  oandaApiKey: process.env.OANDA_API_KEY,
  oandaAccountId: process.env.OANDA_ACCOUNT_ID,
  oandaEnvironment: process.env.OANDA_ENVIRONMENT,
  alphaVantageApiKey: process.env.ALPHA_VANTAGE_API_KEY,
  tradingEconomicsApiKey: process.env.TRADING_ECONOMICS_API_KEY,
  fredApiKey: process.env.FRED_API_KEY,

  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  aiModel: process.env.AI_MODEL || 'claude-opus-5',

  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
};

export function providerEnv() {
  return {
    MARKET_DATA_PROVIDER: env.marketDataProvider,
    MARKET_DATA_API_KEY: env.marketDataApiKey,
    TRADING_ECONOMICS_API_KEY: env.tradingEconomicsApiKey,
    FRED_API_KEY: env.fredApiKey,
    ALPHA_VANTAGE_API_KEY: env.alphaVantageApiKey,
    OANDA_API_KEY: env.oandaApiKey,
    OANDA_ACCOUNT_ID: env.oandaAccountId,
    OANDA_ENVIRONMENT: env.oandaEnvironment,
  };
}

/** Startup checks. Missing optional keys are informational, not failures. */
export function checkRequiredEnv(): string[] {
  const problems: string[] = [];
  if (!env.databaseUrl) problems.push('DATABASE_URL is not set.');
  if (!env.authSecret || env.authSecret.length < 32) {
    problems.push('AUTH_SECRET is missing or shorter than 32 characters.');
  }
  return problems;
}

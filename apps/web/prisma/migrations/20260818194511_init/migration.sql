-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Casablanca',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "defaultRiskPercent" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "maxRiskPercent" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "minDisplacementScore" INTEGER NOT NULL DEFAULT 60,
    "requireChoch" BOOLEAN NOT NULL DEFAULT false,
    "requireFvgAfterStructure" BOOLEAN NOT NULL DEFAULT true,
    "maxFvgMitigation" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
    "sensitivity" TEXT NOT NULL DEFAULT 'balanced',
    "enforceSessionFilter" BOOLEAN NOT NULL DEFAULT true,
    "newsFilterEnabled" BOOLEAN NOT NULL DEFAULT false,
    "newsWindowMinutes" INTEGER NOT NULL DEFAULT 30,
    "maxBarsFromStructureBreak" INTEGER NOT NULL DEFAULT 24,
    "manualBlockActive" BOOLEAN NOT NULL DEFAULT false,
    "manualBlockReason" TEXT NOT NULL DEFAULT '',
    "aiBiasSuggestionEnabled" BOOLEAN NOT NULL DEFAULT false,
    "aiAssistantEnabled" BOOLEAN NOT NULL DEFAULT true,
    "browserNotifications" BOOLEAN NOT NULL DEFAULT false,
    "telegramEnabled" BOOLEAN NOT NULL DEFAULT false,
    "telegramChatId" TEXT,
    "emailAlertsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "activeStrategyVersion" TEXT NOT NULL DEFAULT 'v1.0',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "broker" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "balance" DOUBLE PRECISION NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Instrument" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "contractSize" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "tickSize" DOUBLE PRECISION NOT NULL DEFAULT 0.01,
    "tickValue" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "pricePrecision" INTEGER NOT NULL DEFAULT 2,
    "minLot" DOUBLE PRECISION NOT NULL DEFAULT 0.01,
    "maxLot" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "lotStep" DOUBLE PRECISION NOT NULL DEFAULT 0.01,
    "quoteCurrency" TEXT NOT NULL DEFAULT 'USD',
    "brokerNote" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Instrument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketDataSeries" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "instrumentId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceTimezone" TEXT NOT NULL DEFAULT 'UTC',
    "importedFrom" TEXT,
    "firstTime" TIMESTAMP(3) NOT NULL,
    "lastTime" TIMESTAMP(3) NOT NULL,
    "barCount" INTEGER NOT NULL DEFAULT 0,
    "duplicatesRemoved" INTEGER NOT NULL DEFAULT 0,
    "gapCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketDataSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketCandle" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "open" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "close" DOUBLE PRECISION NOT NULL,
    "volume" DOUBLE PRECISION,
    "sourceTimestamp" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketCandle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradingSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    "days" INTEGER[],
    "tradingPermitted" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "color" TEXT NOT NULL DEFAULT '#22c55e',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EconomicEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "externalId" TEXT,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "importance" TEXT NOT NULL,
    "category" TEXT,
    "previous" DOUBLE PRECISION,
    "forecast" DOUBLE PRECISION,
    "actual" DOUBLE PRECISION,
    "unit" TEXT,
    "surprise" DOUBLE PRECISION,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "pointInTime" BOOLEAN NOT NULL DEFAULT false,
    "reference" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EconomicEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketBias" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL DEFAULT 'XAUUSD',
    "timeframe" TEXT NOT NULL,
    "bias" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'user',
    "rationale" TEXT NOT NULL DEFAULT '',
    "date" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketBias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiquidityLevel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL DEFAULT 'XAUUSD',
    "type" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "timeframe" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'intact',
    "createdTime" TIMESTAMP(3) NOT NULL,
    "eventTime" TIMESTAMP(3),
    "penetration" DOUBLE PRECISION,
    "manual" BOOLEAN NOT NULL DEFAULT true,
    "label" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiquidityLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FvgZone" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL DEFAULT 'XAUUSD',
    "direction" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "midpoint" DOUBLE PRECISION NOT NULL,
    "size" DOUBLE PRECISION NOT NULL,
    "relativeSize" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'fresh',
    "mitigation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdTime" TIMESTAMP(3) NOT NULL,
    "firstTouchTime" TIMESTAMP(3),
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "overlaps" TEXT[],
    "quality" INTEGER,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FvgZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StructureEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL DEFAULT 'XAUUSD',
    "kind" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "brokenLevel" DOUBLE PRECISION NOT NULL,
    "brokenSwingTime" TIMESTAMP(3) NOT NULL,
    "closePrice" DOUBLE PRECISION NOT NULL,
    "review" TEXT NOT NULL DEFAULT 'detected',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StructureEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyVersion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL DEFAULT 'XAUUSD',
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'forming',
    "session" TEXT NOT NULL DEFAULT '',
    "checklist" JSONB NOT NULL,
    "evaluation" JSONB,
    "missingConditions" TEXT[],
    "htfBias4h" TEXT NOT NULL DEFAULT 'neutral',
    "htfBias1h" TEXT NOT NULL DEFAULT 'neutral',
    "bias30m" TEXT NOT NULL DEFAULT 'neutral',
    "structure15m" TEXT NOT NULL DEFAULT 'neutral',
    "structure5m" TEXT NOT NULL DEFAULT 'neutral',
    "setupType" TEXT,
    "liquidityType" TEXT,
    "fvgTimeframe" TEXT,
    "fvgQuality" INTEGER,
    "displacementScore" INTEGER,
    "structureKind" TEXT,
    "entry" DOUBLE PRECISION,
    "stopLoss" DOUBLE PRECISION,
    "takeProfit1" DOUBLE PRECISION,
    "takeProfit2" DOUBLE PRECISION,
    "takeProfit3" DOUBLE PRECISION,
    "riskPercent" DOUBLE PRECISION,
    "lotSize" DOUBLE PRECISION,
    "sessionValid" BOOLEAN NOT NULL DEFAULT false,
    "newsPresent" BOOLEAN NOT NULL DEFAULT false,
    "newsNote" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "strategyVersionId" TEXT,

    CONSTRAINT "Setup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT,
    "instrumentId" TEXT,
    "setupId" TEXT,
    "symbol" TEXT NOT NULL DEFAULT 'XAUUSD',
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "session" TEXT NOT NULL DEFAULT '',
    "entry" DOUBLE PRECISION NOT NULL,
    "initialStop" DOUBLE PRECISION NOT NULL,
    "currentStop" DOUBLE PRECISION NOT NULL,
    "takeProfit1" DOUBLE PRECISION,
    "takeProfit2" DOUBLE PRECISION,
    "takeProfit3" DOUBLE PRECISION,
    "riskPercent" DOUBLE PRECISION NOT NULL,
    "riskAmount" DOUBLE PRECISION NOT NULL,
    "lotSize" DOUBLE PRECISION NOT NULL,
    "remainingLots" DOUBLE PRECISION NOT NULL,
    "realisedPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "resultR" DOUBLE PRECISION,
    "resultCurrency" DOUBLE PRECISION,
    "maeR" DOUBLE PRECISION,
    "mfeR" DOUBLE PRECISION,
    "htfBias" TEXT NOT NULL DEFAULT '',
    "setupType" TEXT,
    "liquidityType" TEXT,
    "fvgTimeframe" TEXT,
    "fvgQuality" INTEGER,
    "sweepPresent" BOOLEAN NOT NULL DEFAULT false,
    "displacementScore" INTEGER,
    "structureKind" TEXT,
    "entryModel" TEXT,
    "managementModel" TEXT NOT NULL DEFAULT 'A',
    "newsPresent" BOOLEAN NOT NULL DEFAULT false,
    "grade" TEXT,
    "ruleViolation" BOOLEAN NOT NULL DEFAULT false,
    "strategyVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeExecution" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "lots" DOUBLE PRECISION NOT NULL,
    "percent" DOUBLE PRECISION NOT NULL,
    "pnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "TradeExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradeManagementEvent" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "price" DOUBLE PRECISION,
    "percent" DOUBLE PRECISION,
    "newStop" DOUBLE PRECISION,
    "realisedPnl" DOUBLE PRECISION,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "TradeManagementEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "emotion" TEXT NOT NULL DEFAULT '',
    "mistake" TEXT NOT NULL DEFAULT '',
    "lesson" TEXT NOT NULL DEFAULT '',
    "confidence" INTEGER,
    "ruleViolation" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "grade" TEXT,
    "processNote" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Screenshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tradeId" TEXT,
    "phase" TEXT NOT NULL DEFAULT 'before',
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "analysis" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Screenshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissedSetup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "setupId" TEXT,
    "time" TIMESTAMP(3) NOT NULL,
    "symbol" TEXT NOT NULL DEFAULT 'XAUUSD',
    "direction" TEXT NOT NULL,
    "session" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL,
    "hypotheticalR" DOUBLE PRECISION,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MissedSetup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "symbol" TEXT NOT NULL DEFAULT 'XAUUSD',
    "bias4h" TEXT NOT NULL DEFAULT 'neutral',
    "bias1h" TEXT NOT NULL DEFAULT 'neutral',
    "bias30m" TEXT NOT NULL DEFAULT 'neutral',
    "keyLevels" JSONB,
    "htfFvgs" JSONB,
    "liquidityNotes" TEXT NOT NULL DEFAULT '',
    "majorNews" JSONB,
    "expectedVolatility" TEXT NOT NULL DEFAULT '',
    "londonPlan" TEXT NOT NULL DEFAULT '',
    "newYorkPlan" TEXT NOT NULL DEFAULT '',
    "noTradeConditions" TEXT NOT NULL DEFAULT '',
    "duringSessionNotes" TEXT NOT NULL DEFAULT '',
    "afterSessionNotes" TEXT NOT NULL DEFAULT '',
    "lessons" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyReview" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "statistics" JSONB NOT NULL,
    "recommendations" TEXT[],
    "biggestMistake" TEXT NOT NULL DEFAULT '',
    "bestDecision" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "ruleAdherence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacktestRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL DEFAULT 'XAUUSD',
    "timeframe" TEXT NOT NULL DEFAULT '5M',
    "from" TIMESTAMP(3) NOT NULL,
    "to" TIMESTAMP(3) NOT NULL,
    "entryModel" TEXT NOT NULL,
    "managementModel" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "statistics" JSONB,
    "tradeCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "dataProvider" TEXT NOT NULL DEFAULT 'local',
    "notes" TEXT NOT NULL DEFAULT '',
    "strategyVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BacktestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacktestTrade" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "entryTime" TIMESTAMP(3) NOT NULL,
    "exitTime" TIMESTAMP(3),
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "exitPrice" DOUBLE PRECISION,
    "stopLoss" DOUBLE PRECISION NOT NULL,
    "takeProfit1" DOUBLE PRECISION,
    "takeProfit2" DOUBLE PRECISION,
    "takeProfit3" DOUBLE PRECISION,
    "lotSize" DOUBLE PRECISION NOT NULL,
    "resultR" DOUBLE PRECISION NOT NULL,
    "resultCurrency" DOUBLE PRECISION NOT NULL,
    "maeR" DOUBLE PRECISION NOT NULL,
    "mfeR" DOUBLE PRECISION NOT NULL,
    "session" TEXT NOT NULL DEFAULT '',
    "entryModel" TEXT NOT NULL,
    "managementModel" TEXT NOT NULL,
    "fvgTimeframe" TEXT,
    "liquidityContext" TEXT,
    "structureKind" TEXT,
    "displacementScore" INTEGER,
    "newsPresent" BOOLEAN NOT NULL DEFAULT false,
    "dayOfWeek" INTEGER,
    "hourOfDay" INTEGER,
    "fills" JSONB NOT NULL,

    CONSTRAINT "BacktestTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyExperiment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'entry',
    "question" TEXT NOT NULL DEFAULT '',
    "config" JSONB NOT NULL,
    "summary" JSONB,
    "caveat" TEXT NOT NULL DEFAULT '',
    "strategyVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StrategyExperiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StrategyExperimentCell" (
    "id" TEXT NOT NULL,
    "experimentId" TEXT NOT NULL,
    "runId" TEXT,
    "entryModel" TEXT NOT NULL,
    "managementModel" TEXT NOT NULL,
    "statistics" JSONB NOT NULL,
    "tradeCount" INTEGER NOT NULL DEFAULT 0,
    "runnerSurvivalRate" DOUBLE PRECISION,

    CONSTRAINT "StrategyExperimentCell_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "symbol" TEXT NOT NULL DEFAULT 'XAUUSD',
    "config" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "oneShot" BOOLEAN NOT NULL DEFAULT true,
    "channels" TEXT[] DEFAULT ARRAY['in-app']::TEXT[],
    "lastTriggeredAt" TIMESTAMP(3),
    "triggerCount" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertNotification" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "channel" TEXT NOT NULL DEFAULT 'in-app',

    CONSTRAINT "AlertNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_SetupLiquidity" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_SetupLiquidity_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_SetupFvg" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_SetupFvg_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Instrument_symbol_key" ON "Instrument"("symbol");

-- CreateIndex
CREATE INDEX "MarketDataSeries_userId_idx" ON "MarketDataSeries"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketDataSeries_symbol_timeframe_provider_userId_key" ON "MarketDataSeries"("symbol", "timeframe", "provider", "userId");

-- CreateIndex
CREATE INDEX "MarketCandle_seriesId_time_idx" ON "MarketCandle"("seriesId", "time");

-- CreateIndex
CREATE UNIQUE INDEX "MarketCandle_seriesId_time_key" ON "MarketCandle"("seriesId", "time");

-- CreateIndex
CREATE INDEX "TradingSession_userId_idx" ON "TradingSession"("userId");

-- CreateIndex
CREATE INDEX "EconomicEvent_time_idx" ON "EconomicEvent"("time");

-- CreateIndex
CREATE INDEX "EconomicEvent_userId_time_idx" ON "EconomicEvent"("userId", "time");

-- CreateIndex
CREATE UNIQUE INDEX "EconomicEvent_externalId_source_key" ON "EconomicEvent"("externalId", "source");

-- CreateIndex
CREATE INDEX "MarketBias_userId_date_idx" ON "MarketBias"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "MarketBias_userId_symbol_timeframe_date_key" ON "MarketBias"("userId", "symbol", "timeframe", "date");

-- CreateIndex
CREATE INDEX "LiquidityLevel_userId_symbol_status_idx" ON "LiquidityLevel"("userId", "symbol", "status");

-- CreateIndex
CREATE INDEX "FvgZone_userId_symbol_status_idx" ON "FvgZone"("userId", "symbol", "status");

-- CreateIndex
CREATE INDEX "StructureEvent_userId_symbol_time_idx" ON "StructureEvent"("userId", "symbol", "time");

-- CreateIndex
CREATE INDEX "StrategyVersion_userId_idx" ON "StrategyVersion"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StrategyVersion_userId_version_key" ON "StrategyVersion"("userId", "version");

-- CreateIndex
CREATE INDEX "Setup_userId_createdAt_idx" ON "Setup"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Trade_setupId_key" ON "Trade"("setupId");

-- CreateIndex
CREATE INDEX "Trade_userId_openedAt_idx" ON "Trade"("userId", "openedAt");

-- CreateIndex
CREATE INDEX "Trade_userId_status_idx" ON "Trade"("userId", "status");

-- CreateIndex
CREATE INDEX "TradeExecution_tradeId_idx" ON "TradeExecution"("tradeId");

-- CreateIndex
CREATE INDEX "TradeManagementEvent_tradeId_idx" ON "TradeManagementEvent"("tradeId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_tradeId_key" ON "JournalEntry"("tradeId");

-- CreateIndex
CREATE INDEX "JournalEntry_userId_idx" ON "JournalEntry"("userId");

-- CreateIndex
CREATE INDEX "Screenshot_userId_idx" ON "Screenshot"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MissedSetup_setupId_key" ON "MissedSetup"("setupId");

-- CreateIndex
CREATE INDEX "MissedSetup_userId_time_idx" ON "MissedSetup"("userId", "time");

-- CreateIndex
CREATE INDEX "DailyPlan_userId_date_idx" ON "DailyPlan"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyPlan_userId_date_symbol_key" ON "DailyPlan"("userId", "date", "symbol");

-- CreateIndex
CREATE INDEX "WeeklyReview_userId_idx" ON "WeeklyReview"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyReview_userId_weekStart_key" ON "WeeklyReview"("userId", "weekStart");

-- CreateIndex
CREATE INDEX "BacktestRun_userId_createdAt_idx" ON "BacktestRun"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "BacktestTrade_runId_idx" ON "BacktestTrade"("runId");

-- CreateIndex
CREATE INDEX "StrategyExperiment_userId_idx" ON "StrategyExperiment"("userId");

-- CreateIndex
CREATE INDEX "StrategyExperimentCell_experimentId_idx" ON "StrategyExperimentCell"("experimentId");

-- CreateIndex
CREATE INDEX "Alert_userId_enabled_idx" ON "Alert"("userId", "enabled");

-- CreateIndex
CREATE INDEX "AlertNotification_alertId_read_idx" ON "AlertNotification"("alertId", "read");

-- CreateIndex
CREATE INDEX "_SetupLiquidity_B_index" ON "_SetupLiquidity"("B");

-- CreateIndex
CREATE INDEX "_SetupFvg_B_index" ON "_SetupFvg"("B");

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketDataSeries" ADD CONSTRAINT "MarketDataSeries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketDataSeries" ADD CONSTRAINT "MarketDataSeries_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketCandle" ADD CONSTRAINT "MarketCandle_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "MarketDataSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingSession" ADD CONSTRAINT "TradingSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EconomicEvent" ADD CONSTRAINT "EconomicEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketBias" ADD CONSTRAINT "MarketBias_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiquidityLevel" ADD CONSTRAINT "LiquidityLevel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FvgZone" ADD CONSTRAINT "FvgZone_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StructureEvent" ADD CONSTRAINT "StructureEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyVersion" ADD CONSTRAINT "StrategyVersion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Setup" ADD CONSTRAINT "Setup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Setup" ADD CONSTRAINT "Setup_strategyVersionId_fkey" FOREIGN KEY ("strategyVersionId") REFERENCES "StrategyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_setupId_fkey" FOREIGN KEY ("setupId") REFERENCES "Setup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_strategyVersionId_fkey" FOREIGN KEY ("strategyVersionId") REFERENCES "StrategyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeExecution" ADD CONSTRAINT "TradeExecution_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradeManagementEvent" ADD CONSTRAINT "TradeManagementEvent_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Screenshot" ADD CONSTRAINT "Screenshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Screenshot" ADD CONSTRAINT "Screenshot_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissedSetup" ADD CONSTRAINT "MissedSetup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissedSetup" ADD CONSTRAINT "MissedSetup_setupId_fkey" FOREIGN KEY ("setupId") REFERENCES "Setup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPlan" ADD CONSTRAINT "DailyPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReview" ADD CONSTRAINT "WeeklyReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacktestRun" ADD CONSTRAINT "BacktestRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacktestRun" ADD CONSTRAINT "BacktestRun_strategyVersionId_fkey" FOREIGN KEY ("strategyVersionId") REFERENCES "StrategyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacktestTrade" ADD CONSTRAINT "BacktestTrade_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BacktestRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyExperiment" ADD CONSTRAINT "StrategyExperiment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyExperiment" ADD CONSTRAINT "StrategyExperiment_strategyVersionId_fkey" FOREIGN KEY ("strategyVersionId") REFERENCES "StrategyVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyExperimentCell" ADD CONSTRAINT "StrategyExperimentCell_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "StrategyExperiment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StrategyExperimentCell" ADD CONSTRAINT "StrategyExperimentCell_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BacktestRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertNotification" ADD CONSTRAINT "AlertNotification_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SetupLiquidity" ADD CONSTRAINT "_SetupLiquidity_A_fkey" FOREIGN KEY ("A") REFERENCES "LiquidityLevel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SetupLiquidity" ADD CONSTRAINT "_SetupLiquidity_B_fkey" FOREIGN KEY ("B") REFERENCES "Setup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SetupFvg" ADD CONSTRAINT "_SetupFvg_A_fkey" FOREIGN KEY ("A") REFERENCES "FvgZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_SetupFvg" ADD CONSTRAINT "_SetupFvg_B_fkey" FOREIGN KEY ("B") REFERENCES "Setup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

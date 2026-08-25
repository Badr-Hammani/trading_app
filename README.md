# XAUUSD Command Center

A personal daily trading command center for **XAUUSD / Gold**, built around one
discretionary liquidity and market-structure model.

It is an **analysis, planning, journaling, replay and risk-management tool**.
It is not a trading bot, it does not place orders, and it is not financial
advice. There is no order-execution code anywhere in version 1 — the broker
interface deliberately has no method that can open a position.

The design goal is uncomfortable but explicit: **the app should help you take
fewer, better trades — not more of them.**

---

## The model it is built around

```
HTF context → liquidity event → displacement → structure break
   → fresh FVG → retracement → confirmation → execution → management → journal
```

These are seven distinct stages and the application keeps them distinct. The
single most important consequence:

> **An FVG is a LOCATION, not an entry.**

Price reaching a fair value gap satisfies stage 6. It never satisfies stage 7,
and no screen in the app presents "price touched an FVG" as a reason to trade.

Everything else follows from that. A liquidity level is only marked *swept*
when price penetrates it meaningfully **and closes back through** — a wick is
not a sweep, and a close beyond that holds is a *break*, which is a different
thing. Displacement is scored 0–100 from body expansion, range expansion, close
location, consecutive candles, structure break and FVG creation, because "green
candle" is not displacement. A violated FVG is dead permanently: if a later
candle prints a new gap over the same prices, that is a **new zone with its own
identity**, and the old one stays on the chart, faded, forever.

---

## What it does

| Area | What you get |
|---|---|
| **Dashboard** | Price, bid/ask, spread, session, countdowns, market status, news countdown, trade-allowed status; bias per timeframe; chart; liquidity, FVG, checklist and risk side by side |
| **Charts** | Candles, volume, 1M–D, crosshair, zoom, pan, FVG zones, liquidity lines, session overlays, entry/SL/TP projection with R:R shading, click-to-mark levels |
| **Session engine** | Fully configurable sessions, each in **its own IANA timezone**, so DST is handled by the timezone database rather than by fixed offsets |
| **Liquidity map** | PDH/PDL, PWH/PWL, Asian and London extremes, equal highs/lows, swings, internal/external, with strict sweep classification |
| **FVG manager** | Detection, mitigation tracking, four statuses, quality scoring, stacked overlapping zones, no revival of dead zones |
| **Structure engine** | Swings with conservative/balanced/sensitive presets, BOS/CHoCH, HH-HL-LH-LL, major vs internal, each event confirmable or rejectable by you |
| **Setup builder** | The 15-item mandatory checklist. Ticking it all shows SETUP QUALIFIED — and does nothing else |
| **Risk calculator** | Position sizing from **your broker's contract spec**, with every arithmetic step shown |
| **Trade management** | Partials, stop moves, breakeven, runners; live R, unrealised P/L, distance to stop and target; four comparable management models |
| **Journal** | Every field from the spec, before/after screenshots, and grading that measures **process, not outcome** |
| **Replay** | Play/pause, 1 and 5 candle steps, six speeds, scrubber, date jump — and no way for the UI or the engines to see past the cursor |
| **Backtesting** | Same engines as live, pessimistic fills, full statistics, exportable |
| **Strategy Lab** | Every entry model × every management model over identical candles |
| **Analytics** | 20+ metrics plus ten breakdowns, news-impact analysis, missed-vs-taken comparison |
| **Daily plan** | Before / during / after, with the "after" half assembled from the record |
| **Weekly review** | At most **three** recommendations, ranked by what is costing you most |
| **Missed trades** | Log what you skipped and why, then find out whether the filters actually help |
| **Calendar** | Gold-relevant events, countdowns, surprise, point-in-time history for backtests |
| **Macro panel** | DXY, 2Y/10Y, real yields, Fed funds, CPI, PCE, NFP, unemployment, VIX, silver, oil, S&P, Nasdaq, with rolling correlations |
| **AI mentor** | Optional. Evidence-structured analysis with directives and certainty claims stripped in code |
| **Telegram** | Optional, read-only bot: `/status /gold /calendar /setup /risk /journal /today /week` |

---

## Free-first: it works with no API keys at all

This is a hard requirement, not a nice-to-have. With an **empty `.env`** beyond
the database URL and auth secret, you still get:

- charts and replay on imported CSV history
- manual liquidity levels and FVG zones
- the full strategy engine, structure detection and displacement scoring
- the setup checklist and the risk calculator
- the journal, screenshots and grading
- backtesting, the Strategy Lab and every statistic
- manually entered economic events, with the same countdown and news filter
- CSV / JSON export of everything

API keys add live quotes, an automatic calendar and macro series **on top**. If
a provider is missing or fails, the UI shows **DATA UNAVAILABLE with the actual
reason** — never a blank, never a stale price presented as current, and never
an invented number.

---

## Quick start

### One command

**Windows**

```powershell
.\start.ps1
```

**macOS / Linux**

```bash
./start.sh
```

That is the whole thing. The launcher creates `.env` if it is missing,
generates `AUTH_SECRET` if it is blank, brings the stack up, waits for it to
answer, and opens <http://localhost:3000>. Safe to re-run — it never overwrites
an existing secret, and your database lives in a Docker volume that survives
rebuilds.

| Command | Does |
|---|---|
| `.\start.ps1` / `./start.sh` | Start (or restart) everything |
| `-Stop` / `stop` | Stop the stack, keep the data |
| `-Logs` / `logs` | Follow the web logs |
| `-Rebuild` / `rebuild` | Force a clean image rebuild |
| `-Reset` / `reset` | **Destroy** the database and start fresh |

The first run builds the image and takes a few minutes; later runs take
seconds. The first visit offers account creation; after that it is sign-in
only. Migrations run automatically on container start.

If Docker is not running the script says so and stops, rather than failing
somewhere less obvious.

### Bringing an existing database with you

`docker compose` creates a **new, empty** PostgreSQL volume. It does not read a
PostgreSQL server already installed on the host — different server, different
data directory. Start the stack after moving machines and the app comes up
working but empty: no candles, no trades, no journal.

If you have a dump from the old machine, restore it **before** the first start:

```powershell
.\restore-db.ps1                                        # looks in Desktop\PC-MIGRATION\database
.\restore-db.ps1 -DumpPath "C:\path\to\your.dump"      # or point at it
.\restore-db.ps1 -DumpPath "C:\path\to\your.sql" -Sql  # plain SQL instead of pg_dump -F c
```

It brings up only the database, restores, then counts rows in `MarketCandle`,
`Trade` and the rest so you can see the data actually landed rather than
trusting an exit code. Then run `.\start.ps1` as usual and sign in with the
account from the old machine — it comes across with the data.

To take a dump from a running stack:

```powershell
docker compose exec db pg_dump -U xau -F c xau_command_center > backup.dump
```

### Or by hand

```bash
cp .env.example .env
# Put a secret in AUTH_SECRET:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

docker compose up --build
```

### Local development

Requires Node 20+ and a PostgreSQL 14+ database.

```bash
npm install
cp .env.example .env          # set DATABASE_URL and AUTH_SECRET

npm run build:libs            # compile @xau/core and @xau/providers
npm run db:migrate            # create the schema
npm run db:seed               # instrument definition only — no demo data

npm run dev                   # http://localhost:3000
```

**On Windows**: everything above works in PowerShell as-is. The only Windows
note is `AUTH_SECRET` — use the `node -e` command above rather than shell
substitution. If you would rather not install PostgreSQL locally, run just the
database from compose and point `DATABASE_URL` at `localhost:5432`:

```powershell
docker compose up db -d
npm run db:migrate
npm run dev
```

### Useful scripts

| Command | What it does |
|---|---|
| `npm test` | Run the unit test suites |
| `npm run typecheck` | Typecheck all three packages |
| `npm run build` | Build libraries and the web app |
| `npm run db:migrate` | Apply migrations in development |
| `npm run db:studio` | Browse the database |

---

## Getting data in

The application ships with **no market data** and creates none. Two ways to
fill it:

**1. Import CSV** (no key needed) — Settings → Data. Any OHLCV export works;
columns are auto-detected from common header names (`time/date/datetime`,
`open/o`, `high/h`, `low/l`, `close/c/last`, `volume/vol/tickvol`), delimiters
are sniffed, and timestamps are converted from whatever timezone you state.

The import reports what it found rather than hiding it: duplicate bars removed
(later revision kept), missing bars per gap, unparseable rows, and bars whose
high/low do not bracket the body. **Gaps are reported, never filled** — an
invented candle is worse than a visible hole.

**2. Configure a provider** — set `OANDA_API_KEY` + `OANDA_ACCOUNT_ID` for live
data with a genuine bid/ask (the only configured source that can show a real
spread), or `ALPHA_VANTAGE_API_KEY` as an alternative. Imported history stays
in the chain as a fallback.

---

## Where to get the API keys, and what they cost

Checked August 2026. All of them are optional.

| Key | Where | Cost | Worth it? |
|---|---|---|---|
| `FRED_API_KEY` | [fred.stlouisfed.org/docs/api/api_key.html](https://fred.stlouisfed.org/docs/api/api_key.html) | **Free**, no paid tier. 120 req/min | **Get this one.** Powers the entire macro panel |
| `OANDA_API_KEY` + `OANDA_ACCOUNT_ID` | fxTrade portal → My Services → Manage API Access ([docs](https://developer.oanda.com/rest-live-v20/introduction/)) | **Free** with a practice account | **Get this one.** The only source with a real bid/ask |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) | Pay-per-use, no subscription | Only if you want the AI mentor |
| `ALPHA_VANTAGE_API_KEY` | [alphavantage.co/support/#api-key](https://www.alphavantage.co/support/#api-key) | Free tier ~25 requests **per day**; paid from ~$50/mo | Skip unless OANDA is unavailable to you |
| `TRADING_ECONOMICS_API_KEY` | [developer.tradingeconomics.com](https://developer.tradingeconomics.com) | Paid (~$149/mo and up); trial capped at ~100 requests | Skip. Enter events by hand instead |
| Telegram bot token | [@BotFather](https://t.me/BotFather) in Telegram | Free | Only if you want phone notifications |

The free path — FRED plus an OANDA practice account, with CSV history imported
for backtesting — gives you live gold prices with a real spread, the full macro
panel, and every offline feature, at no cost.

The economic calendar is the one gap: Trading Economics is genuinely expensive
for personal use. Entering the dozen events a month that matter for gold by hand
takes a couple of minutes and drives the same countdown, warning band and news
filter as the API would.

---

## Architecture

```
packages/core/          Pure domain logic. No UI, no database, no network.
  time/                 Timezone-aware clock helpers
  sessions/             Session engine, market hours
  indicators/           ATR, swings, structure, FVG, displacement, liquidity
  strategy-engine/      evaluateSetup(), checklist, entry models, news risk
  risk-engine/          Position sizing from contract specs
  journal/              Management models, grading, weekly review
  backtest-engine/      Replay controller, simulator, experiment matrix
  analytics/            Statistics and breakdowns
  io/                   CSV import/export and data-quality reporting
  ai/                   Guardrails and prompts

packages/providers/     Replaceable data sources behind four interfaces
  market/               OANDA, Alpha Vantage, imported history, null
  economic/             Trading Economics, FRED, manual, merged, null
  news/  broker/        Read-only. No execution surface exists.

apps/web/               Next.js App Router
  prisma/               PostgreSQL schema and migrations
  src/lib/              DB, auth, context, analysis pipeline, AI, Telegram
  src/app/api/          30 routes
  src/app/(app)/        13 pages
  src/components/       Chart engine and panels
```

**The strategy engine is independent of the UI.** `evaluateSetup()` takes market
observations and returns structured data:

```ts
{
  direction, bias, htfAligned, stages,
  liquiditySweep, displacement, structureBreak, fvg, retracement,
  sessionValid, sessionName, newsRisk,
  setupStatus, missingConditions, summary
}
```

The UI renders that. It never re-derives trading logic of its own, which is why
the dashboard, the Telegram bot, the replay engine and the AI mentor all
describe exactly the same market.

### Setup status

The status distinguishes the case the whole session filter exists for:

| Status | Meaning |
|---|---|
| `no_setup` | Nothing in the model has begun |
| `forming` | Some stages met, sequence incomplete |
| `valid_out_of_session` | **Technically valid, but outside your execution window** |
| `caution` | Conditions met, high-impact event nearby |
| `qualified` | Every mandatory condition met — the decision is still yours |
| `blocked` | A manual block or the news filter is active |

A valid setup outside London or New York is shown as exactly that, and pushed
toward the missed-trade tracker rather than toward execution.

---

## Design decisions worth knowing

**Bias is yours.** The engine reads your bias per timeframe; it never writes it.
Its own structural reading is shown separately, labelled as a suggestion, and
applying it takes an explicit click that is off by default.

**Grades measure process.** A losing A+ is a good trade. A winning RULE BREAK is
a bad trade. The grading function never reads P/L — the journal shows the
combination in words so the wrong lesson is harder to learn.

**Backtests are pessimistic.** When a bar contains both the stop and a target,
the stop is taken. One position at a time. R is weighted across every partial
so a scaled-out trade reports what actually happened.

**Point-in-time news.** A backtest reads only calendar rows captured as they
were published. If none exist for the window, the run proceeds **without news
context and says so** rather than quietly using today's revised figures.

**Strategy versions are immutable.** Editing rules creates a new version; every
trade keeps the version it was taken under. Historical results are never
silently recomputed under rules that did not exist at the time.

**Correlations are observations.** Nothing in the macro panel encodes "DXY up
therefore gold down". It reports direction and rolling correlation and leaves
the reading to you — including when the usual relationship is not holding.

**AI guardrails are code.** The prompt asks the assistant not to issue
directives; a filter then strips them regardless. "Buy now", "guaranteed",
"will definitely" and equivalents cannot reach the screen.

---

## Testing

```bash
npm test
```

103 tests. The strategy calculations are tested against **known candles with
expected results** — including the rules that are easy to get wrong:

- a bullish FVG is the gap between candle 1's high and candle 3's low
- partial vs full mitigation vs invalidation-on-close
- **a violated zone is never revived by a new gap over the same prices**
- overlapping zones stack rather than replacing each other
- a shallow wick through a level is *not* a sweep; a close beyond that holds is a break
- BOS vs CHoCH ordering, and close-required vs wick-permitted breaks
- London opens at its **local** open in both winter and summer
- position size rounds **down** to the lot step, so realised risk never exceeds intended
- a valid setup outside the session reports `valid_out_of_session`, not `qualified`
- the replay session cannot return a candle beyond its cursor
- a trade that stops out cannot be worse than −1R

---

## Safety

- This is an analysis tool. It is not guaranteed to predict anything.
- Backtested and replayed results measure one past sample under simplified
  assumptions. They are not a guarantee of future performance.
- AI analysis can be wrong.
- Market data may be delayed or incomplete depending on the provider.
- **No autonomous order execution.** Broker execution is out of scope for
  version 1 and would have to arrive as a separate, isolated module.
- Confirm the instrument contract specification against your own broker before
  trusting any position size.

---

## Roadmap

Version 1 covers the complete workflow end to end. Natural next steps, in the
order they would pay off:

1. **More data in the Strategy Lab.** The lab is only as good as the history
   behind it; the entry-model question needs a few hundred trades per variant.
2. **Point-in-time calendar capture** on a schedule, so backtests gain real news
   context over time.
3. **Alert delivery** beyond in-app polling — browser push and the Telegram
   channel are wired but need a background scheduler.
4. **Multi-instrument support.** The schema already carries `symbol` throughout.
5. **Broker execution**, if ever, as an isolated module behind an explicit
   opt-in — never by widening the existing provider interface.

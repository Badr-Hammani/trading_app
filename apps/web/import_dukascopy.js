import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { parseOhlcvCsv, XAUUSD_DEFAULT_SPEC } from '@xau/core';

const prisma = new PrismaClient();

const DATA_DIR = 'C:\\XAUUSD-Data';
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: 'badrhammani2017@gmail.com' },
  });

  if (!user) {
    console.error('User badrhammani2017@gmail.com not found!');
    process.exit(1);
  }

  const userId = user.id;
  const symbol = 'XAUUSD';

  // 1. Download slices year-by-year from 2024 to 2026 for M5 and M15
  const ranges = [
    { from: '2024-01-01', to: '2024-12-31' },
    { from: '2025-01-01', to: '2025-12-31' },
    { from: '2026-01-01', to: '2026-08-25' },
  ];

  const timeframes = ['m5', 'm15'];

  console.log('====================================================');
  console.log('1. STEP 1: DOWNLOADING DUKASCOPY XAUUSD CSV DATA');
  console.log('====================================================');

  for (const tf of timeframes) {
    for (const range of ranges) {
      console.log(`Downloading ${symbol} ${tf.toUpperCase()} (${range.from} -> ${range.to})...`);
      const cmd = `npx dukascopy-node -i xauusd -from ${range.from} -to ${range.to} -t ${tf} -f csv -v -dir "${DATA_DIR}"`;
      try {
        execSync(cmd, { stdio: 'inherit' });
      } catch (err) {
        console.error(`Error downloading ${tf} ${range.from}:`, err.message);
      }
    }
  }

  console.log('\n====================================================');
  console.log('2. STEP 2: IMPORTING CSV FILES INTO POSTGRESQL');
  console.log('====================================================');

  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.csv'));
  console.log(`Found ${files.length} CSV files in ${DATA_DIR}`);

  const instrument = await prisma.instrument.upsert({
    where: { symbol },
    update: {},
    create: {
      symbol,
      displayName: XAUUSD_DEFAULT_SPEC.displayName,
      contractSize: XAUUSD_DEFAULT_SPEC.contractSize,
      tickSize: XAUUSD_DEFAULT_SPEC.tickSize,
      tickValue: XAUUSD_DEFAULT_SPEC.tickValue,
      brokerNote: 'Dukascopy Historical Ingest',
    },
  });

  for (const filename of files) {
    const filePath = path.join(DATA_DIR, filename);
    const tfMatch = filename.match(/-(m5|m15)-/i);
    if (!tfMatch) continue;
    const timeframe = tfMatch[1].toUpperCase() === 'M5' ? '5M' : '15M';

    console.log(`\nImporting file: ${filename} (Timeframe: ${timeframe})...`);
    const text = fs.readFileSync(filePath, 'utf-8');

    const { candles, report } = parseOhlcvCsv(text, {
      timezone: 'UTC',
      timeframe,
    });

    if (candles.length === 0) {
      console.log(`Skipping ${filename}: no usable rows found.`);
      continue;
    }

    const series = await prisma.marketDataSeries.upsert({
      where: {
        symbol_timeframe_provider_userId: { symbol, timeframe, provider: 'csv', userId },
      },
      update: {
        importedFrom: filename,
        sourceTimezone: 'UTC',
        firstTime: new Date(candles[0].time * 1000),
        lastTime: new Date(candles[candles.length - 1].time * 1000),
        duplicatesRemoved: report.duplicatesRemoved,
        gapCount: report.gaps.length,
      },
      create: {
        userId,
        instrumentId: instrument.id,
        symbol,
        timeframe,
        provider: 'csv',
        sourceTimezone: 'UTC',
        importedFrom: filename,
        firstTime: new Date(candles[0].time * 1000),
        lastTime: new Date(candles[candles.length - 1].time * 1000),
        duplicatesRemoved: report.duplicatesRemoved,
        gapCount: report.gaps.length,
      },
    });

    console.log(`Parsed ${candles.length} candles. Inserting into database in high-speed batches...`);

    const receivedAt = new Date();
    const batchSize = 1000;
    let inserted = 0;

    for (let start = 0; start < candles.length; start += batchSize) {
      const batch = candles.slice(start, start + batchSize);
      await prisma.$transaction(
        batch.map((candle) =>
          prisma.marketCandle.upsert({
            where: { seriesId_time: { seriesId: series.id, time: new Date(candle.time * 1000) } },
            update: {
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              volume: candle.volume,
              receivedAt,
            },
            create: {
              seriesId: series.id,
              time: new Date(candle.time * 1000),
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              volume: candle.volume,
              sourceTimestamp: new Date(candle.time * 1000),
              receivedAt,
            },
          }),
        ),
      );
      inserted += batch.length;
      if (inserted % 10000 === 0 || inserted === candles.length) {
        console.log(`Progress: ${inserted} / ${candles.length} bars inserted...`);
      }
    }

    const barCount = await prisma.marketCandle.count({ where: { seriesId: series.id } });
    await prisma.marketDataSeries.update({ where: { id: series.id }, data: { barCount } });
    console.log(`✅ Successfully stored ${barCount} total ${timeframe} candles in database.`);
  }

  console.log('\n====================================================');
  console.log('3. ALL DUKASCOPY DATA SUCCESSFULLY IMPORTED!');
  console.log('====================================================');
}

main()
  .catch((e) => {
    console.error('Import failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

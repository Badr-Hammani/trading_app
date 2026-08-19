import { PrismaClient } from '@prisma/client';
import { XAUUSD_DEFAULT_SPEC } from '@xau/core';

/**
 * Seed.
 *
 * Deliberately minimal: it creates the XAUUSD instrument definition and
 * nothing else. No fake trades, no invented prices, no demo account — the
 * application must never show a number it did not really get.
 */
const prisma = new PrismaClient();

async function main(): Promise<void> {
  const instrument = await prisma.instrument.upsert({
    where: { symbol: XAUUSD_DEFAULT_SPEC.symbol },
    update: {},
    create: {
      symbol: XAUUSD_DEFAULT_SPEC.symbol,
      displayName: XAUUSD_DEFAULT_SPEC.displayName,
      contractSize: XAUUSD_DEFAULT_SPEC.contractSize,
      tickSize: XAUUSD_DEFAULT_SPEC.tickSize,
      tickValue: XAUUSD_DEFAULT_SPEC.tickValue,
      pricePrecision: XAUUSD_DEFAULT_SPEC.pricePrecision,
      minLot: XAUUSD_DEFAULT_SPEC.minLot,
      maxLot: XAUUSD_DEFAULT_SPEC.maxLot,
      lotStep: XAUUSD_DEFAULT_SPEC.lotStep,
      quoteCurrency: XAUUSD_DEFAULT_SPEC.quoteCurrency,
      brokerNote:
        'Default 100 oz contract with a 0.01 tick worth 1 USD per lot. Confirm this against your own broker before sizing anything — gold specs differ between brokers.',
    },
  });

  console.log(`Seeded instrument ${instrument.symbol}.`);
  console.log('No demo data was created. Register an account, then import your own history.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

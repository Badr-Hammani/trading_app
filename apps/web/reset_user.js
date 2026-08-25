const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const WEEKDAYS = [1, 2, 3, 4, 5];

const MOROCCO_SESSIONS = [
  {
    name: 'Asian',
    kind: 'asian',
    timezone: 'Africa/Casablanca',
    startMinutes: 9 * 60,   // 09:00
    endMinutes: 18 * 60,   // 18:00
    days: WEEKDAYS,
    tradingPermitted: false,
    enabled: true,
    color: '#3b82f6',
    sortOrder: 0,
  },
  {
    name: 'London',
    kind: 'london',
    timezone: 'Africa/Casablanca',
    startMinutes: 19 * 60,  // 19:00
    endMinutes: 4 * 60,    // 04:00
    days: WEEKDAYS,
    tradingPermitted: true,
    enabled: true,
    color: '#22c55e',
    sortOrder: 1,
  },
  {
    name: 'New York',
    kind: 'newyork',
    timezone: 'Africa/Casablanca',
    startMinutes: 0 * 60,   // 00:00
    endMinutes: 9 * 60,    // 09:00
    days: WEEKDAYS,
    tradingPermitted: true,
    enabled: true,
    color: '#f59e0b',
    sortOrder: 2,
  },
  {
    name: 'London / NY Overlap',
    kind: 'overlap',
    timezone: 'Africa/Casablanca',
    startMinutes: 0 * 60,   // 00:00
    endMinutes: 4 * 60,    // 04:00
    days: WEEKDAYS,
    tradingPermitted: true,
    enabled: true,
    color: '#a855f7',
    sortOrder: 3,
  },
];

async function main() {
  const user = await prisma.user.findFirst({ where: { email: 'badrhammani2017@gmail.com' } });
  if (!user) throw new Error('User not found');

  await prisma.user.update({
    where: { id: user.id },
    data: { timezone: 'Africa/Casablanca' },
  });

  await prisma.tradingSession.deleteMany({ where: { userId: user.id } });
  for (const s of MOROCCO_SESSIONS) {
    await prisma.tradingSession.create({
      data: {
        userId: user.id,
        ...s,
      },
    });
  }

  console.log('Successfully updated user trading sessions to exact chart bounds:', user.email);
}

main().catch(console.error).finally(() => prisma.$disconnect());

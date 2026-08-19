import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { LoginForm } from './LoginForm';
import { checkRequiredEnv, env } from '@/lib/env';
import { SAFETY_NOTICES } from '@xau/core';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');

  // The first run offers registration; after that it is sign-in only.
  const userCount = await prisma.user.count().catch(() => -1);
  const problems = checkRequiredEnv();

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="text-lg font-bold tracking-[0.2em] text-warn">XAUUSD</div>
          <div className="text-2xs uppercase tracking-[0.28em] text-ink-400">Command Center</div>
        </div>

        {problems.length > 0 && (
          <div className="mb-4 rounded border border-bear/50 bg-bear/10 p-3 text-xs text-bear">
            <p className="font-semibold uppercase tracking-wide">Configuration incomplete</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
            <p className="mt-2 text-ink-300">Copy .env.example to .env and fill these in.</p>
          </div>
        )}

        <LoginForm
          allowRegistration={userCount === 0}
          databaseReachable={userCount >= 0}
          defaultTimezone={env.defaultTimezone}
        />

        <p className="mt-6 text-center text-2xs leading-relaxed text-ink-600">
          {SAFETY_NOTICES.purpose}
        </p>
      </div>
    </div>
  );
}

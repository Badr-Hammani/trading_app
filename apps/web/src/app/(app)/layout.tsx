import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { Nav } from '@/components/Nav';
import { SAFETY_NOTICES } from '@xau/core';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  return (
    <div className="flex min-h-screen flex-col">
      <Nav displayName={user.displayName} timezone={user.timezone} />
      <main className="min-h-0 flex-1">{children}</main>
      <footer className="border-t border-ink-800 px-3 py-2 text-2xs leading-relaxed text-ink-600">
        {SAFETY_NOTICES.purpose} {SAFETY_NOTICES.prediction} {SAFETY_NOTICES.execution}
      </footer>
    </div>
  );
}

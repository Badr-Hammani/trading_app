'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import clsx from 'clsx';
import { useState } from 'react';
import { post } from '@/lib/client';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/charts', label: 'Charts' },
  { href: '/market', label: 'Market' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/setups', label: 'Setups' },
  { href: '/risk', label: 'Risk' },
  { href: '/journal', label: 'Journal' },
  { href: '/replay', label: 'Replay' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/strategy-lab', label: 'Strategy Lab' },
  { href: '/plan', label: 'Daily Plan' },
  { href: '/ai-mentor', label: 'AI Mentor' },
  { href: '/settings', label: 'Settings' },
];

export function Nav({ displayName, timezone }: { displayName: string; timezone: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const signOut = async () => {
    await post('/api/auth/logout', {});
    router.push('/login');
    router.refresh();
  };

  return (
    <nav className="sticky top-0 z-40 border-b border-ink-700 bg-ink-950/95 backdrop-blur">
      <div className="flex items-center gap-3 px-3 py-1.5">
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2">
          <span className="text-xs font-bold tracking-[0.16em] text-warn">XAU</span>
          <span className="hidden text-2xs uppercase tracking-[0.2em] text-ink-400 sm:inline">
            Command Center
          </span>
        </Link>

        <div className="hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto lg:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={clsx(
                'whitespace-nowrap rounded px-2 py-1 text-xs transition-colors',
                pathname === link.href || pathname.startsWith(`${link.href}/`)
                  ? 'bg-ink-800 text-ink-100'
                  : 'text-ink-400 hover:bg-ink-850 hover:text-ink-200',
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span className="hidden text-2xs text-ink-500 md:inline">{timezone}</span>
          <span className="hidden text-2xs text-ink-400 sm:inline">{displayName}</span>
          <button type="button" onClick={signOut} className="btn btn-ghost">
            Sign out
          </button>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="btn btn-ghost lg:hidden"
            aria-label="Toggle navigation"
          >
            Menu
          </button>
        </div>
      </div>

      {open && (
        <div className="grid grid-cols-2 gap-1 border-t border-ink-700 p-2 sm:grid-cols-3 lg:hidden">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className={clsx(
                'rounded px-2 py-1.5 text-xs',
                pathname === link.href ? 'bg-ink-800 text-ink-100' : 'text-ink-300 hover:bg-ink-850',
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { post } from '@/lib/client';
import { useAction } from '@/lib/hooks';

export function LoginForm({
  allowRegistration,
  databaseReachable,
  defaultTimezone,
}: {
  allowRegistration: boolean;
  databaseReachable: boolean;
  defaultTimezone: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>(allowRegistration ? 'register' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [timezone, setTimezone] = useState(defaultTimezone);

  const submit = useAction(async () => {
    if (mode === 'register') {
      await post('/api/auth/register', { email, password, displayName, timezone });
    } else {
      await post('/api/auth/login', { email, password });
    }
    router.push('/dashboard');
    router.refresh();
  });

  if (!databaseReachable) {
    return (
      <div className="panel p-4 text-xs text-ink-300">
        <p className="font-semibold text-bear">Database unreachable</p>
        <p className="mt-2 leading-relaxed">
          The application cannot reach PostgreSQL. Check DATABASE_URL, then run{' '}
          <code className="rounded bg-ink-850 px-1">npm run db:migrate</code>.
        </p>
      </div>
    );
  }

  return (
    <form
      className="panel space-y-3 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit.run();
      }}
    >
      <h1 className="text-sm font-semibold text-ink-100">
        {mode === 'register' ? 'Create your account' : 'Sign in'}
      </h1>

      {mode === 'register' && (
        <>
          <div>
            <label className="field-label" htmlFor="displayName">
              Name
            </label>
            <input
              id="displayName"
              className="input"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
              autoComplete="name"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="timezone">
              Timezone (IANA)
            </label>
            <input
              id="timezone"
              className="input"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              required
            />
            <p className="mt-1 text-2xs text-ink-500">
              Sessions and events are converted into this zone throughout the app.
            </p>
          </div>
        </>
      )}

      <div>
        <label className="field-label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          type="email"
          className="input"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          autoComplete="email"
        />
      </div>

      <div>
        <label className="field-label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          className="input"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          minLength={mode === 'register' ? 10 : 1}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
        />
        {mode === 'register' && (
          <p className="mt-1 text-2xs text-ink-500">At least 10 characters.</p>
        )}
      </div>

      {submit.error && (
        <p className="rounded border border-bear/50 bg-bear/10 px-2 py-1.5 text-xs text-bear">
          {submit.error}
        </p>
      )}

      <button type="submit" className="btn btn-primary w-full" disabled={submit.busy}>
        {submit.busy ? 'Working…' : mode === 'register' ? 'Create account' : 'Sign in'}
      </button>

      {allowRegistration && (
        <button
          type="button"
          className="btn btn-ghost w-full"
          onClick={() => setMode((value) => (value === 'login' ? 'register' : 'login'))}
        >
          {mode === 'login' ? 'Create the first account instead' : 'I already have an account'}
        </button>
      )}
    </form>
  );
}

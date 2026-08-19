import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { prisma } from './db';
import { env } from './env';

/**
 * Authentication.
 *
 * Sessions are opaque random tokens stored hashed in the database and carried
 * in an httpOnly cookie, wrapped in a signed JWT so a tampered cookie is
 * rejected before it reaches the database. Revocation works because the
 * server holds the session row — a stateless JWT alone could not be revoked.
 */

const COOKIE_NAME = 'xau_session';
const SESSION_DAYS = 30;

function secretKey(): Uint8Array {
  if (!env.authSecret || env.authSecret.length < 32) {
    throw new Error('AUTH_SECRET must be set to at least 32 characters.');
  }
  return new TextEncoder().encode(env.authSecret);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function constantTimeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  timezone: string;
}

export async function createSession(userId: string, userAgent?: string): Promise<void> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);

  await prisma.authSession.create({
    data: { userId, tokenHash: hashToken(token), expiresAt, userAgent: userAgent ?? null },
  });

  const jwt = await new SignJWT({ token })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());

  const store = await cookies();
  store.set(COOKIE_NAME, jwt, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.cookieSecure,
    path: '/',
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const cookie = store.get(COOKIE_NAME);
  if (cookie) {
    try {
      const { payload } = await jwtVerify(cookie.value, secretKey());
      const token = String(payload.token ?? '');
      if (token) {
        await prisma.authSession.deleteMany({ where: { tokenHash: hashToken(token) } });
      }
    } catch {
      // A cookie we cannot verify is already useless; just clear it.
    }
  }
  store.delete(COOKIE_NAME);
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const cookie = store.get(COOKIE_NAME);
  if (!cookie) return null;

  try {
    const { payload } = await jwtVerify(cookie.value, secretKey());
    const token = String(payload.token ?? '');
    if (!token) return null;

    const session = await prisma.authSession.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });

    if (!session || session.expiresAt < new Date()) {
      if (session) await prisma.authSession.delete({ where: { id: session.id } }).catch(() => {});
      return null;
    }

    return {
      id: session.user.id,
      email: session.user.email,
      displayName: session.user.displayName,
      timezone: session.user.timezone,
    };
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export class UnauthorizedError extends Error {
  constructor() {
    super('Authentication required.');
    this.name = 'UnauthorizedError';
  }
}

/** Remove expired rows. Called opportunistically on login. */
export async function pruneExpiredSessions(): Promise<void> {
  await prisma.authSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
}

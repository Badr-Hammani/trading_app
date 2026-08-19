import { z } from 'zod';
import { prisma } from '@/lib/db';
import { createSession, pruneExpiredSessions, verifyPassword } from '@/lib/auth';
import { apiError, handleRouteError, json, parseBody } from '@/lib/api';

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(request: Request) {
  try {
    const body = await parseBody(request, schema);
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });

    // Same message and comparable work either way, so the response does not
    // reveal whether the address is registered.
    const valid = user ? await verifyPassword(body.password, user.passwordHash) : false;
    if (!user || !valid) return apiError('Email or password is incorrect.', 401);

    await pruneExpiredSessions();
    await createSession(user.id, request.headers.get('user-agent') ?? undefined);

    return json({
      user: { id: user.id, email: user.email, displayName: user.displayName, timezone: user.timezone },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

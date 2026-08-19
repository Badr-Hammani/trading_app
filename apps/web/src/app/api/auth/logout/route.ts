import { destroySession } from '@/lib/auth';
import { handleRouteError, json } from '@/lib/api';

export async function POST() {
  try {
    await destroySession();
    return json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

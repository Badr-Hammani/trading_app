import { getCurrentUser } from '@/lib/auth';
import { handleRouteError, json } from '@/lib/api';

export async function GET() {
  try {
    return json({ user: await getCurrentUser() });
  } catch (error) {
    return handleRouteError(error);
  }
}

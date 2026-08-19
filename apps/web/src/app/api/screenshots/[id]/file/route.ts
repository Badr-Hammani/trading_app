import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { apiError, handleRouteError } from '@/lib/api';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/** Serve an upload, scoped to its owner — uploads are not publicly reachable. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await params;

    const screenshot = await prisma.screenshot.findFirst({ where: { id, userId: user.id } });
    if (!screenshot) return apiError('Screenshot not found.', 404);

    const bytes = await readFile(join(env.uploadDir, screenshot.storagePath));
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': screenshot.mimeType,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

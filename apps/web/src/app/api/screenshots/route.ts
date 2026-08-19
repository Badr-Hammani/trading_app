import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { apiError, handleRouteError, json } from '@/lib/api';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ALLOWED = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 8 * 1024 * 1024;

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const tradeId = new URL(request.url).searchParams.get('tradeId');
    const screenshots = await prisma.screenshot.findMany({
      where: { userId: user.id, ...(tradeId ? { tradeId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return json({ screenshots });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** Before/after chart screenshots, stored on the uploads volume. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const form = await request.formData();
    const file = form.get('file');
    const tradeId = form.get('tradeId') ? String(form.get('tradeId')) : null;
    const phase = String(form.get('phase') ?? 'before');
    const caption = String(form.get('caption') ?? '');

    if (!(file instanceof File)) return apiError('No image was uploaded.', 422);
    if (!ALLOWED.includes(file.type)) {
      return apiError(`Unsupported image type "${file.type}". Use PNG, JPEG or WebP.`, 422);
    }
    if (file.size > MAX_BYTES) {
      return apiError(`Image is ${(file.size / 1e6).toFixed(1)} MB; the limit is 8 MB.`, 422);
    }
    if (tradeId) {
      const owned = await prisma.trade.findFirst({ where: { id: tradeId, userId: user.id } });
      if (!owned) return apiError('Trade not found.', 404);
    }

    const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
    const relativePath = join(user.id, `${randomUUID()}.${extension}`);
    const absolutePath = join(env.uploadDir, relativePath);

    await mkdir(join(env.uploadDir, user.id), { recursive: true });
    await writeFile(absolutePath, Buffer.from(await file.arrayBuffer()));

    const screenshot = await prisma.screenshot.create({
      data: {
        userId: user.id,
        tradeId,
        phase,
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        storagePath: relativePath,
        caption,
      },
    });

    return json({ screenshot });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return apiError('A screenshot id is required.', 422);
    await prisma.screenshot.deleteMany({ where: { id, userId: user.id } });
    return json({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}

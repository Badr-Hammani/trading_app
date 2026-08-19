import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { apiError, handleRouteError, json, parseBody } from '@/lib/api';
import { env } from '@/lib/env';
import { askAssistant } from '@/lib/ai';
import { SCREENSHOT_SYSTEM_PROMPT } from '@xau/core';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const schema = z.object({
  screenshotId: z.string(),
  question: z.string().max(1000).default(''),
});

/**
 * Chart screenshot analysis.
 *
 * The prompt forces the reply into OBSERVED / INTERPRETATION / MISSING /
 * ACTION so what the model can actually see stays separated from what it is
 * inferring. Reading a picture is inherently uncertain and the output says so.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(request, schema);

    const screenshot = await prisma.screenshot.findFirst({
      where: { id: body.screenshotId, userId: user.id },
    });
    if (!screenshot) return apiError('Screenshot not found.', 404);

    const bytes = await readFile(join(env.uploadDir, screenshot.storagePath));

    const result = await askAssistant(SCREENSHOT_SYSTEM_PROMPT, [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: screenshot.mimeType,
              data: bytes.toString('base64'),
            },
          },
          {
            type: 'text',
            text:
              body.question ||
              'Read this chart against my model: HTF context, liquidity, displacement, structure break, fresh FVG, retracement, confirmation. Say what is visible, what you are inferring, and what has not happened yet.',
          },
        ],
      },
    ]);

    if (result.available) {
      await prisma.screenshot.update({
        where: { id: screenshot.id },
        data: { analysis: JSON.parse(JSON.stringify(result)) },
      });
    }

    return json(result);
  } catch (error) {
    return handleRouteError(error);
  }
}

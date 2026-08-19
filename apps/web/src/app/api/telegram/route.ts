import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { handleRouteError, json, parseBody } from '@/lib/api';
import { env } from '@/lib/env';
import { handleTelegramCommand, sendTelegramMessage, TELEGRAM_COMMANDS } from '@/lib/telegram';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const user = await requireUser();
    const settings = await prisma.userSettings.findUnique({ where: { userId: user.id } });
    return json({
      configured: Boolean(env.telegramBotToken),
      enabled: settings?.telegramEnabled ?? false,
      chatId: settings?.telegramChatId ?? null,
      commands: TELEGRAM_COMMANDS,
    });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** Run a bot command from the UI, or send its output to the linked chat. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(
      request,
      z.object({ command: z.string().min(1).max(40), send: z.boolean().default(false) }),
    );

    const text = await handleTelegramCommand(user.id, body.command);

    let sent = false;
    if (body.send) {
      const settings = await prisma.userSettings.findUnique({ where: { userId: user.id } });
      const chatId = settings?.telegramChatId ?? env.telegramChatId;
      if (!chatId) {
        return json({ text, sent: false, error: 'No Telegram chat id is configured.' });
      }
      sent = await sendTelegramMessage(chatId, text);
    }

    return json({ text, sent });
  } catch (error) {
    return handleRouteError(error);
  }
}

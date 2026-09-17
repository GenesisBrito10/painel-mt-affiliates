import type { Context, NextFunction } from 'grammy';
import { config } from '../config.js';

export async function authMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  if (!config.allowedIds.includes(userId)) {
    await ctx.reply(
      '🚫 Acesso negado. Seu Telegram ID não está autorizado.\n\n' +
        `Seu ID: <code>${userId}</code>\n` +
        'Peça ao admin para adicionar em TELEGRAM_ALLOWED_IDS.',
      { parse_mode: 'HTML' },
    );
    return;
  }

  await next();
}

export async function logMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  const user = ctx.from;
  const text = ctx.message?.text ?? ctx.callbackQuery?.data ?? '';
  if (user && text) {
    console.log(`[${new Date().toISOString()}] @${user.username ?? user.id}: ${text.slice(0, 120)}`);
  }
  await next();
}

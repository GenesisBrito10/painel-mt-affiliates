import { Bot } from 'grammy';
import { config } from './config.js';
import { pool } from './db.js';
import { registerHandlers } from './bot/handlers.js';
import { authMiddleware, logMiddleware } from './bot/middleware.js';

async function main(): Promise<void> {
  const bot = new Bot(config.botToken);

  bot.use(logMiddleware);
  bot.use(authMiddleware);
  registerHandlers(bot);

  bot.catch((err) => {
    console.error('Bot error:', err);
  });

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} — encerrando bot…`);
    await bot.stop();
    await pool.end();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  console.log('🤖 Vallex Telegram Bot iniciado');
  console.log(`   IDs autorizados: ${config.allowedIds.join(', ')}`);

  await bot.start({
    onStart: (info) => console.log(`   Conectado como @${info.username}`),
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

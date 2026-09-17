import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_ALLOWED_IDS: z.string().min(1),
  DATABASE_URL: z.string().min(1),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Variáveis de ambiente inválidas:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  botToken: parsed.data.TELEGRAM_BOT_TOKEN,
  allowedIds: parsed.data.TELEGRAM_ALLOWED_IDS.split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .map(Number),
  databaseUrl: parsed.data.DATABASE_URL,
};

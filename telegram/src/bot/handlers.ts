import type { Context } from 'grammy';
import { Bot } from 'grammy';
import { investigateAffiliate } from '../services/affiliate-investigation.service.js';
import { lookupByLink } from '../services/link-lookup.service.js';
import { extractLinkToken, isLikelyLinkQuery } from '../utils/link-parser.js';
import { formatLinkLookupReport } from './link-report.js';
import { formatInvestigationReport, HELP_TEXT } from './report.js';

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

const KNOWN_HOUSES = [
  'superbet',
  'sportingbet',
  'esportivabet',
  'hiperbet',
  'lottu',
  'betnacional',
  'betano',
  'novibet',
  'stake',
  'bet365',
];

function parseInput(text: string): { email?: string; house?: string } {
  const emailMatch = text.match(EMAIL_RE);
  const email = emailMatch?.[0];

  const lower = text.toLowerCase();
  const house = KNOWN_HOUSES.find((h) => lower.includes(h));

  return { email, house };
}

async function runLinkLookup(ctx: Context, input: string): Promise<void> {
  const token = extractLinkToken(input);
  if (!token) {
    await ctx.reply(
      'Uso: <code>/link VALLEXBR55</code> ou cole a URL do Superbet.',
      { parse_mode: 'HTML' },
    );
    return;
  }

  await ctx.reply('⏳ Consultando banco + Betboard…');

  try {
    const result = await lookupByLink(token);
    if (!result) {
      await ctx.reply('❌ Não consegui interpretar o link/código.', {
        parse_mode: 'HTML',
      });
      return;
    }

    await ctx.reply(formatLinkLookupReport(result), { parse_mode: 'HTML' });
  } catch (err) {
    console.error('Link lookup error:', err);
    await ctx.reply('❌ Erro ao consultar o banco. Verifique os logs do bot.');
  }
}

async function runInvestigation(
  ctx: Context,
  email: string,
  house?: string,
): Promise<void> {
  await ctx.reply('⏳ Investigando…');

  try {
    const result = await investigateAffiliate(email, house);
    if (!result) {
      await ctx.reply(`❌ Afiliado não encontrado: <code>${email}</code>`, {
        parse_mode: 'HTML',
      });
      return;
    }

    await ctx.reply(formatInvestigationReport(result, house), {
      parse_mode: 'HTML',
    });
  } catch (err) {
    console.error('Investigation error:', err);
    await ctx.reply('❌ Erro ao consultar o banco. Verifique os logs do bot.');
  }
}

export function registerHandlers(bot: Bot): void {
  bot.command('start', async (ctx) => {
    await ctx.reply(HELP_TEXT, { parse_mode: 'HTML' });
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(HELP_TEXT, { parse_mode: 'HTML' });
  });

  bot.command('investigar', async (ctx) => {
    const args = ctx.message?.text?.replace(/^\/investigar(@\w+)?\s*/i, '').trim() ?? '';
    const { email, house } = parseInput(args);

    if (!email) {
      await ctx.reply(
        'Uso: <code>/investigar email@exemplo.com [casa]</code>',
        { parse_mode: 'HTML' },
      );
      return;
    }

    await runInvestigation(ctx, email, house);
  });

  bot.command('link', async (ctx) => {
    const args = ctx.message?.text?.replace(/^\/link(@\w+)?\s*/i, '').trim() ?? '';
    await runLinkLookup(ctx, args || ctx.message?.text || '');
  });

  bot.command('id', async (ctx) => {
    await ctx.reply(`Seu Telegram ID: <code>${ctx.from?.id}</code>`, {
      parse_mode: 'HTML',
    });
  });

  // Mensagem livre: detecta email ou link/código
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith('/')) return;

    const { email, house } = parseInput(text);

    // Link tem prioridade se parecer URL ou código (sem email)
    if (!email && isLikelyLinkQuery(text)) {
      await runLinkLookup(ctx, text);
      return;
    }

    if (email) {
      await runInvestigation(ctx, email, house);
    }
  });
}

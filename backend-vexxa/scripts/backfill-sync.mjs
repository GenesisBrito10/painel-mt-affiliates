/**
 * Backfill de um intervalo de datas para uma casa, direto no servidor.
 *
 * Sobe um contexto Nest só com o SyncModule e chama o mesmo
 * SyncOrchestratorService que o cron usa — nada de lógica duplicada aqui
 * (taxas do link, batches, enriquecimento e webhooks saem idênticos ao sync
 * normal). O ScheduleModule.forRoot() vive apenas no AppModule, então nenhum
 * cron é registrado por este processo.
 *
 * Necessário para provedores `current-day-only` (Smartico): sem datas
 * explícitas o orchestrator só traz o dia corrente.
 *
 * Requer o build: pnpm run build (usa dist/).
 *
 * Uso:
 *   node scripts/backfill-sync.mjs --house=bateubet --from=2026-03-29 --to=2026-09-21
 *   node scripts/backfill-sync.mjs --house=bateubet --from=2026-03-29 --to=2026-09-21 --apply
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import pg from 'pg';

// O dist é CommonJS (swc): `await import()` embrulharia tudo em `default`.
const require = createRequire(import.meta.url);

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => { const i = a.indexOf('='); return i === -1 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }),
);
const APPLY = args.apply === true;
const HOUSE = args.house;
const FROM = args.from;
const TO = args.to;

if (!HOUSE || !FROM || !TO) {
  console.error('Uso: node scripts/backfill-sync.mjs --house=<slug> --from=YYYY-MM-DD --to=YYYY-MM-DD [--apply]');
  process.exit(1);
}

const ROOT = path.resolve(import.meta.dirname, '..');
const distMain = path.join(ROOT, 'dist/src/main.js');
if (!fs.existsSync(distMain)) {
  console.error(`Build ausente (${distMain}). Rode: pnpm run build`);
  process.exit(1);
}

const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')
    .filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
);
if (!env.DATABASE_URL) throw new Error('faltando DATABASE_URL no .env');

const { expandDateRange } = require(path.join(ROOT, 'dist/src/modules/sync/domain/date-range.js'));
let dates;
try {
  dates = expandDateRange(FROM, TO);
} catch (err) {
  console.error(`Intervalo inválido: ${err.message}`);
  process.exit(1);
}

// ── Plano ────────────────────────────────────────────────────────────────────
const c = new pg.Client({ connectionString: env.DATABASE_URL });
try {
  await c.connect();
} catch (err) {
  console.error(`Não consegui conectar ao banco: ${err.message}`);
  process.exit(1);
}
let cutover = null;
try {
  console.log(`\n=== Backfill ${HOUSE} (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);
  console.log(`intervalo: ${dates[0]} .. ${dates[dates.length - 1]} (${dates.length} dia(s))`);

  const house = await c.query('SELECT slug, active, "syncMode" FROM betting_houses WHERE slug=$1', [HOUSE]);
  if (house.rows.length === 0) throw new Error(`casa "${HOUSE}" não existe`);
  console.log(`casa:      active=${house.rows[0].active} syncMode=${house.rows[0].syncMode}`);

  const accounts = await c.query(
    `SELECT pa.name, pa.provider, pa."apiBaseUrl", pah."bookmarkerId", pah.active
       FROM provider_account_houses pah
       JOIN provider_accounts pa ON pa.id = pah."providerAccountId"
      WHERE pah."bettingHouseSlug" = $1 AND pah.active AND pa.active`,
    [HOUSE],
  );
  if (accounts.rows.length === 0) throw new Error(`nenhuma conta de provedor ativa vinculada a "${HOUSE}"`);
  for (const a of accounts.rows) {
    console.log(`conta:     ${a.name} (${a.provider}) host=${a.apiBaseUrl} group_by=${a.bookmarkerId}`);
  }

  // O orchestrator descarta silenciosamente tudo anterior ao cutover da casa.
  const setting = await c.query('SELECT value FROM settings WHERE key=$1', [`ledger_cutover_date_${HOUSE}`]);
  cutover = setting.rows[0]?.value || null;
  if (cutover) {
    const kept = dates.filter((d) => d >= cutover);
    console.log(`cutover:   ${cutover} — ${dates.length - kept.length} dia(s) serão descartados, restam ${kept.length}`);
    if (kept.length === 0) throw new Error('todas as datas são anteriores ao cutover da casa');
  } else {
    console.log('cutover:   nenhum');
  }

  const before = await c.query(
    'SELECT count(*)::int AS linhas, min(date)::date AS primeiro, max(date)::date AS ultimo FROM affiliate_data WHERE "bettingHouse"=$1',
    [HOUSE],
  );
  console.log(`antes:     ${before.rows[0].linhas} linha(s) em affiliate_data (${before.rows[0].primeiro ?? '—'} .. ${before.rows[0].ultimo ?? '—'})`);
} catch (err) {
  console.error('ERRO:', err.message);
  await c.end();
  process.exit(1);
}

if (!APPLY) {
  console.log('\nDRY-RUN — nada sincronizado. Rode com --apply.\n');
  await c.end();
  process.exit(0);
}

// ── Execução via Nest ────────────────────────────────────────────────────────
require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { ConfigModule, ConfigService } = require('@nestjs/config');
const { BullModule } = require('@nestjs/bullmq');
const { Module } = require('@nestjs/common');
const { SharedModule } = require(path.join(ROOT, 'dist/src/modules/shared/shared.module.js'));
const { SyncModule } = require(path.join(ROOT, 'dist/src/modules/sync/sync.module.js'));
const { SyncSchedulerService } = require(path.join(ROOT, 'dist/src/modules/sync/infrastructure/scheduling/sync-scheduler.service.js'));

// .mjs não tem sintaxe de decorator — @Module é só uma função, aplicada à mão.
class BackfillModule {}
// SharedModule é @Global e fornece o CryptoService de que o ProviderAccountModule
// depende para decriptar o token da conta (o Redis dele é lazyConnect).
// BullModule.forRoot é obrigatório: o LinkWebhookModule só faz registerQueue,
// e sem a conexão da raiz o worker do BullMQ nem constrói
// ("Worker requires a connection"). Mesma config do AppModule.
Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config) => ({
        connection: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get('REDIS_PORT', 6379),
          password: config.get('REDIS_PASSWORD') || undefined,
          db: config.get('REDIS_DB', 0),
        },
      }),
    }),
    SharedModule,
    SyncModule,
  ],
})(BackfillModule);

console.log('\nSubindo contexto Nest (sem cron)...\n');
const app = await NestFactory.createApplicationContext(BackfillModule, {
  logger: ['error', 'warn', 'log'],
});
try {
  await app.get(SyncSchedulerService).runHouse(HOUSE, 'script-backfill', dates);
  const after = await c.query(
    'SELECT count(*)::int AS linhas, min(date)::date AS primeiro, max(date)::date AS ultimo FROM affiliate_data WHERE "bettingHouse"=$1',
    [HOUSE],
  );
  console.log(`\n✅ depois: ${after.rows[0].linhas} linha(s) (${after.rows[0].primeiro} .. ${after.rows[0].ultimo})\n`);
} catch (err) {
  console.error('ERRO no sync:', err.message);
  process.exitCode = 1;
} finally {
  await app.close();
  await c.end();
}

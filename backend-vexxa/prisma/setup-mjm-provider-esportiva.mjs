/**
 * Cadastra a conta de PROVEDOR (provider_accounts, betboard) admin@vallexgroup.com.br
 * e vincula à esportivabet (provider_account_houses). Senha criptografada
 * AES-256-GCM (mesmo esquema do CryptoService). Idempotente (ON CONFLICT).
 *
 * Uso:
 *   node prisma/setup-mjm-provider-esportiva.mjs           # dry-run
 *   node prisma/setup-mjm-provider-esportiva.mjs --apply   # aplica
 */
import fs from 'node:fs';
import pg from 'pg';
import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';

const APPLY = process.argv.includes('--apply');

const ACCOUNT_NAME = 'Admin MT Affiliates';
const ACCOUNT_EMAIL = 'admin@vallexgroup.com.br';
const ESPORTIVA_SLUG = 'esportivabet';
const ESPORTIVA_BOOKMARKER = '02510c60-e702-479e-ada2-017e0b77f762';

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')
    .filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
);
const { DATABASE_URL, ENCRYPTION_KEY, PROVIDER_ACCOUNT_PASSWORD: ACCOUNT_PASSWORD } = env;
if (!DATABASE_URL || !ENCRYPTION_KEY || !ACCOUNT_PASSWORD) {
  throw new Error('faltando DATABASE_URL/ENCRYPTION_KEY/PROVIDER_ACCOUNT_PASSWORD no .env');
}

// Mesmo esquema do CryptoService / setup-vallex-sportingbet.mjs.
function encrypt(plaintext) {
  const key = createHash('sha256').update(ENCRYPTION_KEY).digest();
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString('base64')).join(':');
}

const c = new pg.Client({ connectionString: DATABASE_URL });
await c.connect();
try {
  console.log(`\n=== Provedor Vallex + esportivabet (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);
  console.log(`name:  ${ACCOUNT_NAME}`);
  console.log(`email: ${ACCOUNT_EMAIL}`);
  console.log(`provider: betboard | vincular: ${ESPORTIVA_SLUG} (bookmarker ${ESPORTIVA_BOOKMARKER})`);

  const house = await c.query(`SELECT slug, active FROM betting_houses WHERE slug=$1`, [ESPORTIVA_SLUG]);
  if (house.rows.length === 0) throw new Error('esportivabet não existe em betting_houses');
  console.log(`esportivabet active: ${house.rows[0].active}`);

  if (!APPLY) {
    const ex = await c.query(`SELECT id FROM provider_accounts WHERE name=$1 AND provider='betboard'`, [ACCOUNT_NAME]);
    console.log(`\nconta já existe? ${ex.rows.length ? 'SIM (será atualizada)' : 'não (será criada)'}`);
    console.log('\nDRY-RUN — nada gravado. Rode com --apply.\n');
    process.exit(0);
  }

  await c.query('BEGIN');
  try {
    const acc = await c.query(
      `INSERT INTO provider_accounts (id, name, provider, "apiBaseUrl", email, "encryptedPassword", active, "updatedAt")
       VALUES ($1, $2, 'betboard', 'https://api-affiliates.mgaffiliates.site/api', $3, $4, true, now())
       ON CONFLICT ("name", "provider") DO UPDATE SET
         email=EXCLUDED.email, "encryptedPassword"=EXCLUDED."encryptedPassword", active=true, "updatedAt"=now()
       RETURNING id`,
      [randomUUID(), ACCOUNT_NAME, ACCOUNT_EMAIL, encrypt(ACCOUNT_PASSWORD)],
    );
    const accId = acc.rows[0].id;

    await c.query(
      `INSERT INTO provider_account_houses
         (id, "providerAccountId", "bettingHouseSlug", "bookmarkerId", "extraConfig", active, "updatedAt")
       VALUES ($1, $2, $3, $4, '{}', true, now())
       ON CONFLICT ("providerAccountId", "bettingHouseSlug") DO UPDATE SET
         "bookmarkerId"=EXCLUDED."bookmarkerId", active=true, "updatedAt"=now()`,
      [randomUUID(), accId, ESPORTIVA_SLUG, ESPORTIVA_BOOKMARKER],
    );

    await c.query('COMMIT');
    console.log(`\n✅ Conta de provedor criada/atualizada (id ${accId}) e vinculada à esportivabet.\n`);
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  }
} catch (err) {
  console.error('ERRO:', err.message);
  process.exitCode = 1;
} finally {
  await c.end();
}

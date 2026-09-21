/**
 * Cadastra a conta de PROVEDOR Smartico da Bateu Bet (provider_accounts) e
 * vincula à casa (provider_account_houses) com group_by = afp — os links da
 * Bateu Bet são go.aff.bateu.bet.br/xxxx?afp=CODIGO, então o CODIGO vira o
 * campaignId no painel.
 *
 * Diferente do Pinbet, esta conta vive em OUTRO host Smartico (boapi3), por
 * isso o apiBaseUrl é gravado na própria conta. O token vai criptografado
 * (AES-256-GCM, mesmo esquema do CryptoService) em encryptedPassword — nunca
 * hardcoded aqui. Idempotente (ON CONFLICT).
 *
 * Requer no .env: DATABASE_URL, ENCRYPTION_KEY, BATEUBET_SMARTICO_TOKEN.
 *
 * Uso:
 *   node prisma/setup-bateubet-provider.mjs                    # dry-run
 *   node prisma/setup-bateubet-provider.mjs --apply            # aplica
 *   node prisma/setup-bateubet-provider.mjs --house=outra-slug # outro slug de casa
 */
import fs from 'node:fs';
import pg from 'pg';
import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';

const APPLY = process.argv.includes('--apply');
const houseArg = process.argv.find((a) => a.startsWith('--house='));

const ACCOUNT_NAME = 'Bateu Bet';
const ACCOUNT_EMAIL = 'bateubet';
const API_BASE_URL = 'https://boapi3.smartico.ai/api';
const HOUSE_SLUG = houseArg ? houseArg.slice('--house='.length) : 'bateubet';
// Dimensão de agrupamento do relatório af2_media_report_af.
const BOOKMARKER = 'afp';

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')
    .filter((l) => l.includes('='))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
);
const { DATABASE_URL, ENCRYPTION_KEY, BATEUBET_SMARTICO_TOKEN: TOKEN } = env;
if (!DATABASE_URL || !ENCRYPTION_KEY || !TOKEN) {
  throw new Error('faltando DATABASE_URL/ENCRYPTION_KEY/BATEUBET_SMARTICO_TOKEN no .env');
}

// Mesmo esquema do CryptoService / setup-mjm-provider-esportiva.mjs.
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
  console.log(`\n=== Provedor Smartico Bateu Bet (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);
  console.log(`name:     ${ACCOUNT_NAME}`);
  console.log(`provider: smartico`);
  console.log(`host:     ${API_BASE_URL}`);
  console.log(`casa:     ${HOUSE_SLUG} (group_by=${BOOKMARKER})`);
  console.log(`token:    ****${TOKEN.slice(-6)} (do .env, gravado criptografado)`);

  const house = await c.query('SELECT slug, active, "syncMode" FROM betting_houses WHERE slug=$1', [HOUSE_SLUG]);
  if (house.rows.length === 0) {
    const similar = await c.query("SELECT slug FROM betting_houses WHERE slug ILIKE '%bateu%' ORDER BY slug");
    throw new Error(
      `casa "${HOUSE_SLUG}" não existe em betting_houses. ` +
      `Candidatos: ${similar.rows.map((r) => r.slug).join(', ') || 'nenhum'} — ` +
      `use --house=<slug>`,
    );
  }
  console.log(`casa active=${house.rows[0].active} syncMode=${house.rows[0].syncMode}`);

  if (!APPLY) {
    const ex = await c.query("SELECT id FROM provider_accounts WHERE name=$1 AND provider='smartico'", [ACCOUNT_NAME]);
    console.log(`\nconta já existe? ${ex.rows.length ? 'SIM (será atualizada)' : 'não (será criada)'}`);
    console.log('\nDRY-RUN — nada gravado. Rode com --apply.\n');
    process.exit(0);
  }

  await c.query('BEGIN');
  try {
    const acc = await c.query(
      `INSERT INTO provider_accounts (id, name, provider, "apiBaseUrl", email, "encryptedPassword", active, "updatedAt")
       VALUES ($1, $2, 'smartico', $3, $4, $5, true, now())
       ON CONFLICT ("name", "provider") DO UPDATE SET
         "apiBaseUrl"=EXCLUDED."apiBaseUrl", email=EXCLUDED.email,
         "encryptedPassword"=EXCLUDED."encryptedPassword", active=true, "updatedAt"=now()
       RETURNING id`,
      [randomUUID(), ACCOUNT_NAME, API_BASE_URL, ACCOUNT_EMAIL, encrypt(TOKEN)],
    );
    const accId = acc.rows[0].id;

    await c.query(
      `INSERT INTO provider_account_houses
         (id, "providerAccountId", "bettingHouseSlug", "bookmarkerId", "extraConfig", active, "updatedAt")
       VALUES ($1, $2, $3, $4, '{}', true, now())
       ON CONFLICT ("providerAccountId", "bettingHouseSlug") DO UPDATE SET
         "bookmarkerId"=EXCLUDED."bookmarkerId", active=true, "updatedAt"=now()`,
      [randomUUID(), accId, HOUSE_SLUG, BOOKMARKER],
    );

    await c.query('COMMIT');
    console.log(`\n✅ Conta Smartico Bateu Bet criada/atualizada (id ${accId}) e vinculada à casa ${HOUSE_SLUG}.\n`);
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

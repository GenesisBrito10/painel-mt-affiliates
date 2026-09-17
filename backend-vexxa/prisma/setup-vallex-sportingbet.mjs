// One-off (authorized by user 2026-06-11):
//  1) Rename provider account "Anderson" -> "Jairo" (jairoex@afiliadosexternos.com / Jairo@2026),
//     keeping its existing superbet linkage.
//  2) Create betting house "sportingbet" mirroring "esportivabet" (D+30 mensal, depósito 40,
//     mín 10 CPAs) but Rollover 2x — synced via betboard.
//  3) Create provider account admin@vallexgroup.com.br / AdminVallexGroup@2026 ("Vallex Admin")
//     linked to esportivabet + sportingbet.
//
// Idempotent. DRY-RUN by default (rolls back). Commits only with --apply.
//   node prisma/setup-vallex-sportingbet.mjs            # dry-run
//   node prisma/setup-vallex-sportingbet.mjs --apply    # commit
import fs from 'node:fs';
import pg from 'pg';
import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';

const APPLY = process.argv.includes('--apply');

// ─── env (DATABASE_URL + ENCRYPTION_KEY) ─────────────────────
const env = Object.fromEntries(
  fs
    .readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
    }),
);
const DATABASE_URL = env.DATABASE_URL;
const ENCRYPTION_KEY = env.ENCRYPTION_KEY;
if (!DATABASE_URL || !ENCRYPTION_KEY) throw new Error('faltando DATABASE_URL/ENCRYPTION_KEY no .env');

// ─── crypto (mirrors CryptoService / seed-provider-accounts) ──
function encrypt(plaintext) {
  const key = createHash('sha256').update(ENCRYPTION_KEY).digest();
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString('base64')).join(':');
}

// ─── constants ───────────────────────────────────────────────
const ANDERSON_ID = 'd37dc315-7068-4860-b0c8-73bdb3f6f46e';
const ESPORTIVA_BOOKMARKER = '02510c60-e702-479e-ada2-017e0b77f762'; // per-house, shared
const SPORTINGBET_BOOKMARKER = '3490c10f-5736-4247-89de-26b0301aa52d'; // provided by user
const CONDITIONS =
  'Depósito médio maior que R$ 40,00\nTaxa de redepósito maior que 50%\nValor do Rollover: R$ 40,00\nRollover: 2x';
const PAYMENT_NOTES = 'Pagamento Mensal - Mínimo de 10 CPAs';

const c = new pg.Client({ connectionString: DATABASE_URL });
await c.connect();
try {
  await c.query('BEGIN');

  // 1) Anderson -> Jairo (keep superbet linkage)
  await c.query(
    `UPDATE provider_accounts
       SET name='Jairo', email='jairoex@afiliadosexternos.com', "encryptedPassword"=$1, "updatedAt"=now()
     WHERE id=$2`,
    [encrypt('Jairo@2026'), ANDERSON_ID],
  );

  // 2) sportingbet betting house — clone esportivabet, override slug/name/logo, fresh sync state
  await c.query(
    `INSERT INTO betting_houses
       (id, name, slug, "apiBaseURL", "apiBasePath", "apiKey", active, "syncSchedule", "syncMode",
        "withdrawalDay", "lastSyncAt", "createdAt", "updatedAt", "logoUrl", "withdrawalDayEnd",
        "withdrawalDay2", "withdrawalDay2End", "withdrawalWeekday", "minCpaToWithdraw",
        "withdrawalEnabled", "minAvgDepositPerCpa", "minWithdrawalAmount")
     SELECT $1, 'SportingBet', 'sportingbet', "apiBaseURL", "apiBasePath", "apiKey", active,
        "syncSchedule", "syncMode", "withdrawalDay", NULL, now(), now(), '', "withdrawalDayEnd",
        "withdrawalDay2", "withdrawalDay2End", "withdrawalWeekday", "minCpaToWithdraw",
        "withdrawalEnabled", "minAvgDepositPerCpa", "minWithdrawalAmount"
     FROM betting_houses WHERE slug='esportivabet'
     ON CONFLICT (slug) DO NOTHING`,
    [randomUUID()],
  );

  // 3) sportingbet deal — clone esportivabet deal, override texts (Rollover 2x), drop legacyKey
  const dealExists = await c.query(
    `SELECT id FROM deals WHERE "bettingHouseSlug"='sportingbet' LIMIT 1`,
  );
  if (dealExists.rowCount === 0) {
    await c.query(
      `INSERT INTO deals
         (id, "bettingHouseSlug", name, cpa, revshare, baseline, exclusive, featured, "newArrival",
          "sortOrder", "paymentCpaLabel", "paymentRevshareLabel", "revenueType", "revNegativeAccumulates",
          "revNegativeOffsetsCpa", "withdrawalIndicators", "trafficSources", "conditionsText",
          "paymentNotes", "logoUrl", active, "legacyKey", "createdAt", "updatedAt",
          "minAvgDepositPerFtd", "minQualifiedFtd")
       SELECT $1, 'sportingbet', 'SportingBet', cpa, revshare, baseline, exclusive, featured, "newArrival",
          "sortOrder", "paymentCpaLabel", "paymentRevshareLabel", "revenueType", "revNegativeAccumulates",
          "revNegativeOffsetsCpa", "withdrawalIndicators", "trafficSources", $2, $3, '', active, NULL,
          now(), now(), "minAvgDepositPerFtd", "minQualifiedFtd"
       FROM deals WHERE "bettingHouseSlug"='esportivabet' LIMIT 1`,
      [randomUUID(), CONDITIONS, PAYMENT_NOTES],
    );
  }

  // 4) sportingbet link rule — clone esportivabet rule
  await c.query(
    `INSERT INTO house_link_rules
       (id, "houseSlug", "requestEnabled", "autoAssignEnabled", "ruleType", "defaultCpa", "fallbackCpa",
        "inviterCpaThreshold", "inviterCpaDiscount", "defaultRevshare", "rangeReferenceHouse", "rangeTiers",
        "checkExistingLink", "checkPendingRequest", "useInviterCpa", "applyFallbackNoInviterCpa",
        "applyDefaultNoInviter", "blockOnRequiredFail", "processOldRequests", "requireActiveLinkInHouses",
        "requiredHouseSlugs", "blockMessage", "updatedByName", "createdAt", "updatedAt")
     SELECT $1, 'sportingbet', "requestEnabled", "autoAssignEnabled", "ruleType", "defaultCpa", "fallbackCpa",
        "inviterCpaThreshold", "inviterCpaDiscount", "defaultRevshare", "rangeReferenceHouse", "rangeTiers",
        "checkExistingLink", "checkPendingRequest", "useInviterCpa", "applyFallbackNoInviterCpa",
        "applyDefaultNoInviter", "blockOnRequiredFail", "processOldRequests", "requireActiveLinkInHouses",
        "requiredHouseSlugs", "blockMessage", "updatedByName", now(), now()
     FROM house_link_rules WHERE "houseSlug"='esportivabet'
     ON CONFLICT ("houseSlug") DO NOTHING`,
    [randomUUID()],
  );

  // 5) new provider account admin@vallexgroup.com.br
  const acct = await c.query(
    `INSERT INTO provider_accounts (id, name, provider, "apiBaseUrl", email, "encryptedPassword", active, "updatedAt")
     VALUES ($1, 'Vallex Admin', 'betboard', 'https://api-affiliates.mgaffiliates.site/api', 'admin@vallexgroup.com.br', $2, true, now())
     ON CONFLICT (name, provider) DO UPDATE SET
       email=EXCLUDED.email, "encryptedPassword"=EXCLUDED."encryptedPassword", active=true, "updatedAt"=now()
     RETURNING id`,
    [randomUUID(), encrypt('AdminVallexGroup@2026')],
  );
  const newAcctId = acct.rows[0].id;

  // 6) link new account to esportivabet + sportingbet
  for (const [slug, bk] of [
    ['esportivabet', ESPORTIVA_BOOKMARKER],
    ['sportingbet', SPORTINGBET_BOOKMARKER],
  ]) {
    await c.query(
      `INSERT INTO provider_account_houses
         (id, "providerAccountId", "bettingHouseSlug", "bookmarkerId", "extraConfig", active, "updatedAt")
       VALUES ($1, $2, $3, $4, '{}', true, now())
       ON CONFLICT ("providerAccountId", "bettingHouseSlug") DO UPDATE SET
         "bookmarkerId"=EXCLUDED."bookmarkerId", active=true, "updatedAt"=now()`,
      [randomUUID(), newAcctId, slug, bk],
    );
  }

  // ─── verification snapshot (inside txn) ─────────────────────
  const show = async (label, q, p = []) => {
    console.log(`\n=== ${label} ===`);
    for (const r of (await c.query(q, p)).rows) console.log(JSON.stringify(r));
  };
  await show('PROVIDER ACCOUNTS (Jairo + Vallex Admin)',
    `SELECT id, name, email, active FROM provider_accounts WHERE id IN ($1,$2) ORDER BY name`,
    [ANDERSON_ID, newAcctId]);
  await show('BETTING HOUSE sportingbet',
    `SELECT slug, name, active, "withdrawalDay", "withdrawalDayEnd", "minAvgDepositPerCpa", "minCpaToWithdraw", "withdrawalEnabled", "apiBaseURL", "apiBasePath" FROM betting_houses WHERE slug='sportingbet'`);
  await show('DEAL sportingbet',
    `SELECT "bettingHouseSlug", name, "conditionsText", "paymentNotes" FROM deals WHERE "bettingHouseSlug"='sportingbet'`);
  await show('LINK RULE sportingbet',
    `SELECT "houseSlug", "ruleType", "defaultCpa", "fallbackCpa", "defaultRevshare", "autoAssignEnabled" FROM house_link_rules WHERE "houseSlug"='sportingbet'`);
  await show('ACCOUNT HOUSES for Vallex Admin',
    `SELECT "bettingHouseSlug", "bookmarkerId", active FROM provider_account_houses WHERE "providerAccountId"=$1 ORDER BY "bettingHouseSlug"`,
    [newAcctId]);

  if (APPLY) {
    await c.query('COMMIT');
    console.log('\n[OK] COMMIT — alterações gravadas.');
  } else {
    await c.query('ROLLBACK');
    console.log('\n[DRY-RUN] ROLLBACK — nada gravado. Rode com --apply para gravar.');
  }
} catch (e) {
  await c.query('ROLLBACK');
  console.error('\n[FAIL] ROLLBACK:', e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}

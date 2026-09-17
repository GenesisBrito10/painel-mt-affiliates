/**
 * Guarded full reset for Betano Diario.
 *
 * Preview (default):
 *   node --env-file=.env scripts/reset-betano-diario.mjs
 * Apply the exact preview:
 *   node --env-file=.env scripts/reset-betano-diario.mjs --apply --snapshot-token=<sha256>
 * Retry only the post-commit Sheet cleanup:
 *   node --env-file=.env scripts/reset-betano-diario.mjs --retry-sheet --snapshot-token=<sha256>
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import pg from 'pg';
import { google } from 'googleapis';
import {
  argumentValue,
  BETANO_DIARIO_RESET_TABLES,
  buildSheetControlRanges,
  compareResetManifest,
  partitionInventoryTables,
  resetQueryParams,
  resetSnapshotToken,
  summarizeMoney,
} from './lib/reset-betano-diario.runtime.mjs';

const SLUG = 'betano-diario';
const LEGACY_METRICS_HOUSE = 'betano';
const OPERATION = 'reset-betano-diario-v2';
const SNAPSHOT_ROOT = join(tmpdir(), 'betano-diario-reset');
const SHEET_ID = process.env.BETANO_DIARIO_SHEET_ID;
const SHEET_TAB = process.env.BETANO_DIARIO_SHEET_TAB ?? 'LINKS';
const connectionString = process.env.DATABASE_URL;

if (!connectionString) throw new Error('DATABASE_URL ausente');
if (!SHEET_ID) throw new Error('BETANO_DIARIO_SHEET_ID ausente');

const apply = process.argv.includes('--apply');
const retrySheet = process.argv.includes('--retry-sheet');
const suppliedToken = argumentValue(process.argv, '--snapshot-token');
if (apply && retrySheet)
  throw new Error('Use somente --apply ou --retry-sheet');
if ((apply || retrySheet) && !suppliedToken) {
  throw new Error('--snapshot-token=<sha256> e obrigatorio');
}

function makeClient() {
  return new pg.Client({ connectionString });
}

function sheetClient() {
  const required = [
    'GOOGLE_TYPE',
    'GOOGLE_PROJECT_ID',
    'GOOGLE_PRIVATE_KEY_ID',
    'GOOGLE_PRIVATE_KEY',
    'GOOGLE_CLIENT_EMAIL',
    'GOOGLE_CLIENT_ID',
  ];
  for (const key of required) {
    if (!process.env[key]) throw new Error(`${key} ausente`);
  }
  const auth = new google.auth.GoogleAuth({
    credentials: {
      type: process.env.GOOGLE_TYPE,
      project_id: process.env.GOOGLE_PROJECT_ID,
      private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      client_id: process.env.GOOGLE_CLIENT_ID,
      universe_domain: process.env.GOOGLE_UNIVERSE_DOMAIN ?? 'googleapis.com',
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

const requestIds = `SELECT id FROM link_requests WHERE "bettingHouseSlug" = $1`;
const withdrawalIds = `SELECT id FROM withdrawal_requests WHERE "bettingHouse" = $1`;
const rankingIds = `SELECT id FROM ranking_prizes WHERE "bettingHouse" = $1`;
const prizeVersionIds = `SELECT id FROM cpa_prize_rule_versions WHERE "bettingHouse" = $1`;

const predicates = {
  link_webhook_deliveries: `"linkRequestId" IN (${requestIds}) OR payload->>'bettingHouse' = $1 OR payload->>'bettingHouseSlug' = $1 OR payload->>'houseSlug' = $1`,
  affiliate_api_link_request_logs: `"bettingHouseSlug" = $1`,
  link_assignment_logs: `"houseSlug" = $1`,
  backfill_runs: `"houseSlug" = $1`,
  gateway_webhook_events: `"withdrawalId" IN (${withdrawalIds})`,
  whatsapp_send_logs: `"withdrawalId" IN (${withdrawalIds})`,
  notifications: `metadata->>'bettingHouse' = $1 OR metadata->>'bettingHouseSlug' = $1 OR metadata->>'houseSlug' = $1 OR metadata->>'linkRequestId' IN (${requestIds}) OR metadata->>'withdrawalId' IN (${withdrawalIds})`,
  prize_winners: `"rankingPrizeId" IN (${rankingIds})`,
  rank_prizes: `"rankingPrizeId" IN (${rankingIds})`,
  ranking_prizes: `"bettingHouse" = $1`,
  cpa_prize_logs: `"bettingHouse" = $1 OR "ruleVersionId" IN (${prizeVersionIds})`,
  cpa_prize_awards: `"bettingHouse" = $1 OR "ruleVersionId" IN (${prizeVersionIds})`,
  cpa_prize_progress: `"ruleVersionId" IN (${prizeVersionIds})`,
  cpa_prize_rule_versions: `"bettingHouse" = $1`,
  withdrawal_day_releases: `"bettingHouse" = $1`,
  withdrawal_requests: `"bettingHouse" = $1`,
  affiliate_data_change_logs: `"bettingHouse" = $1 OR ("bettingHouse" = '${LEGACY_METRICS_HOUSE}' AND "campaignId" = ANY($2::text[]))`,
  affiliate_data: `"bettingHouse" = $1 OR ("bettingHouse" = '${LEGACY_METRICS_HOUSE}' AND "campaignId" = ANY($2::text[]))`,
  financial_ledger: `"bettingHouse" = $1`,
  commission_logs: `"bettingHouse" = $1`,
  fraud_logs: `"bettingHouse" = $1`,
  fraud_counts: `"bettingHouse" = $1`,
  balance_adjustments: `"bettingHouse" = $1`,
  notification_snapshots: `"bettingHouse" = $1`,
  provider_account_houses: `"bettingHouseSlug" = $1`,
  house_link_rule_change_logs: `"houseSlug" = $1`,
  link_requests: `"bettingHouseSlug" = $1`,
  deals: `"bettingHouseSlug" = $1`,
  house_link_rules: `"houseSlug" = $1`,
  sync_logs: `"bettingHouse" = $1`,
  affiliate_links: `"bettingHouse" = $1`,
};

for (const table of BETANO_DIARIO_RESET_TABLES) {
  if (!predicates[table]) throw new Error(`Predicado ausente para ${table}`);
}

async function readCampaigns(client) {
  const result = await client.query(
    `SELECT DISTINCT "campaignId" FROM affiliate_links
     WHERE "bettingHouse" = $1 ORDER BY "campaignId"`,
    [SLUG],
  );
  return result.rows.map((row) => row.campaignId);
}

async function loadTable(client, table, campaignIds) {
  const where = predicates[table];
  const params = resetQueryParams(where, SLUG, campaignIds);
  const [summary, rows] = await Promise.all([
    client.query(
      `SELECT count(*)::int AS count,
              md5(COALESCE(string_agg(id::text, ',' ORDER BY id::text), '')) AS fingerprint
       FROM ${table} WHERE ${where}`,
      params,
    ),
    client.query(`SELECT * FROM ${table} WHERE ${where} ORDER BY id`, params),
  ]);
  return {
    manifest: summary.rows[0],
    rows: rows.rows,
  };
}

async function detectUnknownScopedTables(client) {
  const columns = await client.query(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND column_name IN ('bettingHouse', 'bettingHouseSlug', 'houseSlug')`,
  );
  const candidates = [
    ...new Map(
      columns.rows.map((row) => [row.table_name, row.column_name]),
    ).entries(),
  ].filter(([table]) => table !== 'betting_houses');
  const { unknown } = partitionInventoryTables(
    candidates.map(([table]) => table),
  );
  const targeted = [];
  for (const table of unknown) {
    const column = candidates.find(([candidate]) => candidate === table)?.[1];
    const result = await client.query(
      `SELECT count(*)::int AS count FROM ${table} WHERE "${column}" = $1`,
      [SLUG],
    );
    if (result.rows[0].count > 0)
      targeted.push({ table, column, count: result.rows[0].count });
  }
  return targeted;
}

async function readSheetState() {
  const sheets = sheetClient();
  const escaped = SHEET_TAB.replaceAll("'", "''");
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `'${escaped}'!A1:ZZ`,
  });
  const values = response.data.values ?? [];
  const headers = (values[0] ?? []).map(String);
  const normalized = headers.map((header) => header.trim().toUpperCase());
  const linkIndex = normalized.indexOf('LINK');
  const statusIndex = normalized.indexOf('STATUS');
  const emailIndex = normalized.indexOf('E-MAIL');
  if ([linkIndex, statusIndex, emailIndex].some((index) => index < 0)) {
    throw new Error('A aba LINKS precisa dos cabecalhos LINK, STATUS e E-MAIL');
  }
  const duplicateHeaders = ['LINK', 'STATUS', 'E-MAIL'].filter(
    (header) => normalized.filter((value) => value === header).length !== 1,
  );
  if (duplicateHeaders.length)
    throw new Error(`Cabecalho duplicado: ${duplicateHeaders.join(', ')}`);
  const lastRow = Math.max(values.length, 1);
  return {
    headers,
    lastRow,
    controlRanges: buildSheetControlRanges(SHEET_TAB, headers, lastRow),
    rows: values.slice(1).map((row, index) => ({
      row: index + 2,
      link: row[linkIndex] ?? '',
      status: row[statusIndex] ?? '',
      email: row[emailIndex] ?? '',
    })),
  };
}

async function buildSnapshot(client) {
  const campaignIds = await readCampaigns(client);
  const tables = {};
  const manifest = {};
  for (const table of BETANO_DIARIO_RESET_TABLES) {
    const loaded = await loadTable(client, table, campaignIds);
    tables[table] = loaded.rows;
    manifest[table] = loaded.manifest;
  }
  const unknownScopedTables = await detectUnknownScopedTables(client);
  const modifiedCpaPrizeRules = (
    await client.query(
      `SELECT * FROM cpa_prize_rules
       WHERE "currentVersionId" IN (${prizeVersionIds}) ORDER BY id`,
      [SLUG],
    )
  ).rows;
  const sheet = await readSheetState();
  return {
    operation: OPERATION,
    generatedAt: new Date().toISOString(),
    slug: SLUG,
    campaignIds,
    manifest,
    totals: {
      affiliateCpaValue: summarizeMoney(
        tables.affiliate_data.map((row) => row.cpaValue),
      ),
      withdrawals: summarizeMoney(
        tables.withdrawal_requests.map((row) => row.amount),
      ),
      balanceAdjustments: summarizeMoney(
        tables.balance_adjustments.map((row) => row.amount),
      ),
      ledger: summarizeMoney(tables.financial_ledger.map((row) => row.amount)),
    },
    unknownScopedTables,
    modifiedCpaPrizeRules,
    sheet,
    tables,
  };
}

async function writeSnapshot(snapshot) {
  const token = resetSnapshotToken(snapshot);
  const directory = join(
    SNAPSHOT_ROOT,
    snapshot.generatedAt.replaceAll(/[:.]/g, '-'),
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'snapshot.json');
  await writeFile(
    path,
    `${JSON.stringify({ ...snapshot, snapshotToken: token }, null, 2)}\n`,
    { mode: 0o600 },
  );
  return { path, token };
}

async function findSnapshot(token) {
  const directories = await readdir(SNAPSHOT_ROOT, {
    withFileTypes: true,
  }).catch(() => []);
  for (const entry of directories) {
    if (!entry.isDirectory()) continue;
    const path = join(SNAPSHOT_ROOT, entry.name, 'snapshot.json');
    const snapshot = JSON.parse(await readFile(path, 'utf8'));
    if (snapshot.snapshotToken !== token) continue;
    if (resetSnapshotToken(snapshot) !== token)
      throw new Error('Digest do snapshot e invalido');
    if (snapshot.operation !== OPERATION || snapshot.slug !== SLUG)
      throw new Error('Snapshot pertence a outra operacao');
    return { path, snapshot };
  }
  throw new Error(`Snapshot ${token} nao encontrado em ${SNAPSHOT_ROOT}`);
}

async function clearAndVerifySheet(snapshot, token) {
  const sheets = sheetClient();
  if (snapshot.sheet.controlRanges.length) {
    await sheets.spreadsheets.values.batchClear({
      spreadsheetId: SHEET_ID,
      requestBody: { ranges: snapshot.sheet.controlRanges },
    });
  }
  const after = await readSheetState();
  const beforeLinks = snapshot.sheet.rows
    .filter(({ link }) => link !== '')
    .map(({ row, link }) => ({ row, link }));
  const afterLinks = after.rows
    .filter(({ link }) => link !== '')
    .map(({ row, link }) => ({ row, link }));
  if (JSON.stringify(beforeLinks) !== JSON.stringify(afterLinks)) {
    throw new Error(
      'Os links da aba LINKS mudaram durante a limpeza; revisar manualmente',
    );
  }
  const dirty = after.rows.filter(
    (row) => row.status !== '' || row.email !== '',
  );
  if (dirty.length)
    throw new Error(`${dirty.length} linhas ainda possuem STATUS/E-MAIL`);
  console.log(
    `SHEET_OK token=${token} urls=${after.rows.filter((row) => row.link).length}`,
  );
}

async function currentManifest(client, campaignIds) {
  const manifest = {};
  for (const table of BETANO_DIARIO_RESET_TABLES) {
    manifest[table] = (await loadTable(client, table, campaignIds)).manifest;
  }
  return manifest;
}

async function deleteTargets(client, campaignIds) {
  await client.query(
    `UPDATE cpa_prize_rules SET "currentVersionId" = NULL
     WHERE "currentVersionId" IN (${prizeVersionIds})`,
    [SLUG],
  );
  const deleted = {};
  for (const table of BETANO_DIARIO_RESET_TABLES) {
    const where = predicates[table];
    const result = await client.query(
      `DELETE FROM ${table} WHERE ${where}`,
      resetQueryParams(where, SLUG, campaignIds),
    );
    deleted[table] = result.rowCount;
  }
  return deleted;
}

async function seedCanonical(client, token) {
  await client.query(
    `INSERT INTO betting_houses
       (id, name, slug, active, "syncMode", "withdrawalEnabled", "minAvgDepositPerCpa", "minWithdrawalAmount", "minCpaToWithdraw", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, 'Betano Diário', $1, true, 'AUTO', true, 20, 100, 0, now(), now())
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name, active = true, "syncMode" = 'AUTO',
       "withdrawalEnabled" = true, "minAvgDepositPerCpa" = 20,
       "minWithdrawalAmount" = 100, "minCpaToWithdraw" = 0,
       "withdrawalDay" = NULL, "withdrawalDayEnd" = NULL,
       "withdrawalDay2" = NULL, "withdrawalDay2End" = NULL,
       "withdrawalWeekday" = NULL, "lastSyncAt" = NULL, "updatedAt" = now()`,
    [SLUG],
  );
  const deal = await client.query(
    `INSERT INTO deals
       (id, "bettingHouseSlug", name, cpa, revshare, baseline, "minAvgDepositPerFtd", "minQualifiedFtd", "paymentCpaLabel", "conditionsText", "paymentNotes", active, "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, 'Betano Diário', 60, 0, 0, 20, 10,
       'R$ 60 por CPA qualificado', 'Depósito médio mínimo de R$ 20 para saque.',
       'Saque mínimo de R$ 100.', true, now(), now()) RETURNING id`,
    [SLUG],
  );
  const rule = await client.query(
    `INSERT INTO house_link_rules
       (id, "houseSlug", "ruleType", "defaultCpa", "fallbackCpa", "inviterCpaDiscount",
        "defaultRevshare", "requestEnabled", "autoAssignEnabled", "applyFallbackNoInviterCpa",
        "processOldRequests", "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, 'INVITER_DISCOUNT', 60, 60, 5, 0,
       true, true, false, true, now(), now()) RETURNING id`,
    [SLUG],
  );
  await client.query(
    `INSERT INTO settings (id, key, value, label, "createdAt", "updatedAt")
     VALUES (gen_random_uuid()::text, 'deal_eligibility_window_days', '30',
       'Janela de elegibilidade de deals (dias)', now(), now())
     ON CONFLICT (key) DO UPDATE SET value = '30', label = EXCLUDED.label, "updatedAt" = now()`,
  );
  await client.query(
    `INSERT INTO audit_logs
       (id, "userName", "userEmail", action, resource, method, path, details, "createdAt")
     VALUES (gen_random_uuid()::text, 'system', 'system@local', 'RESET_BETANO_DIARIO',
       'BettingHouse', 'SCRIPT', '/scripts/reset-betano-diario.mjs',
       jsonb_build_object(
         'operation', $1::text,
         'snapshotToken', $2::text,
         'dealId', $3::text,
         'houseRuleId', $4::text
       ), now())`,
    [OPERATION, token, deal.rows[0].id, rule.rows[0].id],
  );
}

async function verifyDatabase(campaignIds, token) {
  const client = makeClient();
  await client.connect();
  try {
    const manifest = await currentManifest(client, campaignIds);
    const nonZeroOperational = Object.entries(manifest).filter(
      ([table, entry]) =>
        !['deals', 'house_link_rules'].includes(table) && entry.count !== 0,
    );
    if (nonZeroOperational.length)
      throw new Error(`Alvos restantes: ${JSON.stringify(nonZeroOperational)}`);
    const canonical = await client.query(
      `SELECT
         (SELECT count(*)::int FROM deals WHERE "bettingHouseSlug"=$1 AND active AND cpa=60 AND revshare=0 AND "minAvgDepositPerFtd"=20 AND "minQualifiedFtd"=10) AS deals,
         (SELECT count(*)::int FROM house_link_rules WHERE "houseSlug"=$1 AND "defaultCpa"=60 AND "inviterCpaDiscount"=5 AND "defaultRevshare"=0 AND "applyFallbackNoInviterCpa"=false) AS rules,
         (SELECT count(*)::int FROM betting_houses WHERE slug=$1 AND active AND "syncMode"='AUTO' AND "minAvgDepositPerCpa"=20 AND "minWithdrawalAmount"=100) AS houses,
         (SELECT count(*)::int FROM audit_logs WHERE action='RESET_BETANO_DIARIO' AND details->>'snapshotToken'=$2) AS audits`,
      [SLUG, token],
    );
    const result = canonical.rows[0];
    if (
      result.deals !== 1 ||
      result.rules !== 1 ||
      result.houses !== 1 ||
      result.audits !== 1
    ) {
      throw new Error(
        `Configuracao canonica invalida: ${JSON.stringify(result)}`,
      );
    }
    console.log(`DB_OK token=${token}`);
  } finally {
    await client.end();
  }
}

async function preview() {
  const client = makeClient();
  await client.connect();
  try {
    const snapshot = await buildSnapshot(client);
    const { path, token } = await writeSnapshot(snapshot);
    console.log(
      JSON.stringify(
        {
          mode: 'preview',
          path,
          token,
          campaigns: snapshot.campaignIds.length,
          manifest: snapshot.manifest,
          totals: snapshot.totals,
          unknownScopedTables: snapshot.unknownScopedTables,
        },
        null,
        2,
      ),
    );
    console.log(
      `APPLY: node --env-file=.env scripts/reset-betano-diario.mjs --apply --snapshot-token=${token}`,
    );
  } finally {
    await client.end();
  }
}

async function applySnapshot() {
  const { path, snapshot } = await findSnapshot(suppliedToken);
  if (snapshot.unknownScopedTables.length) {
    throw new Error(
      `Snapshot possui tabelas futuras nao tratadas: ${JSON.stringify(snapshot.unknownScopedTables)}`,
    );
  }
  const client = makeClient();
  await client.connect();
  try {
    const liveCampaigns = await readCampaigns(client);
    if (
      JSON.stringify(liveCampaigns) !== JSON.stringify(snapshot.campaignIds)
    ) {
      throw new Error('Drift no conjunto de campanhas; gere um novo preview');
    }
    const live = await currentManifest(client, snapshot.campaignIds);
    const drift = compareResetManifest(snapshot.manifest, live);
    if (drift.length)
      throw new Error(
        `Drift detectado; gere novo preview:\n${drift.join('\n')}`,
      );
    const currentPrizeRules = (
      await client.query(
        `SELECT * FROM cpa_prize_rules
         WHERE "currentVersionId" IN (${prizeVersionIds}) ORDER BY id`,
        [SLUG],
      )
    ).rows;
    if (
      JSON.stringify(currentPrizeRules) !==
      JSON.stringify(snapshot.modifiedCpaPrizeRules)
    ) {
      throw new Error(
        'Drift nas regras de premio vinculadas; gere um novo preview',
      );
    }
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    try {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        OPERATION,
      ]);
      await client.query(
        `UPDATE betting_houses SET active=false, "syncMode"='MANUAL', "updatedAt"=now() WHERE slug=$1`,
        [SLUG],
      );
      const deleted = await deleteTargets(client, snapshot.campaignIds);
      await seedCanonical(client, suppliedToken);
      await client.query('COMMIT');
      console.log(
        JSON.stringify({ mode: 'apply', snapshot: path, deleted }, null, 2),
      );
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    await client.end();
  }
  await verifyDatabase(snapshot.campaignIds, suppliedToken);
  try {
    await clearAndVerifySheet(snapshot, suppliedToken);
  } catch (error) {
    console.error(
      `SHEET_INCONSISTENT: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error(
      `RETRY: node --env-file=.env scripts/reset-betano-diario.mjs --retry-sheet --snapshot-token=${suppliedToken}`,
    );
    process.exitCode = 2;
  }
}

if (retrySheet) {
  const { snapshot } = await findSnapshot(suppliedToken);
  await clearAndVerifySheet(snapshot, suppliedToken);
} else if (apply) {
  await applySnapshot();
} else {
  await preview();
}

import pg from 'pg';
import { google } from 'googleapis';
import {
  chmod,
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  assertRollbackState,
  sha256,
  stableJson,
  validateBackup,
} from './lib/pinbet-diario-mensal-migration.mjs';
import { createPinbetBalanceSnapshot } from './pinbet-balance-snapshot.mjs';

const DAILY = 'pinbet-diario';
const MONTHLY = 'pinbet-mensal';
const OUTPUT_ROOT = resolve(
  process.cwd(),
  '../output/pinbet-diario-mensal',
);
const command = process.argv[2] ?? 'preview';
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const required = (value, message) => {
  if (!value) throw new Error(message);
  return value;
};
const connectionString = required(
  process.env.DATABASE_URL,
  'DATABASE_URL não configurada',
);
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const money = (rows, field) =>
  rows.reduce((sum, row) => sum + Number(row[field] ?? 0), 0).toFixed(2);
const idsEqual = (left, right) =>
  [...left].sort().join('|') === [...right].sort().join('|');
const writePrivateJson = async (path, value) => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${stableJson(value)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
};

const getSheetClient = () => {
  const sheetId =
    process.env.PINBET_MENSAL_SHEET_ID || process.env.PINBET_SHEET_ID;
  if (!sheetId) throw new Error('Planilha Pinbet não configurada');
  const auth = new google.auth.GoogleAuth({
    credentials: {
      type: process.env.GOOGLE_TYPE,
      project_id: process.env.GOOGLE_PROJECT_ID,
      private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
      private_key: required(
        process.env.GOOGLE_PRIVATE_KEY,
        'GOOGLE_PRIVATE_KEY ausente',
      ).replace(/\\n/g, '\n'),
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      client_id: process.env.GOOGLE_CLIENT_ID,
      universe_domain: process.env.GOOGLE_UNIVERSE_DOMAIN ?? 'googleapis.com',
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return {
    sheets: google.sheets({ version: 'v4', auth }),
    dailySheetId: process.env.PINBET_SHEET_ID || sheetId,
    monthlySheetId: sheetId,
    dailyTab: process.env.PINBET_SHEET_TAB || 'Diário',
    monthlyTab: process.env.PINBET_MENSAL_SHEET_TAB || 'Mensal',
  };
};

const readSheets = async () => {
  const cfg = getSheetClient();
  const [daily, monthly] = await Promise.all([
    cfg.sheets.spreadsheets.values.get({
      spreadsheetId: cfg.dailySheetId,
      range: `${cfg.dailyTab}!A2:E`,
    }),
    cfg.sheets.spreadsheets.values.get({
      spreadsheetId: cfg.monthlySheetId,
      range: `${cfg.monthlyTab}!A2:E`,
    }),
  ]);
  return {
    config: {
      dailySheetId: cfg.dailySheetId,
      monthlySheetId: cfg.monthlySheetId,
      dailyTab: cfg.dailyTab,
      monthlyTab: cfg.monthlyTab,
    },
    daily: daily.data.values ?? [],
    monthly: monthly.data.values ?? [],
  };
};

const rows = async (client, sql, params = []) =>
  (await client.query(sql, params)).rows;

const collectDatabaseState = async (client) => {
  const [
    identity,
    dailyLinks,
    monthlyLinks,
    dailyData,
    dailyWithdrawals,
    monthlyWithdrawalsNull,
    dailyAdjustments,
    monthlyAdjustments,
    houses,
    providerMappings,
    syncPaused,
    fraud,
    runningSync,
    campaignCollisions,
    dataCollisions,
    adjustmentConflicts,
  ] = await Promise.all([
    rows(
      client,
      'SELECT current_database() AS database, current_user AS "user"',
    ),
    rows(
      client,
      `SELECT * FROM affiliate_links WHERE "bettingHouse"=$1 AND "deletedAt" IS NULL ORDER BY id`,
      [DAILY],
    ),
    rows(
      client,
      `SELECT * FROM affiliate_links WHERE "bettingHouse"=$1 AND "deletedAt" IS NULL ORDER BY id`,
      [MONTHLY],
    ),
    rows(
      client,
      `SELECT * FROM affiliate_data WHERE "bettingHouse"=$1 ORDER BY id`,
      [DAILY],
    ),
    rows(
      client,
      `SELECT * FROM withdrawal_requests WHERE "bettingHouse"=$1 ORDER BY id`,
      [DAILY],
    ),
    rows(
      client,
      `SELECT * FROM withdrawal_requests WHERE "bettingHouse"=$1 AND "pinbetDimension" IS NULL ORDER BY id`,
      [MONTHLY],
    ),
    rows(
      client,
      `SELECT * FROM balance_adjustments WHERE "bettingHouse"=$1 ORDER BY id`,
      [DAILY],
    ),
    rows(
      client,
      `SELECT * FROM balance_adjustments WHERE "bettingHouse"=$1 ORDER BY id`,
      [MONTHLY],
    ),
    rows(
      client,
      `SELECT * FROM betting_houses WHERE slug IN ($1,$2) ORDER BY slug`,
      [DAILY, MONTHLY],
    ),
    rows(
      client,
      `SELECT * FROM provider_account_houses WHERE "bettingHouseSlug" IN ($1,$2) ORDER BY id`,
      [DAILY, MONTHLY],
    ),
    rows(client, `SELECT * FROM settings WHERE key='sync_paused'`),
    rows(
      client,
      `SELECT * FROM fraud_counts WHERE "bettingHouse"=$1 ORDER BY id`,
      [DAILY],
    ),
    rows(
      client,
      `SELECT id,"bettingHouse","startTime" FROM sync_logs WHERE "bettingHouse" IN ($1,$2) AND status='RUNNING' ORDER BY id`,
      [DAILY, MONTHLY],
    ),
    rows(
      client,
      `SELECT d.id AS "dailyId",m.id AS "monthlyId",d."campaignId" FROM affiliate_links d JOIN affiliate_links m ON m."campaignId"=d."campaignId" AND m."bettingHouse"=$2 AND m."deletedAt" IS NULL WHERE d."bettingHouse"=$1 AND d."deletedAt" IS NULL`,
      [DAILY, MONTHLY],
    ),
    rows(
      client,
      `SELECT d.id AS "dailyId",m.id AS "monthlyId" FROM affiliate_data d JOIN affiliate_data m ON m."campaignId"=d."campaignId" AND m."bettingHouse"=$2 AND m.date=d.date AND m."campaignName"=d."campaignName" AND m."utmCampaign"=d."utmCampaign" WHERE d."bettingHouse"=$1 LIMIT 20`,
      [DAILY, MONTHLY],
    ),
    rows(
      client,
      `SELECT d.id AS "dailyId",m.id AS "monthlyId",d."userId" FROM balance_adjustments d JOIN balance_adjustments m ON m."userId"=d."userId" AND m."bettingHouse"=$2 WHERE d."bettingHouse"=$1`,
      [DAILY, MONTHLY],
    ),
  ]);
  const pending = dailyWithdrawals.filter((row) => row.status === 'PENDING');
  const pendingGateway = pending.filter(
    (row) => row.gatewayId || row.gatewaySentAt,
  );
  return {
    identity: identity[0],
    tables: {
      dailyLinks,
      monthlyLinks,
      dailyData,
      dailyWithdrawals,
      monthlyWithdrawalsNull,
      dailyAdjustments,
      monthlyAdjustments,
      houses,
      providerMappings,
      syncPaused,
    },
    checks: {
      fraud,
      runningSync,
      campaignCollisions,
      dataCollisions,
      adjustmentConflicts,
      pendingGateway,
    },
    pending,
  };
};

const assertSafeState = (state) => {
  const failures = Object.entries(state.checks).filter(
    ([, value]) => value.length > 0,
  );
  if (failures.length > 0) {
    throw new Error(
      `Pré-condições falharam: ${failures.map(([name, value]) => `${name}=${value.length}`).join(', ')}`,
    );
  }
};

const fingerprint = (state, sheets) => ({
  database: state.identity.database,
  user: state.identity.user,
  tables: Object.fromEntries(
    Object.entries(state.tables).map(([label, tableRows]) => [
      label,
      tableRows.map((row) => ({
        id: row.id,
        updatedAt: row.updatedAt ?? null,
        status: row.status ?? null,
      })),
    ]),
  ),
  pending: state.pending.map((row) => ({
    id: row.id,
    status: row.status,
    gatewayId: row.gatewayId,
    gatewaySentAt: row.gatewaySentAt,
  })),
  sheets: {
    daily: sheets.daily,
    monthly: sheets.monthly,
  },
});

const summarize = (state, sheets) => ({
  database: state.identity.database,
  databaseUser: state.identity.user,
  dailyLinks: state.tables.dailyLinks.length,
  monthlyLinks: state.tables.monthlyLinks.length,
  dailyData: state.tables.dailyData.length,
  dailyNetPl: money(state.tables.dailyData, 'netPl'),
  dailyWithdrawals: state.tables.dailyWithdrawals.length,
  dailyWithdrawalGross: money(
    state.tables.dailyWithdrawals,
    'originalAmount',
  ),
  pending: state.pending.length,
  pendingGross: money(state.pending, 'originalAmount'),
  pendingNet: money(state.pending, 'amount'),
  dailyAdjustments: state.tables.dailyAdjustments.length,
  monthlyAdjustments: state.tables.monthlyAdjustments.length,
  dailySheetRows: sheets.daily.length,
  monthlySheetRows: sheets.monthly.length,
  blockers: Object.fromEntries(
    Object.entries(state.checks).map(([key, value]) => [key, value.length]),
  ),
});

const loadFreshState = async () => {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const [state, sheets] = await Promise.all([
      collectDatabaseState(client),
      readSheets(),
    ]);
    await client.query('ROLLBACK');
    return { state, sheets };
  } finally {
    await client.end();
  }
};

const preview = async () => {
  const { state, sheets } = await loadFreshState();
  const previewToken = sha256(stableJson(fingerprint(state, sheets)));
  const document = {
    createdAt: new Date().toISOString(),
    previewToken,
    summary: summarize(state, sheets),
  };
  await writePrivateJson(resolve(OUTPUT_ROOT, 'latest-preview.json'), document);
  console.table([document.summary]);
  console.log(`Token da prévia: ${previewToken}`);
  assertSafeState(state);
  return document;
};

const deriveExpectedAfter = (backup, timestamp) => {
  const rejectNote = (value) => {
    const note = 'Cancelado na migração Pinbet Diário para Mensal';
    return value ? `${value}\n${note}` : note;
  };
  return {
    dailyLinks: backup.tables.dailyLinks.map((row) => ({
      ...row,
      bettingHouse: MONTHLY,
      linkType: 'afp1',
      updatedAt: timestamp,
    })),
    monthlyLinks: backup.tables.monthlyLinks.map((row) => ({
      ...row,
      linkType: row.linkType || 'afp2',
      updatedAt: row.linkType ? row.updatedAt : timestamp,
    })),
    dailyData: backup.tables.dailyData.map((row) => ({
      ...row,
      bettingHouse: MONTHLY,
      updatedAt: timestamp,
    })),
    dailyWithdrawals: backup.tables.dailyWithdrawals.map((row) => ({
      ...row,
      bettingHouse: MONTHLY,
      pinbetDimension: 'AFP1',
      status: row.status === 'PENDING' ? 'REJECTED' : row.status,
      adminNote:
        row.status === 'PENDING' ? rejectNote(row.adminNote) : row.adminNote,
      updatedAt: timestamp,
    })),
    monthlyWithdrawalsNull: backup.tables.monthlyWithdrawalsNull.map((row) => ({
      ...row,
      pinbetDimension: 'AFP2',
      updatedAt: timestamp,
    })),
    dailyAdjustments: backup.tables.dailyAdjustments.map((row) => ({
      ...row,
      bettingHouse: MONTHLY,
      pinbetDimension: 'AFP1',
      reason: [row.reason, 'Origem: pinbet-diario; dimensão: afp1']
        .filter(Boolean)
        .join('\n'),
      updatedAt: timestamp,
    })),
    monthlyAdjustments: backup.tables.monthlyAdjustments.map((row) => ({
      ...row,
      pinbetDimension: row.pinbetDimension || 'AFP2',
      updatedAt: row.pinbetDimension ? row.updatedAt : timestamp,
    })),
  };
};

const backupAndManifest = async (batchDir, state, sheets, batchId, timestamp) => {
  const backup = {
    version: 1,
    batchId,
    createdAt: new Date().toISOString(),
    operationTimestamp: timestamp,
    database: state.identity,
    tables: state.tables,
    checks: state.checks,
    pendingIds: state.pending.map((row) => row.id),
    sheets,
  };
  backup.expectedAfter = deriveExpectedAfter(backup, timestamp);
  const manifest = {
    batchId,
    createdAt: backup.createdAt,
    backupSha256: sha256(stableJson(backup)),
    counts: Object.fromEntries(
      Object.entries(backup.tables).map(([label, value]) => [
        label,
        value.length,
      ]),
    ),
  };
  const backupPath = resolve(batchDir, 'backup.json');
  const manifestPath = resolve(batchDir, 'manifest.json');
  await writePrivateJson(backupPath, backup);
  await writePrivateJson(manifestPath, manifest);
  const rereadBackup = JSON.parse(await readFile(backupPath, 'utf8'));
  const rereadManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  validateBackup(rereadBackup, rereadManifest);
  return { backup: rereadBackup, manifest: rereadManifest, backupPath };
};

const assertLockedStateMatches = async (client, backup) => {
  const current = await collectDatabaseState(client);
  assertSafeState(current);
  for (const label of Object.keys(backup.tables)) {
    if (label === 'syncPaused') continue;
    const expectedIds = backup.tables[label].map((row) => row.id);
    const currentIds = current.tables[label].map((row) => row.id);
    if (!idsEqual(expectedIds, currentIds)) {
      throw new Error(`Drift detectado em ${label}`);
    }
  }
  return current;
};

const quiesceAndCancel = async (client, backup, timestamp) => {
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext('pinbet-diario-to-mensal-v1'))`,
    );
    const running = await rows(
      client,
      `SELECT id FROM sync_logs WHERE "bettingHouse" IN ($1,$2) AND status='RUNNING'`,
      [DAILY, MONTHLY],
    );
    if (running.length) throw new Error('Sync Pinbet em execução');
    await client.query(
      `INSERT INTO settings (id,key,value,label,"createdAt","updatedAt") VALUES ($1,'sync_paused','true','Pausa global de sincronização',now(),$2) ON CONFLICT (key) DO UPDATE SET value='true',"updatedAt"=$2`,
      [randomUUID(), timestamp],
    );
    await client.query(
      `UPDATE betting_houses SET active=false,"syncMode"='MANUAL',"withdrawalEnabled"=false,"updatedAt"=$3 WHERE slug IN ($1,$2)`,
      [DAILY, MONTHLY, timestamp],
    );
    await client.query(
      `INSERT INTO settings (id,key,value,label,"createdAt","updatedAt") VALUES ($1,'pinbet_mensal_assignment_paused','true','Pausa de atribuições Pinbet Mensal',now(),$2) ON CONFLICT (key) DO UPDATE SET value='true',"updatedAt"=$2`,
      [randomUUID(), timestamp],
    );
    const cancelled = backup.pendingIds.length
      ? await rows(
          client,
          `UPDATE withdrawal_requests SET status='REJECTED',"adminNote"=CASE WHEN "adminNote"='' THEN 'Cancelado na migração Pinbet Diário para Mensal' ELSE "adminNote" || E'\nCancelado na migração Pinbet Diário para Mensal' END,"updatedAt"=$2 WHERE id=ANY($1::text[]) AND "bettingHouse"=$3 AND status='PENDING' AND "gatewayId" IS NULL AND "gatewaySentAt" IS NULL RETURNING id`,
          [backup.pendingIds, timestamp, DAILY],
        )
      : [];
    if (!idsEqual(cancelled.map((row) => row.id), backup.pendingIds)) {
      throw new Error('Pendentes mudaram antes do cancelamento');
    }
    await client.query('COMMIT');
    return cancelled.length;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
};

const migrateDatabase = async (client, backup, manifest, timestamp) => {
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext('pinbet-diario-to-mensal-v1'))`,
    );
    await client.query(
      `LOCK TABLE affiliate_links, affiliate_data, withdrawal_requests, balance_adjustments, provider_account_houses, betting_houses IN SHARE ROW EXCLUSIVE MODE`,
    );
    await assertLockedStateMatches(client, backup);
    const running = await rows(
      client,
      `SELECT id FROM sync_logs WHERE "bettingHouse" IN ($1,$2) AND status='RUNNING'`,
      [DAILY, MONTHLY],
    );
    if (running.length) throw new Error('Sync iniciou durante a migração');

    const updates = {};
    updates.monthlyLinks = (
      await client.query(
        `UPDATE affiliate_links SET "linkType"='afp2',"updatedAt"=$2 WHERE "bettingHouse"=$1 AND "deletedAt" IS NULL AND coalesce("linkType",'')=''`,
        [MONTHLY, timestamp],
      )
    ).rowCount;
    updates.dailyLinks = (
      await client.query(
        `UPDATE affiliate_links SET "bettingHouse"=$2,"linkType"='afp1',"updatedAt"=$3 WHERE "bettingHouse"=$1 AND "deletedAt" IS NULL`,
        [DAILY, MONTHLY, timestamp],
      )
    ).rowCount;
    updates.dailyData = (
      await client.query(
        `UPDATE affiliate_data SET "bettingHouse"=$2,"updatedAt"=$3 WHERE "bettingHouse"=$1`,
        [DAILY, MONTHLY, timestamp],
      )
    ).rowCount;
    updates.monthlyWithdrawals = (
      await client.query(
        `UPDATE withdrawal_requests SET "pinbetDimension"='AFP2',"updatedAt"=$2 WHERE "bettingHouse"=$1 AND "pinbetDimension" IS NULL`,
        [MONTHLY, timestamp],
      )
    ).rowCount;
    updates.monthlyAdjustments = (
      await client.query(
        `UPDATE balance_adjustments SET "pinbetDimension"='AFP2',"updatedAt"=$2 WHERE "bettingHouse"=$1 AND "pinbetDimension" IS NULL`,
        [MONTHLY, timestamp],
      )
    ).rowCount;
    updates.dailyWithdrawals = (
      await client.query(
        `UPDATE withdrawal_requests SET "bettingHouse"=$2,"pinbetDimension"='AFP1',"updatedAt"=$3 WHERE "bettingHouse"=$1`,
        [DAILY, MONTHLY, timestamp],
      )
    ).rowCount;
    updates.dailyAdjustments = (
      await client.query(
        `UPDATE balance_adjustments SET "bettingHouse"=$2,"pinbetDimension"='AFP1',reason=concat_ws(E'\n',nullif(reason,''),'Origem: pinbet-diario; dimensão: afp1'),"updatedAt"=$3 WHERE "bettingHouse"=$1`,
        [DAILY, MONTHLY, timestamp],
      )
    ).rowCount;
    await client.query(
      `UPDATE provider_account_houses SET active=false,"updatedAt"=$2 WHERE "bettingHouseSlug"=$1`,
      [DAILY, timestamp],
    );
    await client.query(
      `UPDATE provider_account_houses SET active=true,"bookmarkerId"='afp1,afp2',"updatedAt"=$2 WHERE "bettingHouseSlug"=$1`,
      [MONTHLY, timestamp],
    );
    await client.query(
      `UPDATE betting_houses SET active=false,"syncMode"='MANUAL',"withdrawalEnabled"=false,"updatedAt"=$2 WHERE slug=$1`,
      [DAILY, timestamp],
    );
    await client.query(
      `UPDATE betting_houses SET active=false,"syncMode"='MANUAL',"withdrawalEnabled"=false,"updatedAt"=$2 WHERE slug=$1`,
      [MONTHLY, timestamp],
    );

    const expected = {
      dailyLinks: backup.tables.dailyLinks.length,
      dailyData: backup.tables.dailyData.length,
      dailyWithdrawals: backup.tables.dailyWithdrawals.length,
      dailyAdjustments: backup.tables.dailyAdjustments.length,
      monthlyWithdrawals: backup.tables.monthlyWithdrawalsNull.length,
      monthlyAdjustments: backup.tables.monthlyAdjustments.filter(
        (row) => !row.pinbetDimension,
      ).length,
      monthlyLinks: backup.tables.monthlyLinks.filter((row) => !row.linkType)
        .length,
    };
    for (const [label, count] of Object.entries(expected)) {
      if (updates[label] !== count) {
        throw new Error(
          `Contagem divergente em ${label}: ${updates[label]} != ${count}`,
        );
      }
    }

    const userIds = [
      ...new Set(backup.tables.dailyLinks.map((row) => row.userId)),
    ];
    const users = userIds.length
      ? await rows(
          client,
          `SELECT id,name,email FROM users WHERE id=ANY($1::text[]) ORDER BY id`,
          [userIds],
        )
      : [];
    const masterDetails = {
      batchId: backup.batchId,
      backupSha256: manifest.backupSha256,
      counts: updates,
    };
    await client.query(
      `INSERT INTO audit_logs (id,"userId","userName","userEmail",action,resource,method,path,"statusCode",details,"createdAt") VALUES ($1,NULL,'SYSTEM','','PINBET_DAILY_TO_MONTHLY','pinbet-migration','SCRIPT','scripts/pinbet-diario-to-mensal.mjs',200,$2::jsonb,$3)`,
      [randomUUID(), JSON.stringify(masterDetails), timestamp],
    );
    for (const user of users) {
      const userLinks = backup.tables.dailyLinks.filter(
        (row) => row.userId === user.id,
      );
      const userWithdrawals = backup.tables.dailyWithdrawals.filter(
        (row) => row.userId === user.id,
      );
      await client.query(
        `INSERT INTO audit_logs (id,"userId","userName","userEmail",action,resource,method,path,"statusCode",details,"createdAt") VALUES ($1,$2,$3,$4,'PINBET_DAILY_TO_MONTHLY_USER','pinbet-migration','SCRIPT','scripts/pinbet-diario-to-mensal.mjs',200,$5::jsonb,$6)`,
        [
          randomUUID(),
          user.id,
          user.name,
          user.email,
          JSON.stringify({
            batchId: backup.batchId,
            backupSha256: manifest.backupSha256,
            links: userLinks.map((row) => ({
              id: row.id,
              campaignId: row.campaignId,
              cpa: row.cpa,
              revshare: row.revshare,
            })),
            withdrawals: userWithdrawals.map((row) => ({
              id: row.id,
              status: row.status,
              originalAmount: row.originalAmount,
            })),
          }),
          timestamp,
        ],
      );
    }
    await client.query('COMMIT');
    return updates;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
};

const mirrorSheets = async (backup) => {
  const cfg = getSheetClient();
  const existingCodes = new Set(
    backup.sheets.monthly.map((row) => String(row[1] ?? '').trim()),
  );
  const append = backup.sheets.daily.filter((row) => {
    const code = String(row[1] ?? '').trim();
    const used = String(row[3] ?? '').trim() || String(row[4] ?? '').trim();
    return code && used && !existingCodes.has(code);
  });
  if (!append.length) return { count: 0, rows: [], range: null };
  const response = await cfg.sheets.spreadsheets.values.append({
    spreadsheetId: cfg.monthlySheetId,
    range: `${cfg.monthlyTab}!A:E`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: append },
  });
  return {
    count: append.length,
    rows: append,
    range: response.data.updates?.updatedRange ?? null,
  };
};

const compareSnapshots = (before, after) => {
  const afterMap = new Map(after.users.map((row) => [row.userId, row.mensal]));
  const divergences = [];
  for (const row of before.users) {
    const actual = afterMap.get(row.userId) ?? { total: 0, withdrawable: 0 };
    if (
      actual.total !== row.expectedMensal.total ||
      actual.withdrawable !== row.expectedMensal.withdrawable
    ) {
      divergences.push({
        userId: row.userId,
        expected: row.expectedMensal,
        actual,
      });
    }
  }
  return divergences;
};

const restoreRows = async (client, table, backupRows) => {
  if (!backupRows.length) return;
  const timestampColumns = (
    await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1
          AND data_type='timestamp without time zone'`,
      [table],
    )
  ).rows.map((row) => row.column_name);
  const offsetSeconds = Number(
    (
      await client.query(
        `SELECT extract(epoch FROM (
          (now() AT TIME ZONE current_setting('TimeZone')) -
          (now() AT TIME ZONE 'UTC')
        ))::int AS seconds`,
      )
    ).rows[0].seconds,
  );
  const adjustedRows = backupRows.map((row) => {
    const adjusted = { ...row };
    for (const column of timestampColumns) {
      const value = adjusted[column];
      if (typeof value === 'string' && value.endsWith('Z')) {
        adjusted[column] = new Date(
          new Date(value).getTime() + offsetSeconds * 1000,
        ).toISOString();
      }
    }
    return adjusted;
  });
  const columns = Object.keys(backupRows[0]).filter((column) => column !== 'id');
  const assignments = columns
    .map((column) => `${quote(column)}=b.${quote(column)}`)
    .join(',');
  await client.query(
    `UPDATE ${quote(table)} t SET ${assignments} FROM jsonb_populate_recordset(NULL::${quote(table)},$1::jsonb) b WHERE t.id=b.id`,
    [JSON.stringify(adjustedRows)],
  );
};

const rollbackDatabase = async (backup, confirm) => {
  if (confirm !== backup.batchId) {
    throw new Error('Rollback exige --confirm igual ao batchId');
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext('pinbet-diario-to-mensal-v1'))`,
    );
    const currentDailyLinks = backup.expectedAfter.dailyLinks.length
      ? await rows(
          client,
          `SELECT * FROM affiliate_links WHERE id=ANY($1::text[]) ORDER BY id`,
          [backup.expectedAfter.dailyLinks.map((row) => row.id)],
        )
      : [];
    const withoutUpdatedAt = (tableRows) =>
      tableRows.map(({ updatedAt: _updatedAt, ...row }) => row);
    assertRollbackState(
      withoutUpdatedAt(currentDailyLinks),
      withoutUpdatedAt(backup.expectedAfter.dailyLinks),
    );
    const currentWithdrawals = backup.expectedAfter.dailyWithdrawals.length
      ? await rows(
          client,
          `SELECT * FROM withdrawal_requests WHERE id=ANY($1::text[]) ORDER BY id`,
          [backup.expectedAfter.dailyWithdrawals.map((row) => row.id)],
        )
      : [];
    assertRollbackState(
      withoutUpdatedAt(currentWithdrawals),
      withoutUpdatedAt(backup.expectedAfter.dailyWithdrawals),
    );
    await restoreRows(client, 'affiliate_links', [
      ...backup.tables.dailyLinks,
      ...backup.tables.monthlyLinks,
    ]);
    await restoreRows(client, 'affiliate_data', backup.tables.dailyData);
    await restoreRows(client, 'withdrawal_requests', [
      ...backup.tables.dailyWithdrawals,
      ...backup.tables.monthlyWithdrawalsNull,
    ]);
    await restoreRows(client, 'balance_adjustments', [
      ...backup.tables.dailyAdjustments,
      ...backup.tables.monthlyAdjustments,
    ]);
    await restoreRows(client, 'provider_account_houses', backup.tables.providerMappings);
    await restoreRows(client, 'betting_houses', backup.tables.houses);
    if (backup.tables.syncPaused.length) {
      await restoreRows(client, 'settings', backup.tables.syncPaused);
    } else {
      await client.query(`DELETE FROM settings WHERE key='sync_paused'`);
    }
    await client.query(
      `INSERT INTO audit_logs (id,"userId","userName","userEmail",action,resource,method,path,"statusCode",details,"createdAt") VALUES ($1,NULL,'SYSTEM','','PINBET_DAILY_TO_MONTHLY_ROLLBACK','pinbet-migration','SCRIPT','scripts/pinbet-diario-to-mensal.mjs',200,$2::jsonb,now())`,
      [randomUUID(), JSON.stringify({ batchId: backup.batchId })],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
};

const enableMonthly = async (client, backup, timestamp) => {
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtext('pinbet-diario-to-mensal-v1'))`,
    );
    await client.query(
      `UPDATE betting_houses SET active=false,"syncMode"='MANUAL',"withdrawalEnabled"=false,"updatedAt"=$2 WHERE slug=$1`,
      [DAILY, timestamp],
    );
    await client.query(
      `UPDATE betting_houses SET active=true,"syncMode"='AUTO',"withdrawalEnabled"=true,"updatedAt"=$2 WHERE slug=$1`,
      [MONTHLY, timestamp],
    );
    await client.query(`DELETE FROM settings WHERE key='sync_paused'`);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
};

const apply = async () => {
  const confirm = required(arg('--confirm'), 'Use --confirm <previewToken>');
  const latestPreview = JSON.parse(
    await readFile(resolve(OUTPUT_ROOT, 'latest-preview.json'), 'utf8'),
  );
  if (confirm !== latestPreview.previewToken) {
    throw new Error('Token da prévia inválido');
  }
  const { state, sheets } = await loadFreshState();
  assertSafeState(state);
  const currentToken = sha256(stableJson(fingerprint(state, sheets)));
  if (currentToken !== confirm) {
    throw new Error('Estado mudou após a prévia; gere uma nova prévia');
  }
  const batchId = `pinbet-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`;
  const batchDir = resolve(OUTPUT_ROOT, batchId);
  const timestamp = new Date().toISOString();
  const { backup, manifest, backupPath } = await backupAndManifest(
    batchDir,
    state,
    sheets,
    batchId,
    timestamp,
  );
  console.log(`Batch: ${batchId}`);
  console.log(`Backup: ${backupPath}`);
  const client = new pg.Client({ connectionString });
  await client.connect();
  let migrated = false;
  try {
    const cancelled = await quiesceAndCancel(client, backup, timestamp);
    const before = await createPinbetBalanceSnapshot(
      resolve(batchDir, 'balance-before.json'),
    );
    const updates = await migrateDatabase(client, backup, manifest, timestamp);
    migrated = true;
    const sheet = await mirrorSheets(backup);
    const after = await createPinbetBalanceSnapshot(
      resolve(batchDir, 'balance-after.json'),
    );
    const divergences = compareSnapshots(before, after);
    if (divergences.length) {
      await writePrivateJson(resolve(batchDir, 'balance-divergences.json'), {
        divergences,
      });
      throw new Error(
        `Verificação financeira falhou para ${divergences.length} usuário(s)`,
      );
    }
    await enableMonthly(client, backup, timestamp);
    const result = {
      batchId,
      backupPath,
      backupSha256: manifest.backupSha256,
      cancelledPending: cancelled,
      updates,
      sheet,
      balanceUsersVerified: before.users.length,
      completedAt: new Date().toISOString(),
    };
    await writePrivateJson(resolve(batchDir, 'result.json'), result);
    await writePrivateJson(resolve(OUTPUT_ROOT, 'latest.json'), result);
    console.table([result]);
    return result;
  } catch (error) {
    if (migrated) {
      console.error('Falha após migração; iniciando rollback automático.');
      await rollbackDatabase(backup, batchId);
    }
    throw error;
  } finally {
    await client.end();
  }
};

const verify = async () => {
  const backupPath = resolve(required(arg('--backup'), 'Use --backup <arquivo>'));
  const backup = JSON.parse(await readFile(backupPath, 'utf8'));
  const manifest = JSON.parse(
    await readFile(resolve(dirname(backupPath), 'manifest.json'), 'utf8'),
  );
  validateBackup(backup, manifest);
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const checks = await rows(
      client,
      `SELECT
        (SELECT count(*) FROM affiliate_links WHERE "bettingHouse"=$1 AND "deletedAt" IS NULL)::int AS "dailyLinks",
        (SELECT count(*) FROM affiliate_links WHERE "bettingHouse"=$2 AND "deletedAt" IS NULL AND "linkType"='afp1')::int AS "monthlyAfp1Links",
        (SELECT count(*) FROM affiliate_data WHERE "bettingHouse"=$1)::int AS "dailyData",
        (SELECT count(*) FROM withdrawal_requests WHERE "bettingHouse"=$1)::int AS "dailyWithdrawals",
        (SELECT count(*) FROM withdrawal_requests WHERE "bettingHouse"=$2 AND "pinbetDimension" IS NULL)::int AS "monthlyWithoutDimension",
        (SELECT count(*) FROM withdrawal_requests WHERE "bettingHouse"=$2 AND "pinbetDimension"='AFP1' AND status='PENDING')::int AS "afp1Pending"`,
      [DAILY, MONTHLY],
    );
    await client.query('ROLLBACK');
    const result = checks[0];
    if (
      result.dailyLinks !== 0 ||
      result.dailyData !== 0 ||
      result.dailyWithdrawals !== 0 ||
      result.monthlyWithoutDimension !== 0 ||
      result.afp1Pending !== 0 ||
      result.monthlyAfp1Links !== backup.tables.dailyLinks.length
    ) {
      throw new Error(`Verificação divergente: ${JSON.stringify(result)}`);
    }
    console.table([result]);
    console.log(`Backup validado: ${manifest.backupSha256}`);
    return result;
  } finally {
    await client.end();
  }
};

const rollback = async () => {
  const backupPath = resolve(required(arg('--backup'), 'Use --backup <arquivo>'));
  const backup = JSON.parse(await readFile(backupPath, 'utf8'));
  const manifest = JSON.parse(
    await readFile(resolve(dirname(backupPath), 'manifest.json'), 'utf8'),
  );
  validateBackup(backup, manifest);
  await rollbackDatabase(backup, arg('--confirm'));
  console.log(`Rollback concluído para ${backup.batchId}`);
};

switch (command) {
  case 'preview':
    await preview();
    break;
  case 'apply':
    await apply();
    break;
  case 'verify':
    await verify();
    break;
  case 'rollback':
    await rollback();
    break;
  default:
    throw new Error('Comando inválido: use preview, apply, verify ou rollback');
}

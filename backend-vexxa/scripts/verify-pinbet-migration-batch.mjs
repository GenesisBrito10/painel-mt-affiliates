import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { google } from 'googleapis';

const backupPath = process.argv[2];
if (!backupPath) throw new Error('Informe backup.json');
const backup = JSON.parse(await readFile(backupPath, 'utf8'));
const result = JSON.parse(
  await readFile(backupPath.replace(/backup\.json$/, 'result.json'), 'utf8'),
);
const ids = backup.tables.dailyWithdrawals.map((row) => row.id);
const linkIds = backup.tables.dailyLinks.map((row) => row.id);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

let summary;
try {
  await client.query('BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ');
  const withdrawals = ids.length
    ? (
        await client.query(
          `SELECT id,status,amount,"originalAmount","bettingHouse","pinbetDimension"
             FROM withdrawal_requests WHERE id=ANY($1::text[]) ORDER BY id`,
          [ids],
        )
      ).rows
    : [];
  const links = linkIds.length
    ? (
        await client.query(
          `SELECT id,"bettingHouse","linkType",cpa,revshare,"campaignId","userLink"
             FROM affiliate_links WHERE id=ANY($1::text[]) ORDER BY id`,
          [linkIds],
        )
      ).rows
    : [];
  const counts = (
    await client.query(
      `SELECT
        (SELECT count(*)::int FROM affiliate_data WHERE "bettingHouse"='pinbet-diario') AS "dailyData",
        (SELECT count(*)::int FROM affiliate_data WHERE "bettingHouse"='pinbet-mensal') AS "monthlyData",
        (SELECT count(*)::int FROM affiliate_links WHERE "bettingHouse"='pinbet-diario' AND "deletedAt" IS NULL) AS "dailyLinks",
        (SELECT count(*)::int FROM affiliate_links WHERE "bettingHouse"='pinbet-mensal' AND "deletedAt" IS NULL AND "linkType"='afp1') AS "afp1Links",
        (SELECT count(*)::int FROM withdrawal_requests WHERE "bettingHouse"='pinbet-diario') AS "dailyWithdrawals",
        (SELECT count(*)::int FROM withdrawal_requests WHERE "bettingHouse"='pinbet-mensal' AND "pinbetDimension"='AFP1' AND status='PENDING') AS "afp1Pending"`,
    )
  ).rows[0];
  const houses = (
    await client.query(
      `SELECT slug,active,"syncMode","withdrawalEnabled" FROM betting_houses
         WHERE slug IN ('pinbet-diario','pinbet-mensal') ORDER BY slug`,
    )
  ).rows;
  const providers = (
    await client.query(
      `SELECT "bettingHouseSlug",active,"bookmarkerId" FROM provider_account_houses
         WHERE "bettingHouseSlug" IN ('pinbet-diario','pinbet-mensal') ORDER BY "bettingHouseSlug"`,
    )
  ).rows;
  const settings = (
    await client.query(
      `SELECT key,value FROM settings
         WHERE key IN ('sync_paused','pinbet_mensal_assignment_paused') ORDER BY key`,
    )
  ).rows;
  const notifications = (
    await client.query(
      `SELECT count(*)::int AS count FROM notifications
         WHERE metadata->>'source'='pinbet-mensal-auto-assign' AND "createdAt">=$1`,
      [backup.operationTimestamp],
    )
  ).rows[0].count;
  const webhookDeliveries = (
    await client.query(
      `SELECT count(*)::int AS count FROM link_webhook_deliveries
         WHERE origin='AUTO_ASSIGN' AND "createdAt">=$1`,
      [backup.operationTimestamp],
    )
  ).rows[0].count;
  const requests = (
    await client.query(
      `SELECT status,count(*)::int AS count FROM link_requests
         WHERE "bettingHouseSlug"='pinbet-mensal' GROUP BY status ORDER BY status`,
    )
  ).rows;
  const recentFulfilled = (
    await client.query(
      `SELECT count(*)::int AS count FROM link_requests
         WHERE "bettingHouseSlug"='pinbet-mensal' AND status='FULFILLED' AND "fulfilledAt">=$1`,
      [backup.operationTimestamp],
    )
  ).rows[0].count;
  const auditCount = (
    await client.query(
      `SELECT count(*)::int AS count FROM audit_logs
         WHERE action IN ('PINBET_DAILY_TO_MONTHLY','PINBET_DAILY_TO_MONTHLY_USER')
           AND details->>'batchId'=$1`,
      [backup.batchId],
    )
  ).rows[0].count;
  await client.query('ROLLBACK');

  const withdrawalMap = new Map(withdrawals.map((row) => [row.id, row]));
  const withdrawalDivergences = backup.tables.dailyWithdrawals.filter((before) => {
    const after = withdrawalMap.get(before.id);
    const expectedStatus = before.status === 'PENDING' ? 'REJECTED' : before.status;
    return (
      !after ||
      after.status !== expectedStatus ||
      String(after.amount) !== String(before.amount) ||
      String(after.originalAmount) !== String(before.originalAmount) ||
      after.bettingHouse !== 'pinbet-mensal' ||
      after.pinbetDimension !== 'AFP1'
    );
  });
  const linkMap = new Map(links.map((row) => [row.id, row]));
  const linkDivergences = backup.tables.dailyLinks.filter((before) => {
    const after = linkMap.get(before.id);
    return (
      !after ||
      after.bettingHouse !== 'pinbet-mensal' ||
      after.linkType !== 'afp1' ||
      String(after.cpa) !== String(before.cpa) ||
      String(after.revshare) !== String(before.revshare) ||
      after.campaignId !== before.campaignId ||
      after.userLink !== before.userLink
    );
  });
  const completed = backup.tables.dailyWithdrawals.filter(
    (row) => row.status === 'COMPLETED',
  ).length;
  const cancelled = backup.tables.dailyWithdrawals.filter(
    (row) => row.status === 'PENDING',
  ).length;
  const uniqueUsers = new Set(backup.tables.dailyLinks.map((row) => row.userId)).size;
  const houseMap = new Map(houses.map((row) => [row.slug, row]));
  const providerMap = new Map(
    providers.map((row) => [row.bettingHouseSlug, row]),
  );
  const settingMap = new Map(settings.map((row) => [row.key, row.value]));
  const failures = [];
  if (withdrawalDivergences.length) failures.push('withdrawals');
  if (linkDivergences.length) failures.push('links');
  if (
    counts.dailyData !== 0 ||
    counts.dailyLinks !== 0 ||
    counts.dailyWithdrawals !== 0 ||
    counts.afp1Pending !== 0 ||
    counts.afp1Links !== backup.tables.dailyLinks.length
  ) failures.push('counts');
  const daily = houseMap.get('pinbet-diario');
  const monthly = houseMap.get('pinbet-mensal');
  if (daily?.active || daily?.syncMode !== 'MANUAL' || daily?.withdrawalEnabled)
    failures.push('daily-house');
  if (!monthly?.active || monthly?.syncMode !== 'AUTO' || !monthly?.withdrawalEnabled)
    failures.push('monthly-house');
  if (providerMap.get('pinbet-diario')?.active) failures.push('daily-provider');
  if (
    !providerMap.get('pinbet-mensal')?.active ||
    providerMap.get('pinbet-mensal')?.bookmarkerId !== 'afp1,afp2'
  ) failures.push('monthly-provider');
  if (settingMap.has('sync_paused')) failures.push('sync-paused');
  if (settingMap.get('pinbet_mensal_assignment_paused') !== 'true')
    failures.push('assignment-pause');
  if (notifications || webhookDeliveries || recentFulfilled)
    failures.push('user-notification-side-effects');
  if (auditCount !== uniqueUsers + 1) failures.push('audit-count');

  const auth = new google.auth.GoogleAuth({
    credentials: {
      type: process.env.GOOGLE_TYPE,
      project_id: process.env.GOOGLE_PROJECT_ID,
      private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      client_id: process.env.GOOGLE_CLIENT_ID,
      universe_domain: process.env.GOOGLE_UNIVERSE_DOMAIN || 'googleapis.com',
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const currentSheet = (
    await sheets.spreadsheets.values.get({
      spreadsheetId:
        process.env.PINBET_MENSAL_SHEET_ID || process.env.PINBET_SHEET_ID,
      range: `${process.env.PINBET_MENSAL_SHEET_TAB || 'Mensal'}!A2:E`,
    })
  ).data.values ?? [];
  const expectedSheet = [...backup.sheets.monthly, ...result.sheet.rows];
  if (JSON.stringify(currentSheet) !== JSON.stringify(expectedSheet))
    failures.push('monthly-sheet');

  summary = {
    batchId: backup.batchId,
    completedPreserved: completed,
    pendingCancelled: cancelled,
    withdrawalDivergences: withdrawalDivergences.length,
    linkDivergences: linkDivergences.length,
    balanceUsersVerified: result.balanceUsersVerified,
    databaseCounts: counts,
    houses,
    providers,
    settings,
    monthlyRequestStatus: requests,
    migrationNotifications: notifications,
    migrationWebhookDeliveries: webhookDeliveries,
    recentFulfilledRequests: recentFulfilled,
    auditLogs: auditCount,
    monthlySheetRows: currentSheet.length,
    failures,
  };
  if (failures.length) throw new Error(JSON.stringify(summary));
  console.log(JSON.stringify(summary, null, 2));
} finally {
  await client.end();
}

// Deletes every withdrawal request whose status is exactly PENDING.
// Dry-run by default. Apply requires the snapshot token printed by dry-run.
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const tokenIndex = process.argv.indexOf('--snapshot-token');
const PROVIDED_TOKEN = tokenIndex >= 0 ? process.argv[tokenIndex + 1] : null;
const OPERATION_ID = 'delete-all-pending-withdrawals-2026-08-25-v1';
const OUTPUT_ROOT = path.resolve('.output/pending-withdrawal-cleanup');

function stableRows(rows) {
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    bettingHouse: row.bettingHouse,
    amount: row.amount,
    originalAmount: row.originalAmount,
    status: row.status,
    gatewayProvider: row.gatewayProvider,
    gatewayId: row.gatewayId,
    gatewayStatus: row.gatewayStatus,
    gatewaySentAt: row.gatewaySentAt,
    gatewayCompletedAt: row.gatewayCompletedAt,
    gatewayAttempts: row.gatewayAttempts,
    createdAt: row.createdAt,
  }));
}

function snapshotToken(rows) {
  return createHash('sha256')
    .update(JSON.stringify(stableRows(rows)))
    .digest('hex');
}

function totals(rows) {
  const byHouse = {};
  let gross = 0;
  let net = 0;
  for (const row of rows) {
    gross += Number(row.originalAmount);
    net += Number(row.amount);
    byHouse[row.bettingHouse] = (byHouse[row.bettingHouse] ?? 0) + 1;
  }
  return {
    count: rows.length,
    gross: gross.toFixed(2),
    net: net.toFixed(2),
    byHouse,
  };
}

function assertNotSubmitted(rows) {
  const linked = rows.filter(
    (row) =>
      row.gatewayProvider !== null ||
      row.gatewayId !== null ||
      row.gatewayStatus !== null ||
      row.gatewaySentAt !== null ||
      row.gatewayCompletedAt !== null ||
      Number(row.gatewayAttempts) > 0,
  );
  if (linked.length > 0) {
    throw new Error(
      `Abortado: ${linked.length} saque(s) PENDING possuem vínculo/tentativa de gateway.`,
    );
  }
}

async function selectPending(client, lock = false) {
  const suffix = lock ? ' FOR UPDATE' : '';
  const result = await client.query(
    `SELECT id, "userId", "bettingHouse", amount::text AS amount,
            "originalAmount"::text AS "originalAmount", status,
            "gatewayProvider", "gatewayId", "gatewayStatus",
            "gatewaySentAt", "gatewayCompletedAt", "gatewayAttempts",
            "createdAt", "updatedAt", "pixKeyType", "pixKey", "bankName",
            "bankAgency", "bankAccount", "accountHolder", "requestNote", "adminNote"
       FROM withdrawal_requests
      WHERE status = 'PENDING'
      ORDER BY "createdAt", id${suffix}`,
  );
  return result.rows;
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  if (!APPLY) {
    const rows = await selectPending(client);
    assertNotSubmitted(rows);
    console.log(
      JSON.stringify(
        { operationId: OPERATION_ID, totals: totals(rows) },
        null,
        2,
      ),
    );
    console.log(`snapshotToken=${snapshotToken(rows)}`);
    console.log('DRY-RUN: nenhuma linha foi alterada.');
    process.exit(0);
  }

  if (!PROVIDED_TOKEN) {
    throw new Error('Use --apply --snapshot-token <token-do-dry-run>.');
  }

  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
    OPERATION_ID,
  ]);
  await client.query(
    'LOCK TABLE withdrawal_requests IN SHARE ROW EXCLUSIVE MODE',
  );

  const rows = await selectPending(client, true);
  assertNotSubmitted(rows);
  const currentToken = snapshotToken(rows);
  if (currentToken !== PROVIDED_TOKEN) {
    throw new Error(
      `Snapshot mudou. Esperado ${PROVIDED_TOKEN}; atual ${currentToken}. Rode o dry-run novamente.`,
    );
  }

  const summary = totals(rows);
  const createdAt = new Date().toISOString();
  const backupDir = path.join(OUTPUT_ROOT, createdAt.replaceAll(':', '-'));
  const backupPath = path.join(backupDir, 'backup.json');
  const backupPayload = JSON.stringify(
    {
      operationId: OPERATION_ID,
      createdAt,
      snapshotToken: currentToken,
      summary,
      rows,
    },
    null,
    2,
  );
  await mkdir(backupDir, { recursive: true });
  await writeFile(backupPath, backupPayload, { mode: 0o600 });
  await chmod(backupPath, 0o600);
  const backupSha256 = createHash('sha256').update(backupPayload).digest('hex');

  const deleted = await client.query(
    `DELETE FROM withdrawal_requests
      WHERE status = 'PENDING' AND id = ANY($1::text[])
      RETURNING id`,
    [rows.map((row) => row.id)],
  );
  if (deleted.rowCount !== rows.length) {
    throw new Error(
      `Contagem divergente: selecionados=${rows.length}, apagados=${deleted.rowCount}.`,
    );
  }

  const remainingInside = await client.query(
    `SELECT count(*)::int AS count FROM withdrawal_requests WHERE status = 'PENDING'`,
  );
  if (remainingInside.rows[0].count !== 0) {
    throw new Error(
      `${remainingInside.rows[0].count} saque(s) PENDING restaram na transação.`,
    );
  }

  const auditId = randomUUID();
  await client.query(
    `INSERT INTO audit_logs
       (id, "userId", "userName", "userEmail", action, resource, method, path,
        "statusCode", details, "createdAt")
     VALUES ($1, NULL, 'Sistema', 'system@vexxa.local',
             'DELETE_ALL_PENDING_WITHDRAWALS', 'withdrawal_requests', 'SCRIPT',
             'scripts/delete-all-pending-withdrawals.mjs', 200, $2::jsonb, now())`,
    [
      auditId,
      JSON.stringify({
        operationId: OPERATION_ID,
        snapshotToken: currentToken,
        deletedIds: rows.map((row) => row.id),
        summary,
        backupPath,
        backupSha256,
      }),
    ],
  );

  await client.query('COMMIT');

  const verify = await client.query(
    `SELECT
       (SELECT count(*)::int FROM withdrawal_requests WHERE status = 'PENDING') AS pending,
       (SELECT count(*)::int FROM audit_logs WHERE id = $1) AS audits`,
    [auditId],
  );
  if (verify.rows[0].pending !== 0 || verify.rows[0].audits !== 1) {
    throw new Error(
      `Verificação pós-commit falhou: ${JSON.stringify(verify.rows[0])}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        applied: true,
        auditId,
        summary,
        backupPath,
        backupSha256,
        verify: verify.rows[0],
      },
      null,
      2,
    ),
  );
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  await client.end();
}

import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

const MODE = process.argv[2] ?? 'preview';
const NEW_SUPERBET_DEAL_ID = '3a11aa0d-d9cf-467c-bc1a-1fd62f7a7429';
const PINBET_MENSAL_DEAL_ID = '1ced25ba-1c1f-407f-a058-e45371c7935d';
const SUPERBET_CUTOVER = '2026-08-23';
const RESET_CUTOVER = '2026-08-26';
const OPERATION_ID =
  'financial-history-reset-preserve-active-deals-2026-08-25-v1';
const AUDIT_ACTION = 'RESET_FINANCIAL_HISTORY';
const AUDIT_PATH = '/scripts/reset-financial-history-preserve-active-deals.mjs';
const SYNC_CACHE_DRAIN_MS = 35_000;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL ausente');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

function tokenFor(value) {
  return createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex');
}

function makeClient() {
  return new pg.Client({ connectionString });
}

const protectedCtes = `
  WITH new_codes AS (
    SELECT DISTINCT
      '5565-' || substring(item->>'url' from '[?&]c=([^&]+)') AS campaign_id
    FROM link_requests lr
    CROSS JOIN LATERAL jsonb_array_elements(lr.links::jsonb) item
    WHERE lr."dealId" = $1
      AND lr.status = 'FULFILLED'
      AND item->>'url' LIKE '%siteid=5565%'
      AND substring(item->>'url' from '[?&]c=([^&]+)') IS NOT NULL
  ),
  new_users AS (
    SELECT DISTINCT "userId"
    FROM link_requests
    WHERE "dealId" = $1
  ),
  keep_withdrawals AS (
    SELECT id
    FROM withdrawal_requests
    WHERE "bettingHouse" = 'pinbet-mensal'
    UNION ALL
    SELECT w.id
    FROM withdrawal_requests w
    WHERE w."bettingHouse" = 'superbet'
      AND w."createdAt" >= $2::date
      AND EXISTS (
        SELECT 1 FROM new_users u WHERE u."userId" = w."userId"
      )
  ),
  keep_releases AS (
    SELECT id
    FROM withdrawal_day_releases
    WHERE "bettingHouse" = 'pinbet-mensal'
    UNION ALL
    SELECT r.id
    FROM withdrawal_day_releases r
    WHERE r."bettingHouse" = 'superbet'
      AND r."createdAt" >= $2::date
      AND EXISTS (
        SELECT 1 FROM new_users u WHERE u."userId" = r."userId"
      )
  )
`;

async function queryOne(client, sql, params = []) {
  const result = await client.query(sql, params);
  if (result.rows.length !== 1) {
    throw new Error(
      `Consulta esperava uma linha e retornou ${result.rows.length}`,
    );
  }
  return result.rows[0];
}

async function loadState(client) {
  const params = [NEW_SUPERBET_DEAL_ID, SUPERBET_CUTOVER];
  const deals = (
    await client.query(
      `SELECT id, "bettingHouseSlug" AS house, name, active,
              "createdAt"::text AS created_at
       FROM deals
       WHERE id = ANY($1::text[])
       ORDER BY id`,
      [[PINBET_MENSAL_DEAL_ID, NEW_SUPERBET_DEAL_ID]],
    )
  ).rows;

  const protectedCampaigns = await queryOne(
    client,
    `${protectedCtes}
     SELECT count(*)::int AS campaigns,
            md5(COALESCE(string_agg(campaign_id, ',' ORDER BY campaign_id), '')) AS fingerprint
     FROM new_codes`,
    params,
  );

  const integrity = await queryOne(
    client,
    `SELECT
       (SELECT count(*)::int FROM users) AS users,
       (SELECT count(*)::int FROM users WHERE "referredById" IS NOT NULL) AS referral_edges,
       (SELECT md5(COALESCE(string_agg(id || '|' || COALESCE("referredById", ''), ',' ORDER BY id), '')) FROM users) AS referral_fingerprint,
       (SELECT count(*)::int FROM affiliate_links) AS affiliate_links,
       (SELECT md5(COALESCE(string_agg(id || '|' || "userId" || '|' || "bettingHouse" || '|' || "campaignId" || '|' || COALESCE("deletedAt"::text, ''), ',' ORDER BY id), '')) FROM affiliate_links) AS affiliate_links_fingerprint,
       (SELECT count(*)::int FROM link_requests) AS link_requests,
       (SELECT md5(COALESCE(string_agg(id || '|' || "userId" || '|' || "bettingHouseSlug" || '|' || status::text || '|' || COALESCE("dealId", ''), ',' ORDER BY id), '')) FROM link_requests) AS link_requests_fingerprint`,
  );

  const preserved = await queryOne(
    client,
    `${protectedCtes}
     SELECT
       (SELECT count(*)::int FROM affiliate_data ad
         WHERE ad."bettingHouse" = 'pinbet-mensal'
            OR (ad."bettingHouse" = 'superbet' AND ad.date >= $2::date
                AND ad."campaignId" IN (SELECT campaign_id FROM new_codes))) AS affiliate_data,
       (SELECT COALESCE(sum(ad."cpaQualified"), 0)::int FROM affiliate_data ad
         WHERE ad."bettingHouse" = 'pinbet-mensal'
            OR (ad."bettingHouse" = 'superbet' AND ad.date >= $2::date
                AND ad."campaignId" IN (SELECT campaign_id FROM new_codes))) AS cpa_qualified,
       (SELECT COALESCE(sum(ad."cpaValue"), 0)::text FROM affiliate_data ad
         WHERE ad."bettingHouse" = 'pinbet-mensal'
            OR (ad."bettingHouse" = 'superbet' AND ad.date >= $2::date
                AND ad."campaignId" IN (SELECT campaign_id FROM new_codes))) AS cpa_value,
       (SELECT count(*)::int FROM affiliate_data_change_logs log
         WHERE log."bettingHouse" = 'pinbet-mensal'
            OR (log."bettingHouse" = 'superbet' AND log.date >= $2::date
                AND log."campaignId" IN (SELECT campaign_id FROM new_codes))) AS affiliate_data_change_logs,
       (SELECT count(*)::int FROM withdrawal_requests WHERE id IN (SELECT id FROM keep_withdrawals)) AS withdrawals,
       (SELECT COALESCE(sum(amount), 0)::text FROM withdrawal_requests WHERE id IN (SELECT id FROM keep_withdrawals)) AS withdrawal_amount,
       (SELECT count(*)::int FROM withdrawal_requests WHERE id IN (SELECT id FROM keep_withdrawals) AND "gatewayReceiptBase64" IS NOT NULL) AS embedded_receipts,
       (SELECT count(*)::int FROM gateway_webhook_events WHERE "withdrawalId" IN (SELECT id FROM keep_withdrawals)) AS gateway_events,
       (SELECT count(*)::int FROM whatsapp_send_logs WHERE "withdrawalId" IN (SELECT id FROM keep_withdrawals)) AS whatsapp_logs,
       (SELECT count(*)::int FROM balance_adjustments b
         WHERE b."bettingHouse" = 'pinbet-mensal'
            OR (b."bettingHouse" = 'superbet' AND EXISTS (SELECT 1 FROM new_users u WHERE u."userId" = b."userId"))) AS balance_adjustments,
       (SELECT count(*)::int FROM commission_logs c
         WHERE c."bettingHouse" = 'pinbet-mensal'
            OR (c."bettingHouse" = 'superbet'
                AND c."createdAt" >= (SELECT "createdAt" FROM deals WHERE id = $1)
                AND EXISTS (SELECT 1 FROM new_users u WHERE u."userId" = c."userId"))) AS commission_logs,
       (SELECT count(*)::int FROM withdrawal_day_releases WHERE id IN (SELECT id FROM keep_releases)) AS withdrawal_releases,
       (SELECT count(*)::int FROM sync_logs s
         WHERE s."bettingHouse" = 'pinbet-mensal'
            OR (s."bettingHouse" = 'superbet' AND s."createdAt" >= $2::date)) AS sync_logs`,
    params,
  );

  const deletion = await queryOne(
    client,
    `${protectedCtes}
     SELECT
       (SELECT count(*)::int FROM affiliate_data ad
         WHERE NOT (ad."bettingHouse" = 'pinbet-mensal'
           OR (ad."bettingHouse" = 'superbet' AND ad.date >= $2::date
               AND ad."campaignId" IN (SELECT campaign_id FROM new_codes)))) AS affiliate_data,
       (SELECT count(*)::int FROM affiliate_data_change_logs log
         WHERE NOT (log."bettingHouse" = 'pinbet-mensal'
           OR (log."bettingHouse" = 'superbet' AND log.date >= $2::date
               AND log."campaignId" IN (SELECT campaign_id FROM new_codes)))) AS affiliate_data_change_logs,
       (SELECT count(*)::int FROM withdrawal_requests WHERE id NOT IN (SELECT id FROM keep_withdrawals)) AS withdrawals,
       (SELECT COALESCE(sum(amount), 0)::text FROM withdrawal_requests WHERE id NOT IN (SELECT id FROM keep_withdrawals)) AS withdrawal_amount,
       (SELECT count(*)::int FROM withdrawal_requests WHERE id NOT IN (SELECT id FROM keep_withdrawals) AND "gatewayReceiptBase64" IS NOT NULL) AS embedded_receipts,
       (SELECT count(*)::int FROM gateway_webhook_events WHERE "withdrawalId" IS NULL OR "withdrawalId" NOT IN (SELECT id FROM keep_withdrawals)) AS gateway_events,
       (SELECT count(*)::int FROM whatsapp_send_logs WHERE "withdrawalId" IS NULL OR "withdrawalId" NOT IN (SELECT id FROM keep_withdrawals)) AS whatsapp_logs,
       (SELECT count(*)::int FROM notifications n
         WHERE (n.metadata ? 'withdrawalId' AND NOT EXISTS (
                  SELECT 1 FROM keep_withdrawals w WHERE w.id = n.metadata->>'withdrawalId'))
            OR (n.metadata ? 'releaseId' AND NOT EXISTS (
                  SELECT 1 FROM keep_releases r WHERE r.id = n.metadata->>'releaseId'))) AS notifications,
       (SELECT count(*)::int FROM fraud_counts) AS fraud_counts,
       (SELECT COALESCE(sum(count), 0)::int FROM fraud_counts) AS fraud_units,
       (SELECT count(*)::int FROM fraud_logs) AS fraud_logs,
       (SELECT count(*)::int FROM balance_adjustments b
         WHERE NOT (b."bettingHouse" = 'pinbet-mensal'
           OR (b."bettingHouse" = 'superbet' AND EXISTS (
                SELECT 1 FROM new_users u WHERE u."userId" = b."userId")))) AS balance_adjustments,
       (SELECT count(*)::int FROM commission_logs c
         WHERE NOT (c."bettingHouse" = 'pinbet-mensal'
           OR (c."bettingHouse" = 'superbet'
               AND c."createdAt" >= (SELECT "createdAt" FROM deals WHERE id = $1)
               AND EXISTS (SELECT 1 FROM new_users u WHERE u."userId" = c."userId")))) AS commission_logs,
       (SELECT count(*)::int FROM withdrawal_day_releases WHERE id NOT IN (SELECT id FROM keep_releases)) AS withdrawal_releases,
       (SELECT count(*)::int FROM sync_logs s
         WHERE NOT (s."bettingHouse" = 'pinbet-mensal'
           OR (s."bettingHouse" = 'superbet' AND s."createdAt" >= $2::date))) AS sync_logs,
       (SELECT count(*)::int FROM financial_ledger f
         WHERE NOT (COALESCE(f."bettingHouse", '') = 'pinbet-mensal'
           OR (f."bettingHouse" = 'superbet' AND f."eventDate" >= $2::date
               AND EXISTS (SELECT 1 FROM new_users u WHERE u."userId" = f."userId")))) AS financial_ledger,
       (SELECT count(*)::int FROM notification_snapshots n
         WHERE NOT (n."bettingHouse" = 'pinbet-mensal'
           OR (n."bettingHouse" = 'superbet'
               AND EXISTS (SELECT 1 FROM new_users u WHERE u."userId" = n."userId")))) AS notification_snapshots`,
    params,
  );

  const resetHouses = (
    await client.query(
      `SELECT DISTINCT house
       FROM (
         SELECT "bettingHouse" AS house FROM affiliate_data
         UNION SELECT "bettingHouse" FROM withdrawal_requests
         UNION SELECT "bettingHouse" FROM fraud_counts
         UNION SELECT "bettingHouse" FROM balance_adjustments
       ) scoped
       WHERE house NOT IN ('pinbet-mensal', 'superbet')
       ORDER BY house`,
    )
  ).rows.map((row) => row.house);

  const syncPause = await queryOne(
    client,
    `SELECT (SELECT value FROM settings WHERE key = 'sync_paused') AS value`,
  );
  const runningSyncs = await queryOne(
    client,
    `SELECT count(*)::int AS recent
     FROM sync_logs
     WHERE status = 'RUNNING'
       AND "endTime" IS NULL
       AND "startTime" >= now() - interval '15 minutes'`,
  );
  const audit = await queryOne(
    client,
    `SELECT count(*)::int AS rows
     FROM audit_logs
     WHERE action = $1 AND path = $2
       AND details->>'operationId' = $3`,
    [AUDIT_ACTION, AUDIT_PATH, OPERATION_ID],
  );

  const fingerprint = {
    operationId: OPERATION_ID,
    deals,
    protectedCampaigns,
    integrity,
    preserved,
    deletion,
    resetHouses,
    superbetCutover: SUPERBET_CUTOVER,
    resetCutover: RESET_CUTOVER,
  };

  return {
    ...fingerprint,
    previewToken: tokenFor(fingerprint),
    syncPaused: syncPause.value,
    recentRunningSyncs: runningSyncs.recent,
    auditCount: audit.rows,
  };
}

function assertIdentity(state) {
  if (state.deals.length !== 2)
    throw new Error('Deals protegidas não encontradas');
  const pinbet = state.deals.find((deal) => deal.id === PINBET_MENSAL_DEAL_ID);
  const superbet = state.deals.find((deal) => deal.id === NEW_SUPERBET_DEAL_ID);
  if (
    pinbet?.house !== 'pinbet-mensal' ||
    pinbet.name !== 'Pinbet Mensal' ||
    superbet?.house !== 'superbet' ||
    superbet.name !== 'Superbet Diário' ||
    superbet.active !== true
  ) {
    throw new Error('Identidade das deals protegidas divergiu');
  }
  if (state.protectedCampaigns.campaigns < 1) {
    throw new Error('Deal nova da Superbet sem campanhas protegidas');
  }
}

function assertPreviewReady(state) {
  assertIdentity(state);
  if (state.auditCount !== 0) throw new Error('Operação já foi aplicada');
  if (state.deletion.affiliate_data < 1) {
    throw new Error('Nenhum histórico financeiro elegível para exclusão');
  }
}

async function setSyncPause(client, value) {
  if (value === null) {
    await client.query(`DELETE FROM settings WHERE key = 'sync_paused'`);
    return;
  }
  await client.query(
    `INSERT INTO settings (id, key, value, label, "createdAt", "updatedAt")
     VALUES ($1, 'sync_paused', $2, 'Pausa global de sincronização', now(), now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()`,
    [randomUUID(), value],
  );
}

async function pauseSync(previousValue) {
  const client = makeClient();
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      OPERATION_ID,
    ]);
    await setSyncPause(client, 'true');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
  console.log(
    `Sync pausado; aguardando ${SYNC_CACHE_DRAIN_MS / 1000}s para expirar cache e drenar execuções.`,
  );
  await delay(SYNC_CACHE_DRAIN_MS);
  return previousValue;
}

async function restoreSyncPause(previousValue) {
  const client = makeClient();
  await client.connect();
  try {
    await client.query('BEGIN');
    await setSyncPause(client, previousValue);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function deleteCount(client, sql, params = []) {
  const row = await queryOne(client, sql, params);
  return row.rows;
}

async function applyReset(expected, previousSyncPaused, commit = true) {
  const client = makeClient();
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      OPERATION_ID,
    ]);

    const lockedState = await loadState(client);
    assertPreviewReady(lockedState);
    if (lockedState.previewToken !== expected.previewToken) {
      throw new Error(
        `Estado mudou após a prévia: ${expected.previewToken} != ${lockedState.previewToken}`,
      );
    }
    if (lockedState.syncPaused !== 'true') {
      throw new Error('Sync não está pausado dentro da transação');
    }
    if (lockedState.recentRunningSyncs !== 0) {
      throw new Error(
        `Há ${lockedState.recentRunningSyncs} sync(s) recente(s) ainda em execução`,
      );
    }

    await client.query(
      `${protectedCtes}
       SELECT campaign_id INTO TEMP TABLE reset_new_codes FROM new_codes`,
      [NEW_SUPERBET_DEAL_ID, SUPERBET_CUTOVER],
    );
    await client.query(
      `${protectedCtes}
       SELECT "userId" INTO TEMP TABLE reset_new_users FROM new_users`,
      [NEW_SUPERBET_DEAL_ID, SUPERBET_CUTOVER],
    );
    await client.query(
      `${protectedCtes}
       SELECT id INTO TEMP TABLE reset_keep_withdrawals FROM keep_withdrawals`,
      [NEW_SUPERBET_DEAL_ID, SUPERBET_CUTOVER],
    );
    await client.query(
      `${protectedCtes}
       SELECT id INTO TEMP TABLE reset_keep_releases FROM keep_releases`,
      [NEW_SUPERBET_DEAL_ID, SUPERBET_CUTOVER],
    );

    const deleted = {};
    deleted.notifications = await deleteCount(
      client,
      `WITH removed AS (
         DELETE FROM notifications n
         WHERE (n.metadata ? 'withdrawalId' AND NOT EXISTS (
                  SELECT 1 FROM reset_keep_withdrawals w WHERE w.id = n.metadata->>'withdrawalId'))
            OR (n.metadata ? 'releaseId' AND NOT EXISTS (
                  SELECT 1 FROM reset_keep_releases r WHERE r.id = n.metadata->>'releaseId'))
         RETURNING 1
       ) SELECT count(*)::int AS rows FROM removed`,
    );
    deleted.gateway_events = await deleteCount(
      client,
      `WITH removed AS (
         DELETE FROM gateway_webhook_events g
         WHERE g."withdrawalId" IS NULL OR NOT EXISTS (
           SELECT 1 FROM reset_keep_withdrawals w WHERE w.id = g."withdrawalId")
         RETURNING 1
       ) SELECT count(*)::int AS rows FROM removed`,
    );
    deleted.whatsapp_logs = await deleteCount(
      client,
      `WITH removed AS (
         DELETE FROM whatsapp_send_logs w
         WHERE w."withdrawalId" IS NULL OR NOT EXISTS (
           SELECT 1 FROM reset_keep_withdrawals k WHERE k.id = w."withdrawalId")
         RETURNING 1
       ) SELECT count(*)::int AS rows FROM removed`,
    );
    deleted.withdrawals = await deleteCount(
      client,
      `WITH removed AS (
         DELETE FROM withdrawal_requests w
         WHERE NOT EXISTS (SELECT 1 FROM reset_keep_withdrawals k WHERE k.id = w.id)
         RETURNING 1
       ) SELECT count(*)::int AS rows FROM removed`,
    );
    deleted.withdrawal_releases = await deleteCount(
      client,
      `WITH removed AS (
         DELETE FROM withdrawal_day_releases r
         WHERE NOT EXISTS (SELECT 1 FROM reset_keep_releases k WHERE k.id = r.id)
         RETURNING 1
       ) SELECT count(*)::int AS rows FROM removed`,
    );
    deleted.fraud_logs = await deleteCount(
      client,
      `WITH removed AS (DELETE FROM fraud_logs RETURNING 1)
       SELECT count(*)::int AS rows FROM removed`,
    );
    deleted.fraud_counts = await deleteCount(
      client,
      `WITH removed AS (DELETE FROM fraud_counts RETURNING 1)
       SELECT count(*)::int AS rows FROM removed`,
    );
    deleted.balance_adjustments = await deleteCount(
      client,
      `WITH removed AS (
         DELETE FROM balance_adjustments b
         WHERE NOT (b."bettingHouse" = 'pinbet-mensal'
           OR (b."bettingHouse" = 'superbet' AND EXISTS (
                SELECT 1 FROM reset_new_users u WHERE u."userId" = b."userId")))
         RETURNING 1
       ) SELECT count(*)::int AS rows FROM removed`,
    );
    deleted.commission_logs = await deleteCount(
      client,
      `WITH removed AS (
         DELETE FROM commission_logs c
         WHERE NOT (c."bettingHouse" = 'pinbet-mensal'
           OR (c."bettingHouse" = 'superbet'
               AND c."createdAt" >= (SELECT "createdAt" FROM deals WHERE id = $1)
               AND EXISTS (SELECT 1 FROM reset_new_users u WHERE u."userId" = c."userId")))
         RETURNING 1
       ) SELECT count(*)::int AS rows FROM removed`,
      [NEW_SUPERBET_DEAL_ID],
    );
    deleted.financial_ledger = await deleteCount(
      client,
      `WITH removed AS (
         DELETE FROM financial_ledger f
         WHERE NOT (COALESCE(f."bettingHouse", '') = 'pinbet-mensal'
           OR (f."bettingHouse" = 'superbet' AND f."eventDate" >= $1::date
               AND EXISTS (SELECT 1 FROM reset_new_users u WHERE u."userId" = f."userId")))
         RETURNING 1
       ) SELECT count(*)::int AS rows FROM removed`,
      [SUPERBET_CUTOVER],
    );
    deleted.notification_snapshots = await deleteCount(
      client,
      `WITH removed AS (
         DELETE FROM notification_snapshots n
         WHERE NOT (n."bettingHouse" = 'pinbet-mensal'
           OR (n."bettingHouse" = 'superbet' AND EXISTS (
                SELECT 1 FROM reset_new_users u WHERE u."userId" = n."userId")))
         RETURNING 1
       ) SELECT count(*)::int AS rows FROM removed`,
    );
    deleted.affiliate_data_change_logs = await deleteCount(
      client,
      `WITH removed AS (
         DELETE FROM affiliate_data_change_logs log
         WHERE NOT (log."bettingHouse" = 'pinbet-mensal'
           OR (log."bettingHouse" = 'superbet' AND log.date >= $1::date
               AND EXISTS (SELECT 1 FROM reset_new_codes c WHERE c.campaign_id = log."campaignId")))
         RETURNING 1
       ) SELECT count(*)::int AS rows FROM removed`,
      [SUPERBET_CUTOVER],
    );
    deleted.affiliate_data = await deleteCount(
      client,
      `WITH removed AS (
         DELETE FROM affiliate_data ad
         WHERE NOT (ad."bettingHouse" = 'pinbet-mensal'
           OR (ad."bettingHouse" = 'superbet' AND ad.date >= $1::date
               AND EXISTS (SELECT 1 FROM reset_new_codes c WHERE c.campaign_id = ad."campaignId")))
         RETURNING 1
       ) SELECT count(*)::int AS rows FROM removed`,
      [SUPERBET_CUTOVER],
    );
    deleted.sync_logs = await deleteCount(
      client,
      `WITH removed AS (
         DELETE FROM sync_logs s
         WHERE NOT (s."bettingHouse" = 'pinbet-mensal'
           OR (s."bettingHouse" = 'superbet' AND s."createdAt" >= $1::date))
         RETURNING 1
       ) SELECT count(*)::int AS rows FROM removed`,
      [SUPERBET_CUTOVER],
    );

    const expectedCounts = {
      notifications: lockedState.deletion.notifications,
      gateway_events: lockedState.deletion.gateway_events,
      whatsapp_logs: lockedState.deletion.whatsapp_logs,
      withdrawals: lockedState.deletion.withdrawals,
      withdrawal_releases: lockedState.deletion.withdrawal_releases,
      fraud_logs: lockedState.deletion.fraud_logs,
      fraud_counts: lockedState.deletion.fraud_counts,
      balance_adjustments: lockedState.deletion.balance_adjustments,
      commission_logs: lockedState.deletion.commission_logs,
      financial_ledger: lockedState.deletion.financial_ledger,
      notification_snapshots: lockedState.deletion.notification_snapshots,
      affiliate_data_change_logs:
        lockedState.deletion.affiliate_data_change_logs,
      affiliate_data: lockedState.deletion.affiliate_data,
      sync_logs: lockedState.deletion.sync_logs,
    };
    if (JSON.stringify(deleted) !== JSON.stringify(expectedCounts)) {
      throw new Error(
        `Contagens excluídas divergiram: ${JSON.stringify({ deleted, expectedCounts })}`,
      );
    }

    for (const house of lockedState.resetHouses) {
      await client.query(
        `INSERT INTO settings (id, key, value, label, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, now(), now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, label = EXCLUDED.label, "updatedAt" = now()`,
        [
          randomUUID(),
          `ledger_cutover_date_${house}`,
          RESET_CUTOVER,
          `Corte após reset financeiro (${OPERATION_ID})`,
        ],
      );
    }

    await client.query(
      `INSERT INTO audit_logs
        (id, "userId", "userName", "userEmail", action, resource, method, path,
         ip, "userAgent", "statusCode", details, "createdAt")
       VALUES ($1, NULL, 'Sistema', 'system@vexxa.local', $2,
         'financial_history', 'DELETE', $3, '', '', 200, $4::jsonb, now())`,
      [
        randomUUID(),
        AUDIT_ACTION,
        AUDIT_PATH,
        JSON.stringify({
          operationId: OPERATION_ID,
          previewToken: lockedState.previewToken,
          previousSyncPaused,
          superbetCutover: SUPERBET_CUTOVER,
          resetCutover: RESET_CUTOVER,
          resetHouses: lockedState.resetHouses,
          protectedCampaigns: lockedState.protectedCampaigns,
          integrityBefore: lockedState.integrity,
          preservedBefore: lockedState.preserved,
          deletionExpected: lockedState.deletion,
          deleted,
        }),
      ],
    );

    await client.query(commit ? 'COMMIT' : 'ROLLBACK');
    return { deleted, before: lockedState };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function loadAudit(client) {
  const result = await client.query(
    `SELECT id, details, "createdAt"::text AS created_at
     FROM audit_logs
     WHERE action = $1 AND path = $2
       AND details->>'operationId' = $3
     ORDER BY "createdAt" DESC`,
    [AUDIT_ACTION, AUDIT_PATH, OPERATION_ID],
  );
  if (result.rows.length !== 1) {
    throw new Error(`Auditoria esperada: 1; encontrada: ${result.rows.length}`);
  }
  return result.rows[0];
}

function zeroDeletion(deletion) {
  const ignored = new Set([
    'withdrawal_amount',
    'embedded_receipts',
    'fraud_units',
  ]);
  return Object.entries(deletion)
    .filter(([key]) => !ignored.has(key))
    .every(([, value]) => value === 0);
}

async function verifyApplied({ strict = true } = {}) {
  const client = makeClient();
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const audit = await loadAudit(client);
    const state = await loadState(client);
    const details = audit.details;
    const failures = [];
    if (!zeroDeletion(state.deletion))
      failures.push('historical-targets-remain');
    if (state.deletion.withdrawal_amount !== '0')
      failures.push('withdrawal-value-remains');
    if (state.deletion.embedded_receipts !== 0)
      failures.push('embedded-receipts-remain');
    if (state.deletion.fraud_units !== 0) failures.push('fraud-units-remain');
    if (state.syncPaused !== 'true') failures.push('sync-not-paused');
    if (strict) {
      if (tokenFor(state.integrity) !== tokenFor(details.integrityBefore)) {
        failures.push('links-users-or-referrals-changed');
      }
      if (tokenFor(state.preserved) !== tokenFor(details.preservedBefore)) {
        failures.push('protected-financial-data-changed');
      }
      if (
        tokenFor(state.protectedCampaigns) !==
        tokenFor(details.protectedCampaigns)
      ) {
        failures.push('protected-campaigns-changed');
      }
    }
    for (const house of details.resetHouses) {
      const cutover = await queryOne(
        client,
        `SELECT count(*)::int AS rows
         FROM settings WHERE key = $1 AND value = $2`,
        [`ledger_cutover_date_${house}`, RESET_CUTOVER],
      );
      if (cutover.rows !== 1) failures.push(`cutover-missing:${house}`);
    }
    await client.query('ROLLBACK');
    if (failures.length > 0) {
      throw new Error(`Verificação falhou: ${failures.join(', ')}`);
    }
    return { audit, state, failures };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function preview() {
  const client = makeClient();
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const state = await loadState(client);
    assertPreviewReady(state);
    await client.query('ROLLBACK');
    console.log(JSON.stringify(state, null, 2));
    console.log(`\nPREVIEW_TOKEN=${state.previewToken}`);
    return state;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function apply() {
  const confirm = argument('--confirm');
  if (!confirm) throw new Error('Use apply --confirm <PREVIEW_TOKEN>');
  const before = await preview();
  if (confirm !== before.previewToken) {
    throw new Error('Token de confirmação não corresponde à prévia fresca');
  }

  const previousSyncPaused = before.syncPaused;
  let mutationCommitted = false;
  try {
    await pauseSync(previousSyncPaused);
    const afterDrainClient = makeClient();
    await afterDrainClient.connect();
    const afterDrain = await loadState(afterDrainClient);
    await afterDrainClient.end();
    if (afterDrain.previewToken !== before.previewToken) {
      throw new Error(
        'Estado mudou durante a drenagem do sync; aplique nova prévia',
      );
    }
    if (afterDrain.recentRunningSyncs !== 0) {
      throw new Error(
        `Ainda existem ${afterDrain.recentRunningSyncs} sync(s) recentes em execução`,
      );
    }

    const result = await applyReset(before, previousSyncPaused);
    mutationCommitted = true;
    const verification = await verifyApplied();
    console.log('\nAPPLY_OK');
    console.log(
      JSON.stringify(
        {
          operationId: OPERATION_ID,
          previewToken: before.previewToken,
          deleted: result.deleted,
          auditId: verification.audit.id,
          syncPaused: verification.state.syncPaused,
          protected: verification.state.preserved,
          integrity: verification.state.integrity,
        },
        null,
        2,
      ),
    );
    console.log(
      '\nSync permanece pausado. Faça deploy do filtro, rode um sync controlado e só então execute unpause.',
    );
  } catch (error) {
    if (!mutationCommitted) {
      await restoreSyncPause(previousSyncPaused).catch((restoreError) => {
        console.error('Falha ao restaurar sync_paused:', restoreError);
      });
    }
    throw error;
  }
}

async function simulate() {
  const confirm = argument('--confirm');
  if (!confirm) throw new Error('Use simulate --confirm <PREVIEW_TOKEN>');
  const before = await preview();
  if (confirm !== before.previewToken) {
    throw new Error('Token de confirmação não corresponde à prévia fresca');
  }

  const previousSyncPaused = before.syncPaused;
  try {
    await pauseSync(previousSyncPaused);
    const afterDrainClient = makeClient();
    await afterDrainClient.connect();
    const afterDrain = await loadState(afterDrainClient);
    await afterDrainClient.end();
    if (
      afterDrain.previewToken !== before.previewToken ||
      afterDrain.recentRunningSyncs !== 0
    ) {
      throw new Error('Estado mudou ou ainda há sync durante a simulação');
    }
    const result = await applyReset(before, previousSyncPaused, false);
    await restoreSyncPause(previousSyncPaused);

    const afterRollbackClient = makeClient();
    await afterRollbackClient.connect();
    const afterRollback = await loadState(afterRollbackClient);
    await afterRollbackClient.end();
    if (afterRollback.previewToken !== before.previewToken) {
      throw new Error('Rollback da simulação não restaurou a prévia original');
    }
    console.log('\nSIMULATION_OK');
    console.log(JSON.stringify({ wouldDelete: result.deleted }, null, 2));
  } catch (error) {
    await restoreSyncPause(previousSyncPaused).catch((restoreError) => {
      console.error('Falha ao restaurar sync_paused:', restoreError);
    });
    throw error;
  }
}

async function unpause() {
  if (argument('--confirm') !== OPERATION_ID) {
    throw new Error(`Use unpause --confirm ${OPERATION_ID}`);
  }
  const verification = await verifyApplied({ strict: false });
  const previousValue = verification.audit.details.previousSyncPaused ?? null;
  await restoreSyncPause(previousValue);
  console.log(
    JSON.stringify(
      { operationId: OPERATION_ID, syncPausedRestoredTo: previousValue },
      null,
      2,
    ),
  );
}

if (MODE === 'preview') await preview();
else if (MODE === 'apply') await apply();
else if (MODE === 'simulate') await simulate();
else if (MODE === 'verify') {
  console.log(JSON.stringify(await verifyApplied(), null, 2));
} else if (MODE === 'verify-relaxed') {
  console.log(JSON.stringify(await verifyApplied({ strict: false }), null, 2));
} else if (MODE === 'unpause') await unpause();
else throw new Error(`Modo inválido: ${MODE}`);

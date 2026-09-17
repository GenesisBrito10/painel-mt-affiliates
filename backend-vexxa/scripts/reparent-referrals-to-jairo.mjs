// Move exatamente cinco afiliados para serem convidados diretos de
// mjm.jairo@gmail.com. Não altera links, CPAs, pedidos ou dados financeiros.
// Dry-run por padrão. Apply exige o snapshot token impresso na prévia.
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const tokenIndex = process.argv.indexOf('--snapshot-token');
const PROVIDED_TOKEN = tokenIndex >= 0 ? process.argv[tokenIndex + 1] : null;

const TARGET_EMAILS = [
  'lucasviniciusdasilvasantosv@gmail.com',
  'bs2512500@gmail.com',
  'abraaocabral07@gmail.com',
  'davidrangel0611@gmail.com',
  'junior_luciano4@icloud.com',
].sort();
const REFERRER_EMAIL = 'mjm.jairo@gmail.com';
const OPERATION_ID = 'reparent-five-affiliates-to-mjm-jairo-2026-08-26-v1';
const OUTPUT_ROOT = path.resolve('.output/reparent-referrals-to-jairo');

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

const hash = (value) =>
  createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex');

async function rows(client, sql, params = []) {
  return (await client.query(sql, params)).rows;
}

async function one(client, sql, params = []) {
  const result = await rows(client, sql, params);
  if (result.length !== 1)
    throw new Error(`Esperava 1 linha; retornou ${result.length}.`);
  return result[0];
}

async function loadState(client, { allowAlreadyLinked = false } = {}) {
  const referrer = await one(
    client,
    `SELECT * FROM users WHERE lower(email)=lower($1)`,
    [REFERRER_EMAIL],
  );
  if (
    referrer.deletedAt ||
    !referrer.active ||
    referrer.status !== 'APPROVED'
  ) {
    throw new Error('O novo convidante não está ativo/aprovado.');
  }

  const targets = await rows(
    client,
    `SELECT u.*,r.email AS "currentReferrerEmail"
       FROM users u
       LEFT JOIN users r ON r.id=u."referredById"
      WHERE lower(u.email)=ANY($1::text[])
      ORDER BY lower(u.email)`,
    [TARGET_EMAILS],
  );
  if (targets.length !== TARGET_EMAILS.length) {
    const found = new Set(targets.map((item) => item.email.toLowerCase()));
    throw new Error(
      `Usuários ausentes: ${TARGET_EMAILS.filter((email) => !found.has(email)).join(', ')}.`,
    );
  }
  if (
    targets.some(
      (item) => item.deletedAt || !item.active || item.status !== 'APPROVED',
    )
  ) {
    throw new Error('Um ou mais alvos não estão ativos/aprovados.');
  }
  if (targets.some((item) => item.id === referrer.id)) {
    throw new Error('O convidante não pode ser um dos alvos.');
  }
  if (
    !allowAlreadyLinked &&
    targets.some((item) => item.referredById === referrer.id)
  ) {
    throw new Error('Um ou mais alvos já estão vinculados ao Jairo.');
  }

  const targetIds = targets.map((item) => item.id);
  const descendants = await rows(
    client,
    `WITH RECURSIVE tree AS (
       SELECT u.id,u.email,u."referredById" AS "rootId",1 AS depth
         FROM users u WHERE u."referredById"=ANY($1::text[])
       UNION ALL
       SELECT u.id,u.email,t."rootId",t.depth+1
         FROM users u JOIN tree t ON u."referredById"=t.id
        WHERE t.depth<20
     ) SELECT * FROM tree ORDER BY "rootId",depth,id`,
    [targetIds],
  );
  if (descendants.some((item) => item.id === referrer.id)) {
    throw new Error('A alteração criaria ciclo na rede.');
  }
  if (descendants.length > 0) {
    throw new Error(
      `${descendants.length} descendente(s) seriam movidos indiretamente; operação abortada.`,
    );
  }

  const affectedIds = [
    ...new Set([
      referrer.id,
      ...targetIds,
      ...targets.map((item) => item.referredById).filter(Boolean),
    ]),
  ];
  const openWithdrawals = await rows(
    client,
    `SELECT id,"userId","bettingHouse",status,"originalAmount",amount,
            "gatewayProvider","gatewayId","gatewayStatus","gatewaySentAt",
            "gatewayCompletedAt","gatewayAttempts","createdAt"
       FROM withdrawal_requests
      WHERE "userId"=ANY($1::text[])
        AND status IN ('PENDING','APPROVED','PROCESSING')
      ORDER BY id`,
    [affectedIds],
  );
  if (openWithdrawals.length > 0) {
    throw new Error(
      `${openWithdrawals.length} saque(s) aberto(s) nos usuários/líderes afetados; revisão manual necessária.`,
    );
  }

  const targetLinks = await rows(
    client,
    `SELECT * FROM affiliate_links WHERE "userId"=ANY($1::text[]) ORDER BY id`,
    [targetIds],
  );
  const targetRequests = await rows(
    client,
    `SELECT * FROM link_requests WHERE "userId"=ANY($1::text[]) ORDER BY id`,
    [targetIds],
  );
  const otherReferralFingerprint = await one(
    client,
    `SELECT count(*)::int AS count,
            md5(COALESCE(string_agg(id || ':' || COALESCE("referredById",''),',' ORDER BY id),'')) AS fingerprint
       FROM users WHERE NOT (id=ANY($1::text[]))`,
    [targetIds],
  );

  return {
    referrer,
    targets,
    descendants,
    affectedIds,
    openWithdrawals,
    targetLinks,
    targetRequests,
    otherReferralFingerprint,
  };
}

function comparable(state) {
  return {
    referrer: state.referrer,
    targets: state.targets,
    descendants: state.descendants,
    affectedIds: state.affectedIds,
    openWithdrawals: state.openWithdrawals,
    targetLinks: state.targetLinks,
    targetRequests: state.targetRequests,
    otherReferralFingerprint: state.otherReferralFingerprint,
  };
}

function preservedTarget(target) {
  const clone = { ...target };
  delete clone.referredById;
  delete clone.currentReferrerEmail;
  delete clone.updatedAt;
  return clone;
}

function assertApplied(before, after) {
  if (after.targets.some((item) => item.referredById !== before.referrer.id)) {
    throw new Error('Nem todos os alvos foram vinculados ao Jairo.');
  }
  if (after.descendants.length !== 0 || after.openWithdrawals.length !== 0) {
    throw new Error('Topologia ou saques divergiram durante a operação.');
  }
  if (hash(before.targetLinks) !== hash(after.targetLinks)) {
    throw new Error('Links dos alvos foram alterados indevidamente.');
  }
  if (hash(before.targetRequests) !== hash(after.targetRequests)) {
    throw new Error('Pedidos de link dos alvos foram alterados indevidamente.');
  }
  if (
    hash(before.targets.map(preservedTarget)) !==
    hash(after.targets.map(preservedTarget))
  ) {
    throw new Error('Campos dos usuários além do convidante foram alterados.');
  }
  if (
    hash(before.otherReferralFingerprint) !==
    hash(after.otherReferralFingerprint)
  ) {
    throw new Error('Outra aresta da rede foi alterada.');
  }
}

function summary(state) {
  return {
    targets: state.targets.map((item) => ({
      email: item.email,
      currentReferrerEmail: item.currentReferrerEmail,
    })),
    newReferrer: state.referrer.email,
    descendantsMoved: state.descendants.length,
    openWithdrawals: state.openWithdrawals.length,
    targetLinksPreserved: state.targetLinks.length,
    targetRequestsPreserved: state.targetRequests.length,
  };
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  if (!APPLY) {
    const state = await loadState(client);
    console.log(
      JSON.stringify(
        { operationId: OPERATION_ID, summary: summary(state) },
        null,
        2,
      ),
    );
    console.log(`snapshotToken=${hash(comparable(state))}`);
    console.log('DRY-RUN: nenhuma linha foi alterada.');
    process.exit(0);
  }

  if (!PROVIDED_TOKEN) throw new Error('Use --apply --snapshot-token <token>.');

  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
    OPERATION_ID,
  ]);
  await client.query(
    'LOCK TABLE users, affiliate_links, link_requests, withdrawal_requests IN SHARE ROW EXCLUSIVE MODE',
  );
  const before = await loadState(client);
  const currentToken = hash(comparable(before));
  if (currentToken !== PROVIDED_TOKEN) {
    throw new Error(
      `Snapshot mudou. Atual=${currentToken}. Rode a prévia novamente.`,
    );
  }

  const createdAt = new Date().toISOString();
  const backupDir = path.join(OUTPUT_ROOT, createdAt.replaceAll(':', '-'));
  const backupPath = path.join(backupDir, 'backup.json');
  const backupPayload = JSON.stringify(
    {
      operationId: OPERATION_ID,
      createdAt,
      snapshotToken: currentToken,
      state: before,
    },
    null,
    2,
  );
  await mkdir(backupDir, { recursive: true });
  await writeFile(backupPath, backupPayload, { mode: 0o600 });
  await chmod(backupPath, 0o600);
  const backupSha256 = createHash('sha256').update(backupPayload).digest('hex');

  const targetIds = before.targets.map((item) => item.id);
  const updated = await client.query(
    `UPDATE users SET "referredById"=$1,"updatedAt"=now()
      WHERE id=ANY($2::text[]) AND "referredById"<>$1
      RETURNING id`,
    [before.referrer.id, targetIds],
  );
  if (updated.rowCount !== targetIds.length) {
    throw new Error(
      `Contagem divergente: esperado=${targetIds.length}, atualizado=${updated.rowCount}.`,
    );
  }

  const auditId = randomUUID();
  await client.query(
    `INSERT INTO audit_logs
       (id,"userId","userName","userEmail",action,resource,method,path,"statusCode",details,"createdAt")
     VALUES ($1,$2,$3,$4,'REPARENT_REFERRAL_NETWORK','users','SCRIPT',
             'scripts/reparent-referrals-to-jairo.mjs',200,$5::jsonb,now())`,
    [
      auditId,
      before.referrer.id,
      before.referrer.name,
      before.referrer.email,
      JSON.stringify({
        operationId: OPERATION_ID,
        newReferrerId: before.referrer.id,
        newReferrerEmail: before.referrer.email,
        targets: before.targets.map((item) => ({
          id: item.id,
          email: item.email,
          oldReferrerId: item.referredById,
          oldReferrerEmail: item.currentReferrerEmail,
        })),
        backupPath,
        backupSha256,
      }),
    ],
  );

  const after = await loadState(client, { allowAlreadyLinked: true });
  assertApplied(before, after);
  await client.query('COMMIT');

  const verifyClient = new pg.Client({
    connectionString: process.env.DATABASE_URL,
  });
  await verifyClient.connect();
  try {
    const verified = await loadState(verifyClient, {
      allowAlreadyLinked: true,
    });
    assertApplied(before, verified);
    const audit = await one(
      verifyClient,
      `SELECT count(*)::int AS count FROM audit_logs WHERE id=$1`,
      [auditId],
    );
    if (audit.count !== 1)
      throw new Error('Auditoria não encontrada após commit.');
    console.log(
      JSON.stringify(
        {
          applied: true,
          summaryBefore: summary(before),
          summaryAfter: summary(verified),
          auditId,
          backupPath,
          backupSha256,
        },
        null,
        2,
      ),
    );
  } finally {
    await verifyClient.end();
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  await client.end();
}

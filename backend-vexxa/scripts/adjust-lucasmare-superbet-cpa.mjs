// Ajusta a Superbet nova de lucasmare.2022@gmail.com:
// - head = CPA 115
// - convidados diretos que já possuem pedido/link na deal ativa = CPA 105
// - remove saques PENDING da Superbet do grupo antes que usem o CPA antigo
// Dry-run por padrão. Apply exige o snapshot token impresso na prévia.
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const APPLY = process.argv.includes('--apply');
const tokenIndex = process.argv.indexOf('--snapshot-token');
const PROVIDED_TOKEN = tokenIndex >= 0 ? process.argv[tokenIndex + 1] : null;

const HEAD_EMAIL = 'lucasmare.2022@gmail.com';
const HOUSE = 'superbet';
const HEAD_CPA = 115;
const INVITEE_CPA = 105;
const OPERATION_ID = 'lucasmare-superbet-cpa115-invitees105-2026-08-25-v1';
const OUTPUT_ROOT = path.resolve('.output/lucasmare-superbet-cpa115');

const stable = (value) => {
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
};

const sha256 = (value) =>
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

function campaignIds(request) {
  if (request.status !== 'FULFILLED') return [];
  if (!Array.isArray(request.links) || request.links.length === 0) {
    throw new Error(`Pedido fulfilled sem link: ${request.id}.`);
  }
  return request.links.map((item) => {
    const raw = typeof item === 'string' ? item : (item?.url ?? item?.link);
    if (!raw) throw new Error(`Link inválido no pedido ${request.id}.`);
    const url = new URL(raw);
    const siteId = url.searchParams.get('siteid');
    const code = url.searchParams.get('c');
    if (!siteId || !code)
      throw new Error(`Campanha inválida no pedido ${request.id}.`);
    return `${siteId}-${code}`;
  });
}

async function loadState(client) {
  const head = await one(
    client,
    `SELECT id,email,name,status,active,"deletedAt","referredById"
       FROM users WHERE lower(email)=lower($1)`,
    [HEAD_EMAIL],
  );
  if (head.deletedAt || !head.active || head.status !== 'APPROVED') {
    throw new Error('Lucas não está ativo/aprovado.');
  }

  const deals = await rows(
    client,
    `SELECT * FROM deals WHERE "bettingHouseSlug"=$1 AND active=true ORDER BY id`,
    [HOUSE],
  );
  if (deals.length !== 1)
    throw new Error(`Deals ativas da Superbet: ${deals.length}.`);
  const activeDeal = deals[0];

  const invitees = await rows(
    client,
    `SELECT id,email,name,status,active,"deletedAt","referredById"
       FROM users WHERE "referredById"=$1 ORDER BY id`,
    [head.id],
  );
  const groupIds = [head.id, ...invitees.map((item) => item.id)];

  const requests = await rows(
    client,
    `SELECT * FROM link_requests
      WHERE "bettingHouseSlug"=$1 AND "dealId"=$2 AND "userId"=ANY($3::text[])
      ORDER BY id`,
    [HOUSE, activeDeal.id, groupIds],
  );
  const requestUsers = new Set();
  for (const request of requests) {
    if (requestUsers.has(request.userId)) {
      throw new Error(
        `Mais de um pedido da deal ativa para ${request.userId}.`,
      );
    }
    requestUsers.add(request.userId);
  }
  if (!requestUsers.has(head.id))
    throw new Error('Lucas não possui pedido na deal ativa.');

  const protectedCampaigns = new Set(requests.flatMap(campaignIds));
  const links = await rows(
    client,
    `SELECT * FROM affiliate_links
      WHERE "bettingHouse"=$1 AND "deletedAt" IS NULL AND "userId"=ANY($2::text[])
      ORDER BY id`,
    [HOUSE, groupIds],
  );
  const unexpectedLinks = links.filter(
    (link) => !protectedCampaigns.has(link.campaignId),
  );
  if (unexpectedLinks.length > 0) {
    throw new Error(
      `${unexpectedLinks.length} link(s) ativo(s) fora da deal nova no grupo.`,
    );
  }
  for (const request of requests.filter(
    (item) => item.status === 'FULFILLED',
  )) {
    for (const campaignId of campaignIds(request)) {
      const matches = links.filter(
        (link) =>
          link.userId === request.userId && link.campaignId === campaignId,
      );
      if (matches.length !== 1) {
        throw new Error(
          `Campanha ${campaignId} do pedido ${request.id} possui ${matches.length} links ativos.`,
        );
      }
    }
  }

  const pendingWithdrawals = await rows(
    client,
    `SELECT * FROM withdrawal_requests
      WHERE "bettingHouse"=$1 AND status='PENDING' AND "userId"=ANY($2::text[])
      ORDER BY id`,
    [HOUSE, groupIds],
  );
  const gatewayLinked = pendingWithdrawals.filter(
    (item) =>
      item.gatewayProvider ||
      item.gatewayId ||
      item.gatewayStatus ||
      item.gatewaySentAt ||
      item.gatewayCompletedAt ||
      Number(item.gatewayAttempts) > 0,
  );
  if (gatewayLinked.length > 0) {
    throw new Error(
      `${gatewayLinked.length} saque(s) PENDING possuem vínculo com gateway.`,
    );
  }

  const openNonPending = await rows(
    client,
    `SELECT id,"userId",status,"originalAmount","gatewayId","gatewaySentAt"
       FROM withdrawal_requests
      WHERE "bettingHouse"=$1 AND status IN ('APPROVED','PROCESSING')
        AND "userId"=ANY($2::text[])
      ORDER BY id`,
    [HOUSE, groupIds],
  );
  if (openNonPending.length > 0) {
    throw new Error(
      `${openNonPending.length} saque(s) APPROVED/PROCESSING exigem revisão manual.`,
    );
  }

  return { head, activeDeal, invitees, requests, links, pendingWithdrawals };
}

function comparable(state) {
  return {
    head: state.head,
    activeDeal: state.activeDeal,
    invitees: state.invitees,
    requests: state.requests,
    links: state.links,
    pendingWithdrawals: state.pendingWithdrawals,
  };
}

function summary(state) {
  const inviteeIds = new Set(state.invitees.map((item) => item.id));
  const headLinks = state.links.filter((item) => item.userId === state.head.id);
  const inviteeLinks = state.links.filter((item) =>
    inviteeIds.has(item.userId),
  );
  const changedInviteeLinks = inviteeLinks.filter(
    (item) => Number(item.cpa) !== INVITEE_CPA,
  );
  const pendingGross = state.pendingWithdrawals.reduce(
    (total, item) => total + Number(item.originalAmount),
    0,
  );
  return {
    directInvitees: state.invitees.length,
    currentDealRequests: state.requests.length,
    headLinks: headLinks.length,
    inviteeLinks: inviteeLinks.length,
    inviteeLinksToChange: changedInviteeLinks.length,
    pendingWithdrawals: state.pendingWithdrawals.length,
    pendingGross: pendingGross.toFixed(2),
    changedInviteeEmails: changedInviteeLinks.map(
      (link) => state.invitees.find((user) => user.id === link.userId)?.email,
    ),
  };
}

function assertApplied(state) {
  const inviteeIds = new Set(state.invitees.map((item) => item.id));
  const wrongLinks = state.links.filter((link) =>
    link.userId === state.head.id
      ? Number(link.cpa) !== HEAD_CPA
      : inviteeIds.has(link.userId) && Number(link.cpa) !== INVITEE_CPA,
  );
  const wrongRequests = state.requests.filter((request) =>
    request.userId === state.head.id
      ? Number(request.resolvedCpa) !== HEAD_CPA
      : Number(request.resolvedCpa) !== INVITEE_CPA ||
        Number(request.inviterCpa) !== HEAD_CPA,
  );
  if (
    wrongLinks.length ||
    wrongRequests.length ||
    state.pendingWithdrawals.length
  ) {
    throw new Error(
      `Verificação falhou: links=${wrongLinks.length}, pedidos=${wrongRequests.length}, pendentes=${state.pendingWithdrawals.length}.`,
    );
  }
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  if (!APPLY) {
    const state = await loadState(client);
    const token = sha256(comparable(state));
    console.log(
      JSON.stringify(
        { operationId: OPERATION_ID, summary: summary(state) },
        null,
        2,
      ),
    );
    console.log(`snapshotToken=${token}`);
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
  const currentToken = sha256(comparable(before));
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

  const inviteeIds = before.invitees.map((item) => item.id);
  const targetLinkIds = before.links.map((item) => item.id);
  const targetRequestIds = before.requests.map((item) => item.id);
  const pendingIds = before.pendingWithdrawals.map((item) => item.id);

  const headLinks = await client.query(
    `UPDATE affiliate_links SET cpa=$1,"updatedAt"=now()
      WHERE id=ANY($2::text[]) AND "userId"=$3 AND "bettingHouse"=$4
      RETURNING id`,
    [HEAD_CPA, targetLinkIds, before.head.id, HOUSE],
  );
  const inviteeLinks = await client.query(
    `UPDATE affiliate_links SET cpa=$1,"updatedAt"=now()
      WHERE id=ANY($2::text[]) AND "userId"=ANY($3::text[]) AND "bettingHouse"=$4
      RETURNING id`,
    [INVITEE_CPA, targetLinkIds, inviteeIds, HOUSE],
  );
  const headRequests = await client.query(
    `UPDATE link_requests SET "resolvedCpa"=$1,"resolvedAt"=now(),"updatedAt"=now()
      WHERE id=ANY($2::text[]) AND "userId"=$3 AND "dealId"=$4
      RETURNING id`,
    [HEAD_CPA, targetRequestIds, before.head.id, before.activeDeal.id],
  );
  const inviteeRequests = await client.query(
    `UPDATE link_requests
        SET "resolvedCpa"=$1,"inviterCpa"=$2,"resolvedAt"=now(),"updatedAt"=now()
      WHERE id=ANY($3::text[]) AND "userId"=ANY($4::text[]) AND "dealId"=$5
      RETURNING id`,
    [INVITEE_CPA, HEAD_CPA, targetRequestIds, inviteeIds, before.activeDeal.id],
  );
  const deletedWithdrawals = await client.query(
    `DELETE FROM withdrawal_requests
      WHERE id=ANY($1::text[]) AND status='PENDING' AND "bettingHouse"=$2
      RETURNING id`,
    [pendingIds, HOUSE],
  );

  if (
    headLinks.rowCount + inviteeLinks.rowCount !== before.links.length ||
    headRequests.rowCount + inviteeRequests.rowCount !==
      before.requests.length ||
    deletedWithdrawals.rowCount !== before.pendingWithdrawals.length
  ) {
    throw new Error('Contagem de escrita divergente do snapshot.');
  }

  const auditId = randomUUID();
  await client.query(
    `INSERT INTO audit_logs
       (id,"userId","userName","userEmail",action,resource,method,path,"statusCode",details,"createdAt")
     VALUES ($1,$2,$3,$4,'ADJUST_SUPERBET_CPA_NETWORK','affiliate_links','SCRIPT',
             'scripts/adjust-lucasmare-superbet-cpa.mjs',200,$5::jsonb,now())`,
    [
      auditId,
      before.head.id,
      before.head.name,
      before.head.email,
      JSON.stringify({
        operationId: OPERATION_ID,
        headCpa: HEAD_CPA,
        inviteeCpa: INVITEE_CPA,
        summaryBefore: summary(before),
        linkIds: targetLinkIds,
        requestIds: targetRequestIds,
        deletedWithdrawalIds: pendingIds,
        backupPath,
        backupSha256,
      }),
    ],
  );

  const after = await loadState(client);
  assertApplied(after);
  await client.query('COMMIT');

  const verifyClient = new pg.Client({
    connectionString: process.env.DATABASE_URL,
  });
  await verifyClient.connect();
  try {
    const verified = await loadState(verifyClient);
    assertApplied(verified);
    const audits = await one(
      verifyClient,
      `SELECT count(*)::int AS count FROM audit_logs WHERE id=$1`,
      [auditId],
    );
    if (audits.count !== 1)
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

import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const DEAL_ID = '3a11aa0d-d9cf-467c-bc1a-1fd62f7a7429';
const HOUSE = 'superbet';
const TARGET_CPA = 110;
const EXPECTED_TARGETS = [
  {
    requestId: 'a5877a88-d793-4731-9872-65d9d6b60d13',
    affiliateLinkId: '1b9505c3-a024-4d08-b8bb-7282f4ca6589',
    userId: '0513c676-c01e-4e41-86e5-1c96d97d15a2',
    inviterUserId: 'c6315803-0001-4794-8f82-44fc5b31c69f',
    campaignId: '5565-MJM133',
  },
  {
    requestId: '3973e516-4870-4d5f-9a0f-931a8565bbb8',
    affiliateLinkId: 'abfeba34-7950-4cea-9184-caaea0eefdbb',
    userId: '981dce75-631b-4128-b0fc-9e094a4bc08a',
    inviterUserId: 'f06f6cd9-0d01-4468-b609-799b1b6c32c1',
    campaignId: '5565-MJM134',
  },
  {
    requestId: '0a910b76-05c9-4988-a82e-f02b27525b9b',
    affiliateLinkId: '25b7dd87-ab1c-420b-8390-c6bc8023ca75',
    userId: 'c90d5fb9-b259-41e8-be62-eebef6a65012',
    inviterUserId: 'f06f6cd9-0d01-4468-b609-799b1b6c32c1',
    campaignId: '5565-MJM135',
  },
];
const OPERATION_ID = 'superbet-special-invitees-cpa110-reconcile-2026-08-24';
const AUDIT_ACTION = 'RECONCILE_SUPERBET_SPECIAL_INVITEES_CPA_110';
const AUDIT_PATH = '/scripts/reconcile-superbet-special-invitees-cpa-110.mjs';
const APPLY = process.env.APPLY === '1';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL ausente');

const makeClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

const numeric = (value) => (value == null ? null : Number(value));

function parseCampaign(request) {
  if (!Array.isArray(request.links) || request.links.length !== 1) {
    throw new Error(`Pedido ${request.id} sem uma URL unica`);
  }
  const item = request.links[0];
  const raw = typeof item === 'string' ? item : item?.url;
  if (typeof raw !== 'string') throw new Error(`Pedido ${request.id} sem URL`);
  const url = new URL(raw);
  const siteId = url.searchParams.get('siteid');
  const campaign = url.searchParams.get('c');
  if (!siteId || !campaign) throw new Error(`Pedido ${request.id} invalido`);
  return `${siteId}-${campaign}`;
}

async function loadState(db) {
  const requests = await db.linkRequest.findMany({
    where: { id: { in: EXPECTED_TARGETS.map((item) => item.requestId) } },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      userId: true,
      dealId: true,
      bettingHouseSlug: true,
      status: true,
      resolvedCpa: true,
      inviterCpa: true,
      links: true,
      user: {
        select: { name: true, email: true, referredById: true },
      },
    },
  });
  const links = await db.affiliateLink.findMany({
    where: {
      id: { in: EXPECTED_TARGETS.map((item) => item.affiliateLinkId) },
      deletedAt: null,
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      userId: true,
      bettingHouse: true,
      campaignId: true,
      cpa: true,
      revshare: true,
    },
  });
  if (
    requests.length !== EXPECTED_TARGETS.length ||
    links.length !== EXPECTED_TARGETS.length
  ) {
    throw new Error('Quantidade de pedidos/vinculos divergente');
  }

  const requestsById = new Map(
    requests.map((request) => [request.id, request]),
  );
  const linksById = new Map(links.map((link) => [link.id, link]));
  const targets = EXPECTED_TARGETS.map((expected) => {
    const request = requestsById.get(expected.requestId);
    const link = linksById.get(expected.affiliateLinkId);
    if (
      !request ||
      !link ||
      request.userId !== expected.userId ||
      request.user.referredById !== expected.inviterUserId ||
      request.dealId !== DEAL_ID ||
      request.bettingHouseSlug !== HOUSE ||
      request.status !== 'FULFILLED' ||
      parseCampaign(request) !== expected.campaignId ||
      link.userId !== expected.userId ||
      link.bettingHouse !== HOUSE ||
      link.campaignId !== expected.campaignId
    ) {
      throw new Error(`Mapeamento divergente para ${expected.requestId}`);
    }
    return {
      ...expected,
      name: request.user.name,
      email: request.user.email,
      requestCpa: numeric(request.resolvedCpa),
      inviterCpa: numeric(request.inviterCpa),
      linkCpa: numeric(link.cpa),
      revshare: numeric(link.revshare),
    };
  });

  const campaignIds = targets.map((item) => item.campaignId);
  const userIds = targets.map((item) => item.userId);
  const metricRows = await db.affiliateData.count({
    where: { bettingHouse: HOUSE, campaignId: { in: campaignIds } },
  });
  const openWithdrawals = await db.withdrawalRequest.count({
    where: {
      userId: { in: userIds },
      bettingHouse: HOUSE,
      status: { in: ['PENDING', 'APPROVED', 'PROCESSING'] },
    },
  });

  return { targets, metricRows, openWithdrawals };
}

function assertBefore(state) {
  if (state.metricRows !== 0 || state.openWithdrawals !== 0) {
    throw new Error(
      `Impacto inseguro: metricRows=${state.metricRows}, openWithdrawals=${state.openWithdrawals}`,
    );
  }
  for (const target of state.targets) {
    if (
      target.requestCpa !== 105 ||
      target.inviterCpa !== 120 ||
      target.linkCpa !== 105 ||
      target.revshare !== 0
    ) {
      throw new Error(`Estado inicial divergente para ${target.requestId}`);
    }
  }
}

function assertAfter(state) {
  if (state.metricRows !== 0 || state.openWithdrawals !== 0) {
    throw new Error('Impacto financeiro apareceu apos a correcao');
  }
  for (const target of state.targets) {
    if (
      target.requestCpa !== TARGET_CPA ||
      target.inviterCpa !== 120 ||
      target.linkCpa !== TARGET_CPA ||
      target.revshare !== 0
    ) {
      throw new Error(`Estado final divergente para ${target.requestId}`);
    }
  }
}

async function applyCorrection(db, initialState, startedAt) {
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext(${OPERATION_ID}))`,
      );
      const priorAudit = await tx.auditLog.findFirst({
        where: { action: AUDIT_ACTION, path: AUDIT_PATH },
        select: { id: true },
      });
      if (priorAudit) throw new Error(`Operacao ${OPERATION_ID} ja aplicada`);

      const requestIds = initialState.targets.map((item) => item.requestId);
      const linkIds = initialState.targets.map((item) => item.affiliateLinkId);
      const lockedRequests = await tx.$queryRaw(
        Prisma.sql`SELECT id FROM link_requests WHERE id IN (${Prisma.join(requestIds)}) FOR UPDATE`,
      );
      const lockedLinks = await tx.$queryRaw(
        Prisma.sql`SELECT id FROM affiliate_links WHERE id IN (${Prisma.join(linkIds)}) FOR UPDATE`,
      );
      if (
        lockedRequests.length !== EXPECTED_TARGETS.length ||
        lockedLinks.length !== EXPECTED_TARGETS.length
      ) {
        throw new Error('Bloqueio parcial detectado');
      }

      const state = await loadState(tx);
      assertBefore(state);
      if (
        JSON.stringify(state.targets) !== JSON.stringify(initialState.targets)
      ) {
        throw new Error('Estado mudou entre previa e transacao');
      }

      const requestUpdate = await tx.linkRequest.updateMany({
        where: {
          id: { in: requestIds },
          resolvedCpa: 105,
          inviterCpa: 120,
        },
        data: { resolvedCpa: TARGET_CPA },
      });
      const linkUpdate = await tx.affiliateLink.updateMany({
        where: { id: { in: linkIds }, cpa: 105 },
        data: { cpa: TARGET_CPA },
      });
      if (
        requestUpdate.count !== EXPECTED_TARGETS.length ||
        linkUpdate.count !== EXPECTED_TARGETS.length
      ) {
        throw new Error('Atualizacao parcial detectada');
      }

      const commissionLogs = await tx.commissionLog.createMany({
        data: state.targets.map((item) => ({
          userId: item.userId,
          userName: item.name,
          userEmail: item.email,
          changedById: null,
          bettingHouse: HOUSE,
          field: 'cpa',
          oldValue: item.linkCpa,
          newValue: TARGET_CPA,
          source: 'SCRIPT',
        })),
      });
      if (commissionLogs.count !== EXPECTED_TARGETS.length) {
        throw new Error('Logs de comissao incompletos');
      }

      const audit = await tx.auditLog.create({
        data: {
          userId: null,
          userName: 'Sistema',
          userEmail: 'system@vexxa.local',
          action: AUDIT_ACTION,
          resource: 'link_requests',
          method: 'PATCH',
          path: AUDIT_PATH,
          statusCode: 200,
          details: {
            operationId: OPERATION_ID,
            dealId: DEAL_ID,
            targetCpa: TARGET_CPA,
            requestCount: requestUpdate.count,
            affiliateLinkCount: linkUpdate.count,
            commissionLogCount: commissionLogs.count,
            requestIds,
            affiliateLinkIds: linkIds,
            userIds: state.targets.map((item) => item.userId),
            campaignIds: state.targets.map((item) => item.campaignId),
            metricRows: state.metricRows,
            openWithdrawals: state.openWithdrawals,
            startedAt: startedAt.toISOString(),
          },
        },
        select: { id: true },
      });
      return {
        requests: requestUpdate.count,
        affiliateLinks: linkUpdate.count,
        commissionLogs: commissionLogs.count,
        auditId: audit.id,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 30_000,
    },
  );
}

async function verifyFresh(startedAt) {
  const verifyDb = makeClient();
  try {
    const state = await loadState(verifyDb);
    assertAfter(state);
    const audits = await verifyDb.auditLog.count({
      where: {
        action: AUDIT_ACTION,
        path: AUDIT_PATH,
        createdAt: { gte: startedAt },
      },
    });
    const commissionLogs = await verifyDb.commissionLog.count({
      where: {
        userId: { in: state.targets.map((item) => item.userId) },
        bettingHouse: HOUSE,
        field: 'cpa',
        newValue: TARGET_CPA,
        source: 'SCRIPT',
        createdAt: { gte: startedAt },
      },
    });
    if (audits !== 1 || commissionLogs !== EXPECTED_TARGETS.length) {
      throw new Error('Auditoria independente divergente');
    }
    return {
      requestsAt110: state.targets.length,
      linksAt110: state.targets.length,
      commissionLogs,
      batchAudits: audits,
      metricRows: state.metricRows,
      openWithdrawals: state.openWithdrawals,
    };
  } finally {
    await verifyDb.$disconnect();
  }
}

const startedAt = new Date();
const prisma = makeClient();
try {
  const priorAudit = await prisma.auditLog.findFirst({
    where: { action: AUDIT_ACTION, path: AUDIT_PATH },
    select: { id: true, createdAt: true },
  });
  if (priorAudit) {
    throw new Error(
      `Operacao ${OPERATION_ID} ja auditada em ${priorAudit.createdAt.toISOString()}`,
    );
  }
  const state = await loadState(prisma);
  assertBefore(state);
  console.log(
    JSON.stringify(
      {
        mode: APPLY ? 'apply-preview' : 'dry-run',
        operationId: OPERATION_ID,
        targets: state.targets.map((item) => ({
          name: item.name,
          email: item.email,
          campaignId: item.campaignId,
          requestCpa: item.requestCpa,
          inviterCpa: item.inviterCpa,
          linkCpa: item.linkCpa,
        })),
        targetCpa: TARGET_CPA,
        metricRows: state.metricRows,
        openWithdrawals: state.openWithdrawals,
      },
      null,
      2,
    ),
  );
  if (!APPLY) {
    console.log(
      'DRY_RUN_OK: nenhuma escrita realizada; use APPLY=1 para aplicar.',
    );
  } else {
    const applied = await applyCorrection(prisma, state, startedAt);
    console.log(JSON.stringify({ applied }, null, 2));
    const verified = await verifyFresh(startedAt);
    console.log(JSON.stringify({ verified }, null, 2));
  }
} catch (error) {
  console.error(
    `ABORTADO: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

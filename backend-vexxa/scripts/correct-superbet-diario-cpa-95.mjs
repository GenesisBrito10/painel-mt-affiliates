import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  assertSafeImpact,
  buildCorrectionPlan,
  distribution,
  parseSuperbetCampaign,
} from './lib/superbet-diario-cpa-95.mjs';

const DEAL_ID = '3a11aa0d-d9cf-467c-bc1a-1fd62f7a7429';
const HOUSE = 'superbet';
const EXPECTED_TARGETS = 35;
const TARGET_CPA = 95;
const OPERATION_ID = 'superbet-diario-cpa95-2026-08-24';
const AUDIT_ACTION = 'CORRECT_SUPERBET_DIARIO_CPA';
const AUDIT_PATH = '/scripts/correct-superbet-diario-cpa-95.mjs';
const APPLY = process.env.APPLY === '1';
const OPEN_WITHDRAWAL_STATUSES = ['PENDING', 'APPROVED', 'PROCESSING'];
const EXPECTED_REQUEST_DISTRIBUTION = { 100: 32, 105: 3 };
const EXPECTED_LINK_DISTRIBUTION = { 100: 32, 105: 2, 120: 1 };

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL ausente');

const makeClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

const numeric = (value) => (value == null ? null : Number(value));

const normalizedDistribution = (value) =>
  Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => Number(a) - Number(b)),
  );

function assertDistribution(actual, expected, label) {
  const normalizedActual = normalizedDistribution(actual);
  const normalizedExpected = normalizedDistribution(expected);
  if (JSON.stringify(normalizedActual) !== JSON.stringify(normalizedExpected)) {
    throw new Error(
      `${label} divergente: ${JSON.stringify(normalizedActual)}; esperado ${JSON.stringify(normalizedExpected)}`,
    );
  }
}

function assertLiveConfiguration(deal, rule) {
  if (!deal || deal.bettingHouseSlug !== HOUSE || !deal.active) {
    throw new Error('Deal Superbet Diario ausente, inativa ou divergente');
  }
  const values = {
    defaultCpa: numeric(rule?.defaultCpa),
    fallbackCpa: numeric(rule?.fallbackCpa),
    threshold: numeric(rule?.inviterCpaThreshold),
    discount: numeric(rule?.inviterCpaDiscount),
  };
  if (
    !rule ||
    rule.ruleType !== 'INVITER_DISCOUNT' ||
    values.defaultCpa !== 105 ||
    values.fallbackCpa !== 105 ||
    values.threshold !== 105 ||
    values.discount !== 10
  ) {
    throw new Error(`Regra Superbet divergente: ${JSON.stringify(values)}`);
  }
}

const candidateWhere = {
  dealId: DEAL_ID,
  bettingHouseSlug: HOUSE,
  status: 'FULFILLED',
  resolvedCpa: { in: [100, 105] },
  user: { referredById: { not: null } },
};

async function loadState(db) {
  const [deal, rule, priorAudit, requests] = await Promise.all([
    db.deal.findUnique({
      where: { id: DEAL_ID },
      select: { id: true, name: true, active: true, bettingHouseSlug: true },
    }),
    db.houseLinkRule.findUnique({ where: { houseSlug: HOUSE } }),
    db.auditLog.findFirst({
      where: { action: AUDIT_ACTION, path: AUDIT_PATH },
      select: { id: true, createdAt: true },
    }),
    db.linkRequest.findMany({
      where: candidateWhere,
      orderBy: { id: 'asc' },
      select: {
        id: true,
        userId: true,
        resolvedCpa: true,
        links: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            referredById: true,
          },
        },
      },
    }),
  ]);

  assertLiveConfiguration(deal, rule);
  if (priorAudit) {
    throw new Error(
      `Operacao ${OPERATION_ID} ja auditada em ${priorAudit.createdAt.toISOString()}`,
    );
  }

  const campaignIds = requests.map((request) => {
    const raw = Array.isArray(request.links) ? request.links[0] : null;
    const url = typeof raw === 'string' ? raw : raw?.url;
    if (typeof url !== 'string') {
      throw new Error(`Pedido ${request.id} sem URL unica valida`);
    }
    return parseSuperbetCampaign(url).campaignId;
  });

  const affiliateLinks = await db.affiliateLink.findMany({
    where: {
      bettingHouse: HOUSE,
      campaignId: { in: campaignIds },
      deletedAt: null,
    },
    select: {
      id: true,
      userId: true,
      campaignId: true,
      cpa: true,
    },
  });

  const plan = buildCorrectionPlan({
    requests,
    affiliateLinks,
    expectedTargets: EXPECTED_TARGETS,
  });
  const userIds = plan.map((item) => item.userId);

  const [metricAggregate, openWithdrawals, noInviterAt105] = await Promise.all([
    db.affiliateData.aggregate({
      where: { bettingHouse: HOUSE, campaignId: { in: campaignIds } },
      _count: { _all: true },
      _sum: {
        ftds: true,
        qftd: true,
        deposit: true,
        cpaQualified: true,
        cpaValue: true,
        totalCommission: true,
      },
    }),
    db.withdrawalRequest.count({
      where: {
        userId: { in: userIds },
        bettingHouse: HOUSE,
        status: { in: OPEN_WITHDRAWAL_STATUSES },
      },
    }),
    db.linkRequest.count({
      where: {
        dealId: DEAL_ID,
        bettingHouseSlug: HOUSE,
        status: 'FULFILLED',
        resolvedCpa: 105,
        user: { referredById: null },
      },
    }),
  ]);

  const metricRows = metricAggregate._count._all;
  assertSafeImpact({ openWithdrawals, metricRows });
  assertDistribution(
    distribution(plan.map((item) => item.oldRequestCpa)),
    EXPECTED_REQUEST_DISTRIBUTION,
    'Distribuicao de CPA dos pedidos',
  );
  assertDistribution(
    distribution(plan.map((item) => item.oldLinkCpa)),
    EXPECTED_LINK_DISTRIBUTION,
    'Distribuicao de CPA dos links',
  );

  return {
    deal,
    rule,
    requests,
    plan,
    campaignIds,
    userIds,
    openWithdrawals,
    noInviterAt105,
    metricRows,
    metricSums: Object.fromEntries(
      Object.entries(metricAggregate._sum).map(([key, value]) => [
        key,
        numeric(value) ?? 0,
      ]),
    ),
  };
}

function summary(state, mode) {
  return {
    mode,
    operationId: OPERATION_ID,
    deal: {
      id: state.deal.id,
      name: state.deal.name,
      active: state.deal.active,
    },
    targets: state.plan.length,
    uniqueUsers: new Set(state.userIds).size,
    uniqueCampaigns: new Set(state.campaignIds).size,
    requestCpaBefore: distribution(
      state.plan.map((item) => item.oldRequestCpa),
    ),
    linkCpaBefore: distribution(state.plan.map((item) => item.oldLinkCpa)),
    targetCpa: TARGET_CPA,
    metricRows: state.metricRows,
    metricSums: state.metricSums,
    openWithdrawals: state.openWithdrawals,
    noInviterAt105: state.noInviterAt105,
  };
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

      const requestIds = initialState.plan.map((item) => item.requestId);
      const linkIds = initialState.plan.map((item) => item.affiliateLinkId);
      const lockedRequests = await tx.$queryRaw(
        Prisma.sql`SELECT id FROM link_requests WHERE id IN (${Prisma.join(requestIds)}) FOR UPDATE`,
      );
      const lockedLinks = await tx.$queryRaw(
        Prisma.sql`SELECT id FROM affiliate_links WHERE id IN (${Prisma.join(linkIds)}) FOR UPDATE`,
      );
      if (
        lockedRequests.length !== EXPECTED_TARGETS ||
        lockedLinks.length !== EXPECTED_TARGETS
      ) {
        throw new Error('Contagem divergente durante bloqueio das linhas');
      }

      const deal = await tx.deal.findUnique({ where: { id: DEAL_ID } });
      const rule = await tx.houseLinkRule.findUnique({
        where: { houseSlug: HOUSE },
      });
      const requests = await tx.linkRequest.findMany({
        where: candidateWhere,
        orderBy: { id: 'asc' },
        select: {
          id: true,
          userId: true,
          resolvedCpa: true,
          links: true,
          user: { select: { name: true, email: true, referredById: true } },
        },
      });
      const affiliateLinks = await tx.affiliateLink.findMany({
        where: { id: { in: linkIds }, bettingHouse: HOUSE, deletedAt: null },
        select: { id: true, userId: true, campaignId: true, cpa: true },
      });
      const metricRows = await tx.affiliateData.count({
        where: {
          bettingHouse: HOUSE,
          campaignId: { in: initialState.campaignIds },
        },
      });
      const openWithdrawals = await tx.withdrawalRequest.count({
        where: {
          userId: { in: initialState.userIds },
          bettingHouse: HOUSE,
          status: { in: OPEN_WITHDRAWAL_STATUSES },
        },
      });

      assertLiveConfiguration(deal, rule);
      assertSafeImpact({ openWithdrawals, metricRows });
      const plan = buildCorrectionPlan({
        requests,
        affiliateLinks,
        expectedTargets: EXPECTED_TARGETS,
      });
      assertDistribution(
        distribution(plan.map((item) => item.oldRequestCpa)),
        EXPECTED_REQUEST_DISTRIBUTION,
        'Distribuicao transacional dos pedidos',
      );
      assertDistribution(
        distribution(plan.map((item) => item.oldLinkCpa)),
        EXPECTED_LINK_DISTRIBUTION,
        'Distribuicao transacional dos links',
      );

      const requestUpdate = await tx.linkRequest.updateMany({
        where: { id: { in: requestIds }, resolvedCpa: { in: [100, 105] } },
        data: { resolvedCpa: TARGET_CPA },
      });
      const linkUpdate = await tx.affiliateLink.updateMany({
        where: { id: { in: linkIds }, cpa: { in: [100, 105, 120] } },
        data: { cpa: TARGET_CPA },
      });
      if (
        requestUpdate.count !== EXPECTED_TARGETS ||
        linkUpdate.count !== EXPECTED_TARGETS
      ) {
        throw new Error('Atualizacao parcial detectada; transacao abortada');
      }

      const users = new Map(
        requests.map((request) => [request.userId, request.user]),
      );
      const commissionInsert = await tx.commissionLog.createMany({
        data: plan.map((item) => ({
          userId: item.userId,
          userName: users.get(item.userId)?.name ?? '',
          userEmail: users.get(item.userId)?.email ?? '',
          changedById: null,
          bettingHouse: HOUSE,
          field: 'cpa',
          oldValue: item.oldLinkCpa,
          newValue: TARGET_CPA,
          source: 'SCRIPT',
        })),
      });
      if (commissionInsert.count !== EXPECTED_TARGETS) {
        throw new Error('Auditoria de comissao incompleta; transacao abortada');
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
            commissionLogCount: commissionInsert.count,
            requestCpaBefore: EXPECTED_REQUEST_DISTRIBUTION,
            linkCpaBefore: EXPECTED_LINK_DISTRIBUTION,
            requestIds,
            affiliateLinkIds: linkIds,
            userIds: initialState.userIds,
            campaignIds: initialState.campaignIds,
            metricRows,
            openWithdrawals,
            startedAt: startedAt.toISOString(),
          },
        },
        select: { id: true },
      });

      return {
        requestCount: requestUpdate.count,
        linkCount: linkUpdate.count,
        commissionLogCount: commissionInsert.count,
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

async function verifyFreshConnection(startedAt, initialState) {
  const verifyDb = makeClient();
  try {
    const requestIds = initialState.plan.map((item) => item.requestId);
    const linkIds = initialState.plan.map((item) => item.affiliateLinkId);
    const [
      remainingWrong,
      correctedRequests,
      correctedLinks,
      commissionLogs,
      audits,
      noInviter105,
    ] = await Promise.all([
      verifyDb.linkRequest.count({ where: candidateWhere }),
      verifyDb.linkRequest.count({
        where: { id: { in: requestIds }, resolvedCpa: TARGET_CPA },
      }),
      verifyDb.affiliateLink.count({
        where: { id: { in: linkIds }, cpa: TARGET_CPA },
      }),
      verifyDb.commissionLog.count({
        where: {
          userId: { in: initialState.userIds },
          bettingHouse: HOUSE,
          field: 'cpa',
          newValue: TARGET_CPA,
          source: 'SCRIPT',
          createdAt: { gte: startedAt },
        },
      }),
      verifyDb.auditLog.count({
        where: {
          action: AUDIT_ACTION,
          path: AUDIT_PATH,
          createdAt: { gte: startedAt },
        },
      }),
      verifyDb.linkRequest.count({
        where: {
          dealId: DEAL_ID,
          bettingHouseSlug: HOUSE,
          status: 'FULFILLED',
          resolvedCpa: 105,
          user: { referredById: null },
        },
      }),
    ]);

    const verification = {
      remainingWrong,
      correctedRequests,
      correctedLinks,
      commissionLogs,
      batchAudits: audits,
      noInviterAt105: noInviter105,
    };
    if (
      remainingWrong !== 0 ||
      correctedRequests !== EXPECTED_TARGETS ||
      correctedLinks !== EXPECTED_TARGETS ||
      commissionLogs !== EXPECTED_TARGETS ||
      audits !== 1 ||
      noInviter105 !== initialState.noInviterAt105
    ) {
      throw new Error(
        `Verificacao independente falhou: ${JSON.stringify(verification)}`,
      );
    }
    return verification;
  } finally {
    await verifyDb.$disconnect();
  }
}

const startedAt = new Date();
const prisma = makeClient();
try {
  const state = await loadState(prisma);
  console.log(
    JSON.stringify(
      summary(state, APPLY ? 'apply-preview' : 'dry-run'),
      null,
      2,
    ),
  );
  if (!APPLY) {
    console.log(
      'DRY_RUN_OK: nenhuma escrita realizada; use APPLY=1 para aplicar.',
    );
  } else {
    const result = await applyCorrection(prisma, state, startedAt);
    console.log(JSON.stringify({ applied: result }, null, 2));
    const verification = await verifyFreshConnection(startedAt, state);
    console.log(JSON.stringify({ verified: verification }, null, 2));
  }
} catch (error) {
  console.error(
    `ABORTADO: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

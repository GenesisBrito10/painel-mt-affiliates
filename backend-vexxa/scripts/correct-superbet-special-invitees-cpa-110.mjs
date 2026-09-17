import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const DEAL_ID = '3a11aa0d-d9cf-467c-bc1a-1fd62f7a7429';
const HOUSE = 'superbet';
const SPECIAL_CPA = 120;
const TARGET_CPA = 110;
const EXPECTED_TARGETS = 102;
const EXPECTED_CHANGED_LINKS = 101;
const SPECIAL_USER_IDS = [
  '32084c0a-bbf9-4110-8bda-35b8f2f44446',
  'c6315803-0001-4794-8f82-44fc5b31c69f',
  'f06f6cd9-0d01-4468-b609-799b1b6c32c1',
];
const EXPECTED_REQUEST_DISTRIBUTION = { 95: 102 };
const EXPECTED_INVITER_DISTRIBUTION = { 105: 102 };
const EXPECTED_LINK_DISTRIBUTION = { 95: 98, 110: 1, 115: 3 };
const OPERATION_ID = 'superbet-special-invitees-cpa110-2026-08-24';
const AUDIT_ACTION = 'CORRECT_SUPERBET_SPECIAL_INVITEES_CPA_110';
const AUDIT_PATH = '/scripts/correct-superbet-special-invitees-cpa-110.mjs';
const APPLY = process.env.APPLY === '1';
const OPEN_WITHDRAWAL_STATUSES = ['PENDING', 'APPROVED', 'PROCESSING'];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL ausente');

const makeClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

const numeric = (value) => (value == null ? null : Number(value));

const distribution = (values) =>
  Object.fromEntries(
    [...values]
      .map((value) => String(value))
      .reduce((counts, value) => {
        counts.set(value, (counts.get(value) ?? 0) + 1);
        return counts;
      }, new Map())
      .entries(),
  );

const normalizedDistribution = (value) =>
  Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => Number(a) - Number(b)),
  );

function assertDistribution(actual, expected, label) {
  if (
    JSON.stringify(normalizedDistribution(actual)) !==
    JSON.stringify(normalizedDistribution(expected))
  ) {
    throw new Error(
      `${label} divergente: ${JSON.stringify(actual)}; esperado ${JSON.stringify(expected)}`,
    );
  }
}

function parseCampaign(request) {
  if (!Array.isArray(request.links) || request.links.length !== 1) {
    throw new Error(`Pedido ${request.id} nao possui exatamente uma URL`);
  }
  const item = request.links[0];
  const rawUrl = typeof item === 'string' ? item : item?.url;
  if (typeof rawUrl !== 'string') {
    throw new Error(`Pedido ${request.id} sem URL valida`);
  }
  const url = new URL(rawUrl);
  const siteId = url.searchParams.get('siteid');
  const campaign = url.searchParams.get('c');
  if (!siteId || !campaign) {
    throw new Error(`Pedido ${request.id} sem siteid/c`);
  }
  return `${siteId}-${campaign}`;
}

function assertRule(deal, rule) {
  if (!deal || !deal.active || deal.bettingHouseSlug !== HOUSE) {
    throw new Error('Deal Superbet Diario ausente, inativa ou divergente');
  }
  const actual = {
    ruleType: rule?.ruleType,
    defaultCpa: numeric(rule?.defaultCpa),
    fallbackCpa: numeric(rule?.fallbackCpa),
    threshold: numeric(rule?.inviterCpaThreshold),
    discount: numeric(rule?.inviterCpaDiscount),
    useInviterCpa: rule?.useInviterCpa,
  };
  if (
    actual.ruleType !== 'INVITER_DISCOUNT' ||
    actual.defaultCpa !== 105 ||
    actual.fallbackCpa !== 105 ||
    actual.threshold !== 105 ||
    actual.discount !== 10 ||
    actual.useInviterCpa !== true
  ) {
    throw new Error(`Regra Superbet divergente: ${JSON.stringify(actual)}`);
  }
}

async function loadState(db) {
  // Sequencial para também funcionar dentro de uma transação PrismaPg, que
  // compartilha uma única conexão PostgreSQL.
  const deal = await db.deal.findUnique({
    where: { id: DEAL_ID },
    select: { id: true, name: true, active: true, bettingHouseSlug: true },
  });
  const rule = await db.houseLinkRule.findUnique({
    where: { houseSlug: HOUSE },
  });
  const requests = await db.linkRequest.findMany({
    where: {
      dealId: DEAL_ID,
      bettingHouseSlug: HOUSE,
      status: 'FULFILLED',
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      userId: true,
      resolvedCpa: true,
      inviterCpa: true,
      links: true,
      user: {
        select: { name: true, email: true, referredById: true },
      },
    },
  });
  const pendingDirectInvitees = await db.linkRequest.count({
    where: {
      dealId: DEAL_ID,
      bettingHouseSlug: HOUSE,
      status: 'PENDING',
      user: { referredById: { in: SPECIAL_USER_IDS } },
    },
  });
  assertRule(deal, rule);
  if (pendingDirectInvitees !== 0) {
    throw new Error(
      `Existem ${pendingDirectInvitees} convidados diretos pendentes`,
    );
  }

  const campaignIds = requests.map(parseCampaign);
  if (new Set(campaignIds).size !== requests.length) {
    throw new Error('Campanhas duplicadas na deal ativa');
  }
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
      revshare: true,
    },
  });
  const linksByCampaign = new Map(
    affiliateLinks.map((link) => [link.campaignId, link]),
  );
  if (linksByCampaign.size !== requests.length) {
    throw new Error('Mapeamento incompleto entre pedidos e vinculos');
  }

  const activeSpecialRequests = requests.filter((request) => {
    const link = linksByCampaign.get(parseCampaign(request));
    return numeric(link?.cpa) === SPECIAL_CPA;
  });
  const activeSpecialIds = activeSpecialRequests
    .map((request) => request.userId)
    .sort();
  const expectedSpecialIds = [...SPECIAL_USER_IDS].sort();
  if (JSON.stringify(activeSpecialIds) !== JSON.stringify(expectedSpecialIds)) {
    throw new Error(
      `Usuarios especiais divergentes: ${JSON.stringify(activeSpecialIds)}`,
    );
  }

  const specialRequests = activeSpecialRequests.map((request) => {
    const campaignId = parseCampaign(request);
    const link = linksByCampaign.get(campaignId);
    if (!link || link.userId !== request.userId) {
      throw new Error(`Vinculo especial divergente: ${request.id}`);
    }
    return {
      requestId: request.id,
      affiliateLinkId: link.id,
      userId: request.userId,
      name: request.user.name,
      email: request.user.email,
      campaignId,
      requestCpa: numeric(request.resolvedCpa),
      linkCpa: numeric(link.cpa),
    };
  });

  const targetRequests = requests.filter((request) =>
    SPECIAL_USER_IDS.includes(request.user.referredById),
  );
  if (targetRequests.length !== EXPECTED_TARGETS) {
    throw new Error(
      `Quantidade de convidados divergente: ${targetRequests.length}; esperado ${EXPECTED_TARGETS}`,
    );
  }
  const targets = targetRequests.map((request) => {
    const campaignId = parseCampaign(request);
    const link = linksByCampaign.get(campaignId);
    if (!link || link.userId !== request.userId) {
      throw new Error(`Vinculo de convidado divergente: ${request.id}`);
    }
    return {
      requestId: request.id,
      affiliateLinkId: link.id,
      userId: request.userId,
      name: request.user.name,
      email: request.user.email,
      inviterUserId: request.user.referredById,
      campaignId,
      oldRequestCpa: numeric(request.resolvedCpa),
      oldInviterCpa: numeric(request.inviterCpa),
      oldLinkCpa: numeric(link.cpa),
      revshare: numeric(link.revshare),
    };
  });

  const targetUserIds = targets.map((target) => target.userId);
  const targetCampaignIds = targets.map((target) => target.campaignId);
  const metricRows = await db.affiliateData.count({
    where: { bettingHouse: HOUSE, campaignId: { in: targetCampaignIds } },
  });
  const openWithdrawals = await db.withdrawalRequest.count({
    where: {
      userId: { in: targetUserIds },
      bettingHouse: HOUSE,
      status: { in: OPEN_WITHDRAWAL_STATUSES },
    },
  });

  return {
    deal,
    rule,
    specialRequests,
    targets,
    metricRows,
    openWithdrawals,
  };
}

function assertBeforeState(state) {
  if (state.metricRows !== 0 || state.openWithdrawals !== 0) {
    throw new Error(
      `Impacto financeiro inseguro: metricRows=${state.metricRows}, openWithdrawals=${state.openWithdrawals}`,
    );
  }
  assertDistribution(
    distribution(state.specialRequests.map((item) => item.requestCpa)),
    { 105: 3 },
    'CPA dos pedidos especiais',
  );
  assertDistribution(
    distribution(state.specialRequests.map((item) => item.linkCpa)),
    { 120: 3 },
    'CPA dos vinculos especiais',
  );
  assertDistribution(
    distribution(state.targets.map((item) => item.oldRequestCpa)),
    EXPECTED_REQUEST_DISTRIBUTION,
    'CPA dos pedidos convidados',
  );
  assertDistribution(
    distribution(state.targets.map((item) => item.oldInviterCpa)),
    EXPECTED_INVITER_DISTRIBUTION,
    'Snapshot do convidante',
  );
  assertDistribution(
    distribution(state.targets.map((item) => item.oldLinkCpa)),
    EXPECTED_LINK_DISTRIBUTION,
    'CPA dos vinculos convidados',
  );
  assertDistribution(
    distribution(state.targets.map((item) => item.revshare)),
    { 0: EXPECTED_TARGETS },
    'RevShare dos convidados',
  );
}

function assertAfterState(state) {
  if (state.metricRows !== 0 || state.openWithdrawals !== 0) {
    throw new Error('Impacto financeiro apareceu apos a correcao');
  }
  assertDistribution(
    distribution(state.specialRequests.map((item) => item.requestCpa)),
    { 120: 3 },
    'CPA final dos pedidos especiais',
  );
  assertDistribution(
    distribution(state.specialRequests.map((item) => item.linkCpa)),
    { 120: 3 },
    'CPA final dos vinculos especiais',
  );
  assertDistribution(
    distribution(state.targets.map((item) => item.oldRequestCpa)),
    { 110: EXPECTED_TARGETS },
    'CPA final dos pedidos convidados',
  );
  assertDistribution(
    distribution(state.targets.map((item) => item.oldInviterCpa)),
    { 120: EXPECTED_TARGETS },
    'Snapshot final do convidante',
  );
  assertDistribution(
    distribution(state.targets.map((item) => item.oldLinkCpa)),
    { 110: EXPECTED_TARGETS },
    'CPA final dos vinculos convidados',
  );
}

function summary(state, mode) {
  return {
    mode,
    operationId: OPERATION_ID,
    deal: state.deal,
    specialUsers: state.specialRequests.map((item) => ({
      name: item.name,
      email: item.email,
      requestCpa: item.requestCpa,
      linkCpa: item.linkCpa,
    })),
    targets: state.targets.length,
    requestCpaBefore: distribution(
      state.targets.map((item) => item.oldRequestCpa),
    ),
    inviterCpaBefore: distribution(
      state.targets.map((item) => item.oldInviterCpa),
    ),
    linkCpaBefore: distribution(state.targets.map((item) => item.oldLinkCpa)),
    targetCpa: TARGET_CPA,
    metricRows: state.metricRows,
    openWithdrawals: state.openWithdrawals,
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

      const requestIds = [
        ...initialState.specialRequests.map((item) => item.requestId),
        ...initialState.targets.map((item) => item.requestId),
      ];
      const linkIds = [
        ...initialState.specialRequests.map((item) => item.affiliateLinkId),
        ...initialState.targets.map((item) => item.affiliateLinkId),
      ];
      const lockedRequests = await tx.$queryRaw(
        Prisma.sql`SELECT id FROM link_requests WHERE id IN (${Prisma.join(requestIds)}) FOR UPDATE`,
      );
      const lockedLinks = await tx.$queryRaw(
        Prisma.sql`SELECT id FROM affiliate_links WHERE id IN (${Prisma.join(linkIds)}) FOR UPDATE`,
      );
      if (
        lockedRequests.length !== SPECIAL_USER_IDS.length + EXPECTED_TARGETS ||
        lockedLinks.length !== SPECIAL_USER_IDS.length + EXPECTED_TARGETS
      ) {
        throw new Error('Contagem divergente durante bloqueio das linhas');
      }

      const state = await loadState(tx);
      assertBeforeState(state);
      if (
        JSON.stringify(state.targets) !== JSON.stringify(initialState.targets)
      ) {
        throw new Error('Estado dos convidados mudou entre previa e transacao');
      }

      const specialUpdate = await tx.linkRequest.updateMany({
        where: {
          id: { in: state.specialRequests.map((item) => item.requestId) },
          resolvedCpa: 105,
        },
        data: { resolvedCpa: SPECIAL_CPA },
      });
      const requestUpdate = await tx.linkRequest.updateMany({
        where: {
          id: { in: state.targets.map((item) => item.requestId) },
          resolvedCpa: 95,
          inviterCpa: 105,
        },
        data: { resolvedCpa: TARGET_CPA, inviterCpa: SPECIAL_CPA },
      });
      const linkUpdate = await tx.affiliateLink.updateMany({
        where: {
          id: { in: state.targets.map((item) => item.affiliateLinkId) },
          cpa: { in: [95, 110, 115] },
        },
        data: { cpa: TARGET_CPA },
      });
      if (
        specialUpdate.count !== SPECIAL_USER_IDS.length ||
        requestUpdate.count !== EXPECTED_TARGETS ||
        linkUpdate.count !== EXPECTED_TARGETS
      ) {
        throw new Error('Atualizacao parcial detectada; transacao abortada');
      }

      const changedTargets = state.targets.filter(
        (item) => item.oldLinkCpa !== TARGET_CPA,
      );
      const commissionLogs = await tx.commissionLog.createMany({
        data: changedTargets.map((item) => ({
          userId: item.userId,
          userName: item.name,
          userEmail: item.email,
          changedById: null,
          bettingHouse: HOUSE,
          field: 'cpa',
          oldValue: item.oldLinkCpa,
          newValue: TARGET_CPA,
          source: 'SCRIPT',
        })),
      });
      if (commissionLogs.count !== EXPECTED_CHANGED_LINKS) {
        throw new Error('Auditoria de comissao incompleta');
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
            specialUserIds: SPECIAL_USER_IDS,
            specialRequestCount: specialUpdate.count,
            inviteeRequestCount: requestUpdate.count,
            affiliateLinkCount: linkUpdate.count,
            commissionLogCount: commissionLogs.count,
            requestCpaBefore: EXPECTED_REQUEST_DISTRIBUTION,
            inviterCpaBefore: EXPECTED_INVITER_DISTRIBUTION,
            linkCpaBefore: EXPECTED_LINK_DISTRIBUTION,
            targetCpa: TARGET_CPA,
            metricRows: state.metricRows,
            openWithdrawals: state.openWithdrawals,
            requestIds: state.targets.map((item) => item.requestId),
            affiliateLinkIds: state.targets.map((item) => item.affiliateLinkId),
            startedAt: startedAt.toISOString(),
          },
        },
        select: { id: true },
      });

      return {
        specialRequests: specialUpdate.count,
        inviteeRequests: requestUpdate.count,
        affiliateLinks: linkUpdate.count,
        commissionLogs: commissionLogs.count,
        auditId: audit.id,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10_000,
      timeout: 60_000,
    },
  );
}

async function verifyFreshConnection(startedAt) {
  const verifyDb = makeClient();
  try {
    const [state, audits, commissionLogs] = await Promise.all([
      loadState(verifyDb),
      verifyDb.auditLog.count({
        where: {
          action: AUDIT_ACTION,
          path: AUDIT_PATH,
          createdAt: { gte: startedAt },
        },
      }),
      verifyDb.commissionLog.count({
        where: {
          userId: { in: SPECIAL_USER_IDS },
          bettingHouse: HOUSE,
          source: 'SCRIPT',
          createdAt: { gte: startedAt },
        },
      }),
    ]);
    assertAfterState(state);

    const targetCommissionLogs = await verifyDb.commissionLog.count({
      where: {
        userId: { in: state.targets.map((item) => item.userId) },
        bettingHouse: HOUSE,
        field: 'cpa',
        newValue: TARGET_CPA,
        source: 'SCRIPT',
        createdAt: { gte: startedAt },
      },
    });
    const verification = {
      specialRequestsAt120: state.specialRequests.length,
      inviteeRequestsAt110: state.targets.length,
      inviteeLinksAt110: state.targets.length,
      targetCommissionLogs,
      unexpectedSpecialCommissionLogs: commissionLogs,
      batchAudits: audits,
      metricRows: state.metricRows,
      openWithdrawals: state.openWithdrawals,
    };
    if (
      targetCommissionLogs !== EXPECTED_CHANGED_LINKS ||
      commissionLogs !== 0 ||
      audits !== 1
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
  assertBeforeState(state);
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
    const verification = await verifyFreshConnection(startedAt);
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

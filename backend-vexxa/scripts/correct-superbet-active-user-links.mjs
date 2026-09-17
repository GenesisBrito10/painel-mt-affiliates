import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const DEAL_ID = '3a11aa0d-d9cf-467c-bc1a-1fd62f7a7429';
const HOUSE = 'superbet';
const EXPECTED_REQUESTS = 108;
const EXPECTED_CORRECTIONS = 106;
const OPERATION_ID = 'superbet-diario-user-links-2026-08-24';
const AUDIT_ACTION = 'CORRECT_SUPERBET_DIARIO_USER_LINKS';
const AUDIT_PATH = '/scripts/correct-superbet-active-user-links.mjs';
const APPLY = process.env.APPLY === '1';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL ausente');

const makeClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

function parseRequestLink(request) {
  const links = Array.isArray(request.links) ? request.links : [];
  if (links.length !== 1) {
    throw new Error(
      `Pedido ${request.id} deve ter exatamente um link; encontrado ${links.length}`,
    );
  }

  const item = links[0];
  const url = typeof item === 'string' ? item : item?.url;
  if (typeof url !== 'string') {
    throw new Error(`Pedido ${request.id} sem URL valida`);
  }

  const parsed = new URL(url);
  const siteId = parsed.searchParams.get('siteid');
  const campaign = parsed.searchParams.get('c');
  if (!siteId || !campaign) {
    throw new Error(`Pedido ${request.id} sem siteid/c na URL`);
  }

  return {
    requestId: request.id,
    userId: request.userId,
    url,
    affiliateId: siteId,
    campaignId: `${siteId}-${campaign}`,
  };
}

async function loadState(db) {
  const deal = await db.deal.findUnique({
    where: { id: DEAL_ID },
    select: { id: true, name: true, active: true, bettingHouseSlug: true },
  });
  if (!deal || !deal.active || deal.bettingHouseSlug !== HOUSE) {
    throw new Error('Deal Superbet Diario ausente, inativa ou divergente');
  }

  const requests = await db.linkRequest.findMany({
    where: {
      dealId: DEAL_ID,
      bettingHouseSlug: HOUSE,
      status: 'FULFILLED',
    },
    orderBy: { id: 'asc' },
    select: { id: true, userId: true, links: true },
  });
  if (requests.length !== EXPECTED_REQUESTS) {
    throw new Error(
      `Quantidade de pedidos divergente: ${requests.length}; esperado ${EXPECTED_REQUESTS}`,
    );
  }

  const assignments = requests.map(parseRequestLink);
  const campaignIds = assignments.map((item) => item.campaignId);
  if (new Set(campaignIds).size !== EXPECTED_REQUESTS) {
    throw new Error('Campanhas duplicadas entre os pedidos da deal ativa');
  }

  const affiliateLinks = await db.affiliateLink.findMany({
    where: {
      bettingHouse: HOUSE,
      campaignId: { in: campaignIds },
      deletedAt: null,
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      userId: true,
      campaignId: true,
      affiliateId: true,
      userLink: true,
    },
  });
  if (affiliateLinks.length !== EXPECTED_REQUESTS) {
    throw new Error(
      `Quantidade de vinculos divergente: ${affiliateLinks.length}; esperado ${EXPECTED_REQUESTS}`,
    );
  }

  const linksByCampaign = new Map(
    affiliateLinks.map((link) => [link.campaignId, link]),
  );
  const plan = assignments.flatMap((assignment) => {
    const link = linksByCampaign.get(assignment.campaignId);
    if (!link || link.userId !== assignment.userId) {
      throw new Error(
        `Vinculo divergente para a campanha ${assignment.campaignId}`,
      );
    }
    if (
      link.userLink === assignment.url &&
      link.affiliateId === assignment.affiliateId
    ) {
      return [];
    }

    return [
      {
        affiliateLinkId: link.id,
        userId: assignment.userId,
        campaignId: assignment.campaignId,
        oldAffiliateId: link.affiliateId,
        newAffiliateId: assignment.affiliateId,
        oldUserLink: link.userLink,
        newUserLink: assignment.url,
      },
    ];
  });

  return { deal, requests, plan };
}

function assertExpectedPlan(state) {
  if (state.plan.length !== EXPECTED_CORRECTIONS) {
    throw new Error(
      `Quantidade de correcoes divergente: ${state.plan.length}; esperado ${EXPECTED_CORRECTIONS}`,
    );
  }
}

function summarize(state, mode) {
  return {
    mode,
    operationId: OPERATION_ID,
    deal: state.deal,
    fulfilledRequests: state.requests.length,
    corrections: state.plan.length,
    unchanged: state.requests.length - state.plan.length,
    targetCampaigns: state.plan.map((item) => item.campaignId),
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

      const requestIds = initialState.requests.map((item) => item.id);
      const linkIds = initialState.plan.map((item) => item.affiliateLinkId);
      const lockedRequests = await tx.$queryRaw(
        Prisma.sql`SELECT id FROM link_requests WHERE id IN (${Prisma.join(requestIds)}) FOR UPDATE`,
      );
      const lockedLinks = await tx.$queryRaw(
        Prisma.sql`SELECT id FROM affiliate_links WHERE id IN (${Prisma.join(linkIds)}) FOR UPDATE`,
      );
      if (
        lockedRequests.length !== EXPECTED_REQUESTS ||
        lockedLinks.length !== EXPECTED_CORRECTIONS
      ) {
        throw new Error('Contagem divergente durante bloqueio das linhas');
      }

      const freshState = await loadState(tx);
      assertExpectedPlan(freshState);
      const initialSnapshot = JSON.stringify(initialState.plan);
      const freshSnapshot = JSON.stringify(freshState.plan);
      if (freshSnapshot !== initialSnapshot) {
        throw new Error('Estado mudou entre a previa e a transacao');
      }

      let updated = 0;
      for (const item of freshState.plan) {
        const result = await tx.affiliateLink.updateMany({
          where: {
            id: item.affiliateLinkId,
            bettingHouse: HOUSE,
            campaignId: item.campaignId,
            userId: item.userId,
            affiliateId: item.oldAffiliateId,
            userLink: item.oldUserLink,
            deletedAt: null,
          },
          data: {
            affiliateId: item.newAffiliateId,
            userLink: item.newUserLink,
          },
        });
        if (result.count !== 1) {
          throw new Error(
            `Atualizacao divergente para ${item.affiliateLinkId}; transacao abortada`,
          );
        }
        updated += result.count;
      }

      const audit = await tx.auditLog.create({
        data: {
          userId: null,
          userName: 'Sistema',
          userEmail: 'system@vexxa.local',
          action: AUDIT_ACTION,
          resource: 'affiliate_links',
          method: 'PATCH',
          path: AUDIT_PATH,
          statusCode: 200,
          details: {
            operationId: OPERATION_ID,
            dealId: DEAL_ID,
            requestCount: EXPECTED_REQUESTS,
            affiliateLinkCount: updated,
            corrections: freshState.plan,
            startedAt: startedAt.toISOString(),
          },
        },
        select: { id: true },
      });

      return { updated, auditId: audit.id };
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
    const [state, auditCount] = await Promise.all([
      loadState(verifyDb),
      verifyDb.auditLog.count({
        where: {
          action: AUDIT_ACTION,
          path: AUDIT_PATH,
          createdAt: { gte: startedAt },
        },
      }),
    ]);
    const verification = {
      fulfilledRequests: state.requests.length,
      remainingCorrections: state.plan.length,
      batchAudits: auditCount,
    };
    if (state.plan.length !== 0 || auditCount !== 1) {
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
  assertExpectedPlan(state);
  console.log(
    JSON.stringify(
      summarize(state, APPLY ? 'apply-preview' : 'dry-run'),
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

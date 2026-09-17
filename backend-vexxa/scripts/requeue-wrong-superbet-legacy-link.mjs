import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const HOUSE = 'superbet';
const ACTIVE_DEAL_ID = '3a11aa0d-d9cf-467c-bc1a-1fd62f7a7429';
const WRONG_REQUEST_ID = 'b29cec48-3a04-428b-8440-19f6921702bd';
const WRONG_USER_ID = 'e3fbb6d2-8995-4674-82b2-b50c7f4a5ec3';
const WRONG_LINK_ID = '8f1b5eec-c2f4-4625-a234-64689a5e5954';
const WRONG_CAMPAIGN_ID = '5602-VALLEXBR1775';
const WRONG_URL =
  'https://wlsuperbet.adsrv.eacdn.com/C.ashx?btag=a_5602b_431c_&affid=662&siteid=5602&adid=431&c=VALLEXBR1775';
const PENDING_CAMPAIGN_ID = `pending-superbet-${WRONG_REQUEST_ID}`;

const REPORTED_REQUEST_ID = 'a9d1196f-214d-41d7-9143-febcf623bc6a';
const REPORTED_USER_ID = '7ba6dfe5-c6d8-435b-80b2-8e302a3da267';
const REPLACEMENT_REQUEST_ID = 'c1122f4c-c2a4-4bfa-9be5-3bab6534e494';
const REPLACEMENT_CAMPAIGN_ID = '5565-MJM159';

const OPERATION_ID = 'requeue-wrong-superbet-legacy-link-2026-08-24';
const AUDIT_ACTION = 'REQUEUE_WRONG_SUPERBET_LEGACY_LINK';
const AUDIT_PATH = '/scripts/requeue-wrong-superbet-legacy-link.mjs';
const APPLY = process.env.APPLY === '1';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL ausente');

const makeClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

const numeric = (value) => (value == null ? null : Number(value));

function requestUrl(request) {
  if (!Array.isArray(request.links) || request.links.length !== 1) return null;
  const item = request.links[0];
  return typeof item === 'string' ? item : (item?.url ?? null);
}

async function loadState(db) {
  const activeDeal = await db.deal.findUnique({
    where: { id: ACTIVE_DEAL_ID },
    select: { id: true, name: true, active: true, bettingHouseSlug: true },
  });
  const wrongRequest = await db.linkRequest.findUnique({
    where: { id: WRONG_REQUEST_ID },
    select: {
      id: true,
      userId: true,
      dealId: true,
      bettingHouseSlug: true,
      status: true,
      links: true,
      adminNote: true,
      fulfilledAt: true,
      fulfilledById: true,
      fulfilledByName: true,
      resolvedCpa: true,
      resolvedRevshare: true,
      inviterCpa: true,
      user: { select: { name: true, email: true } },
    },
  });
  const wrongLink = await db.affiliateLink.findUnique({
    where: { id: WRONG_LINK_ID },
    select: {
      id: true,
      userId: true,
      bettingHouse: true,
      campaignId: true,
      affiliateId: true,
      userLink: true,
      cpa: true,
      revshare: true,
      source: true,
      providerAccountId: true,
      deletedAt: true,
    },
  });
  const reportedRequest = await db.linkRequest.findUnique({
    where: { id: REPORTED_REQUEST_ID },
    select: {
      id: true,
      userId: true,
      deal: { select: { active: true } },
      status: true,
      links: true,
    },
  });
  const replacementRequest = await db.linkRequest.findUnique({
    where: { id: REPLACEMENT_REQUEST_ID },
    select: {
      id: true,
      userId: true,
      dealId: true,
      status: true,
      links: true,
    },
  });
  const replacementLink = await db.affiliateLink.findFirst({
    where: {
      userId: REPORTED_USER_ID,
      bettingHouse: HOUSE,
      deletedAt: null,
    },
    select: { id: true, campaignId: true, userLink: true },
  });
  const activeLegacyRequests = await db.$queryRaw(
    Prisma.sql`
      SELECT lr.id
      FROM link_requests lr
      JOIN deals d ON d.id = lr."dealId"
      WHERE lr."bettingHouseSlug" = ${HOUSE}
        AND d.active = true
        AND lr.status = 'FULFILLED'::"LinkRequestStatus"
        AND (
          lr.links::text ILIKE ${'%siteid=5602%'}
          OR lr.links::text ILIKE ${'%VALLEXBR%'}
        )
      ORDER BY lr.id
    `,
  );
  const metricRows = await db.affiliateData.count({
    where: { bettingHouse: HOUSE, campaignId: WRONG_CAMPAIGN_ID },
  });
  const openWithdrawals = await db.withdrawalRequest.count({
    where: {
      userId: WRONG_USER_ID,
      bettingHouse: HOUSE,
      status: { in: ['PENDING', 'APPROVED', 'PROCESSING'] },
    },
  });

  return {
    activeDeal,
    wrongRequest,
    wrongLink,
    reportedRequest,
    replacementRequest,
    replacementLink,
    activeLegacyRequestIds: activeLegacyRequests.map((row) => row.id),
    metricRows,
    openWithdrawals,
  };
}

function assertReportedUserAlreadyCorrect(state) {
  if (
    state.reportedRequest?.userId !== REPORTED_USER_ID ||
    state.reportedRequest.status !== 'FULFILLED' ||
    state.reportedRequest.deal?.active !== false ||
    !requestUrl(state.reportedRequest)?.includes('VALLEXBR1774') ||
    state.replacementRequest?.userId !== REPORTED_USER_ID ||
    state.replacementRequest.dealId !== ACTIVE_DEAL_ID ||
    state.replacementRequest.status !== 'FULFILLED' ||
    !requestUrl(state.replacementRequest)?.includes('siteid=5565') ||
    state.replacementLink?.campaignId !== REPLACEMENT_CAMPAIGN_ID ||
    !state.replacementLink.userLink?.includes('siteid=5565')
  ) {
    throw new Error(
      'O usuario do link informado nao possui a substituicao esperada na deal nova',
    );
  }
}

function assertBefore(state) {
  assertReportedUserAlreadyCorrect(state);
  if (
    !state.activeDeal?.active ||
    state.activeDeal.bettingHouseSlug !== HOUSE
  ) {
    throw new Error('Deal ativa da Superbet divergente');
  }
  if (
    state.activeLegacyRequestIds.length !== 1 ||
    state.activeLegacyRequestIds[0] !== WRONG_REQUEST_ID
  ) {
    throw new Error(
      `Solicitacoes legadas ativas divergentes: ${JSON.stringify(state.activeLegacyRequestIds)}`,
    );
  }
  const request = state.wrongRequest;
  const link = state.wrongLink;
  if (
    !request ||
    request.userId !== WRONG_USER_ID ||
    request.dealId !== ACTIVE_DEAL_ID ||
    request.bettingHouseSlug !== HOUSE ||
    request.status !== 'FULFILLED' ||
    requestUrl(request) !== WRONG_URL ||
    numeric(request.resolvedCpa) !== 95 ||
    numeric(request.resolvedRevshare) !== 0 ||
    numeric(request.inviterCpa) !== 125 ||
    !link ||
    link.userId !== WRONG_USER_ID ||
    link.bettingHouse !== HOUSE ||
    link.campaignId !== WRONG_CAMPAIGN_ID ||
    link.affiliateId !== '5602' ||
    link.userLink !== WRONG_URL ||
    numeric(link.cpa) !== 95 ||
    numeric(link.revshare) !== 0 ||
    link.deletedAt !== null
  ) {
    throw new Error('Estado inicial do caso VALLEXBR1775 divergente');
  }
  if (state.metricRows !== 0 || state.openWithdrawals !== 0) {
    throw new Error(
      `Impacto financeiro inseguro: metricRows=${state.metricRows}, openWithdrawals=${state.openWithdrawals}`,
    );
  }
}

function assertAfter(state) {
  assertReportedUserAlreadyCorrect(state);
  const request = state.wrongRequest;
  const link = state.wrongLink;
  if (
    !request ||
    request.status !== 'PENDING' ||
    request.fulfilledAt !== null ||
    request.fulfilledById !== null ||
    request.fulfilledByName !== '' ||
    !Array.isArray(request.links) ||
    request.links.length !== 0 ||
    numeric(request.resolvedCpa) !== 95 ||
    numeric(request.resolvedRevshare) !== 0 ||
    numeric(request.inviterCpa) !== 125 ||
    !link ||
    link.campaignId !== PENDING_CAMPAIGN_ID ||
    link.affiliateId !== '' ||
    link.userLink !== null ||
    numeric(link.cpa) !== 95 ||
    numeric(link.revshare) !== 0 ||
    link.deletedAt !== null ||
    state.activeLegacyRequestIds.length !== 0
  ) {
    throw new Error('Estado final do caso VALLEXBR1775 divergente');
  }
  if (state.metricRows !== 0 || state.openWithdrawals !== 0) {
    throw new Error('Impacto financeiro apareceu apos a correcao');
  }
}

function publicSummary(state) {
  return {
    activeDeal: state.activeDeal,
    reportedUrlUser: {
      oldRequestId: state.reportedRequest?.id,
      oldRequestStatus: state.reportedRequest?.status,
      replacementRequestId: state.replacementRequest?.id,
      replacementStatus: state.replacementRequest?.status,
      replacementCampaignId: state.replacementLink?.campaignId,
    },
    wrongActiveRequest: state.wrongRequest
      ? {
          id: state.wrongRequest.id,
          email: state.wrongRequest.user.email,
          status: state.wrongRequest.status,
          campaignId: state.wrongLink?.campaignId,
          cpa: numeric(state.wrongRequest.resolvedCpa),
          inviterCpa: numeric(state.wrongRequest.inviterCpa),
        }
      : null,
    activeLegacyRequestIds: state.activeLegacyRequestIds,
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

      const lockedRequest = await tx.$queryRaw(
        Prisma.sql`SELECT id FROM link_requests WHERE id = ${WRONG_REQUEST_ID} FOR UPDATE`,
      );
      const lockedLink = await tx.$queryRaw(
        Prisma.sql`SELECT id FROM affiliate_links WHERE id = ${WRONG_LINK_ID} FOR UPDATE`,
      );
      if (lockedRequest.length !== 1 || lockedLink.length !== 1) {
        throw new Error('Bloqueio do pedido/vinculo incompleto');
      }

      const state = await loadState(tx);
      assertBefore(state);
      if (
        JSON.stringify(publicSummary(state)) !==
        JSON.stringify(publicSummary(initialState))
      ) {
        throw new Error('Estado mudou entre a previa e a transacao');
      }

      const requestUpdate = await tx.linkRequest.updateMany({
        where: {
          id: WRONG_REQUEST_ID,
          userId: WRONG_USER_ID,
          dealId: ACTIVE_DEAL_ID,
          status: 'FULFILLED',
        },
        data: {
          status: 'PENDING',
          links: [],
          fulfilledAt: null,
          fulfilledById: null,
          fulfilledByName: '',
          adminNote:
            'Reaberta: link legado VALLEXBR1775 atribuido indevidamente na nova deal.',
        },
      });
      const linkUpdate = await tx.affiliateLink.updateMany({
        where: {
          id: WRONG_LINK_ID,
          userId: WRONG_USER_ID,
          bettingHouse: HOUSE,
          campaignId: WRONG_CAMPAIGN_ID,
          deletedAt: null,
        },
        data: {
          campaignId: PENDING_CAMPAIGN_ID,
          affiliateId: '',
          userLink: null,
          providerAccountId: null,
        },
      });
      if (requestUpdate.count !== 1 || linkUpdate.count !== 1) {
        throw new Error('Atualizacao parcial detectada');
      }

      await tx.auditLog.create({
        data: {
          userId: state.wrongRequest.userId,
          userName: state.wrongRequest.user.name,
          userEmail: state.wrongRequest.user.email,
          action: AUDIT_ACTION,
          resource: 'LinkRequest',
          method: 'SCRIPT',
          path: AUDIT_PATH,
          details: {
            operationId: OPERATION_ID,
            startedAt: startedAt.toISOString(),
            requestId: WRONG_REQUEST_ID,
            dealId: ACTIVE_DEAL_ID,
            affiliateLinkId: WRONG_LINK_ID,
            oldCampaignId: WRONG_CAMPAIGN_ID,
            oldUrl: WRONG_URL,
            preservedResolvedCpa: numeric(state.wrongRequest.resolvedCpa),
            preservedInviterCpa: numeric(state.wrongRequest.inviterCpa),
            newStatus: 'PENDING',
            newCampaignId: PENDING_CAMPAIGN_ID,
            reportedRequestId: REPORTED_REQUEST_ID,
            reportedUserAlreadyCorrect: true,
            replacementRequestId: REPLACEMENT_REQUEST_ID,
            replacementCampaignId: REPLACEMENT_CAMPAIGN_ID,
            activeLegacyRequestIdsBefore: state.activeLegacyRequestIds,
            metricRows: state.metricRows,
            openWithdrawals: state.openWithdrawals,
          },
        },
      });

      const after = await loadState(tx);
      assertAfter(after);
      return after;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

async function main() {
  const startedAt = new Date();
  const preview = makeClient();
  try {
    const before = await loadState(preview);
    assertBefore(before);
    console.log('PREVIEW');
    console.log(JSON.stringify(publicSummary(before), null, 2));
    if (!APPLY) {
      console.log('\nDRY-RUN concluido. Execute com APPLY=1 para aplicar.');
      return;
    }

    const write = makeClient();
    try {
      const after = await applyCorrection(write, before, startedAt);
      console.log('\nAPLICADO');
      console.log(JSON.stringify(publicSummary(after), null, 2));
    } finally {
      await write.$disconnect();
    }

    const verify = makeClient();
    try {
      const finalState = await loadState(verify);
      assertAfter(finalState);
      const auditCount = await verify.auditLog.count({
        where: { action: AUDIT_ACTION, path: AUDIT_PATH },
      });
      if (auditCount !== 1) {
        throw new Error(`Quantidade de auditorias divergente: ${auditCount}`);
      }
      console.log('\nVERIFICACAO INDEPENDENTE OK');
      console.log(
        JSON.stringify({ ...publicSummary(finalState), auditCount }, null, 2),
      );
    } finally {
      await verify.$disconnect();
    }
  } finally {
    await preview.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const ACCOUNT_ID = 'e9bba0a7-94e7-4b28-b98b-2430c3269c40';
const ACCOUNT_EMAIL = 'mjm@afiliadosexternos.com';
const ACCOUNT_NAME = 'Vallex 4';
const PROVIDER = 'betboard';
const HOUSE = 'superbet';
const BOOKMARKER_ID = 'aad5fd62-ee9a-4d36-8f72-6f363ca59e13';
const RETIRED_API_BASE = 'https://api.betboard.com.br/api';
const CURRENT_API_BASE = 'https://api-affiliates.mgaffiliates.site/api';
const DATES = ['2026-08-23', '2026-08-24', '2026-08-25'];
const TRIGGERED_BY = 'script-betboard-recovery-vallex4';
const OPERATION_ID = 'betboard-api-recovery-vallex4-2026-08-25';
const AUDIT_ACTION = 'UPDATE_BETBOARD_API_BASE';
const AUDIT_PATH = '/scripts/update-betboard-api-and-backfill-superbet.mjs';
const APPLY = process.env.APPLY === '1';
const BACKFILL = process.env.BACKFILL === '1';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL ausente');

const makeClient = () =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

async function loadState(db) {
  const account = await db.providerAccount.findUnique({
    where: { id: ACCOUNT_ID },
    select: {
      id: true,
      name: true,
      provider: true,
      email: true,
      apiBaseUrl: true,
      active: true,
      lastUsedAt: true,
      lastError: true,
      houses: {
        where: { bettingHouseSlug: HOUSE },
        select: {
          id: true,
          bettingHouseSlug: true,
          bookmarkerId: true,
          active: true,
          bettingHouse: {
            select: {
              active: true,
              syncMode: true,
              lastSyncAt: true,
            },
          },
        },
      },
    },
  });
  const auditCount = await db.auditLog.count({
    where: { action: AUDIT_ACTION, path: AUDIT_PATH },
  });
  return { account, auditCount };
}

function assertIdentity(state) {
  const account = state.account;
  const association = account?.houses[0];
  if (
    !account ||
    account.id !== ACCOUNT_ID ||
    account.name !== ACCOUNT_NAME ||
    account.provider !== PROVIDER ||
    account.email.toLowerCase() !== ACCOUNT_EMAIL ||
    !account.active ||
    account.houses.length !== 1 ||
    !association ||
    association.bettingHouseSlug !== HOUSE ||
    association.bookmarkerId !== BOOKMARKER_ID ||
    !association.active ||
    !association.bettingHouse.active ||
    association.bettingHouse.syncMode !== 'AUTO'
  ) {
    throw new Error('Identidade/configuracao da conta Superbet divergente');
  }
}

function assertBefore(state) {
  assertIdentity(state);
  if (state.account.apiBaseUrl !== RETIRED_API_BASE) {
    throw new Error(`API base inicial divergente: ${state.account.apiBaseUrl}`);
  }
  if (state.auditCount !== 0) {
    throw new Error(`Operacao ${OPERATION_ID} ja aplicada`);
  }
}

function assertAfter(state) {
  assertIdentity(state);
  if (state.account.apiBaseUrl !== CURRENT_API_BASE) {
    throw new Error(`API base final divergente: ${state.account.apiBaseUrl}`);
  }
  if (state.auditCount !== 1) {
    throw new Error(`Quantidade de auditorias divergente: ${state.auditCount}`);
  }
}

function summary(state) {
  const association = state.account?.houses[0];
  return {
    account: state.account
      ? {
          id: state.account.id,
          name: state.account.name,
          email: state.account.email,
          provider: state.account.provider,
          active: state.account.active,
          apiBaseUrl: state.account.apiBaseUrl,
          lastUsedAt: state.account.lastUsedAt,
          lastError: state.account.lastError,
        }
      : null,
    association: association
      ? {
          id: association.id,
          house: association.bettingHouseSlug,
          bookmarkerId: association.bookmarkerId,
          active: association.active,
          houseActive: association.bettingHouse.active,
          syncMode: association.bettingHouse.syncMode,
          lastSyncAt: association.bettingHouse.lastSyncAt,
        }
      : null,
    auditCount: state.auditCount,
  };
}

async function applyConfiguration(db, expectedState) {
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT 1::int AS locked FROM pg_advisory_xact_lock(hashtext(${OPERATION_ID}))`,
      );
      const locked = await tx.$queryRaw(
        Prisma.sql`SELECT id FROM provider_accounts WHERE id = ${ACCOUNT_ID} FOR UPDATE`,
      );
      if (locked.length !== 1) throw new Error('Bloqueio da conta incompleto');

      const current = await loadState(tx);
      assertBefore(current);
      if (
        JSON.stringify(summary(current)) !==
        JSON.stringify(summary(expectedState))
      ) {
        throw new Error('Estado mudou entre a previa e a transacao');
      }

      const changed = await tx.providerAccount.updateMany({
        where: {
          id: ACCOUNT_ID,
          provider: PROVIDER,
          email: ACCOUNT_EMAIL,
          apiBaseUrl: RETIRED_API_BASE,
          active: true,
        },
        data: { apiBaseUrl: CURRENT_API_BASE },
      });
      if (changed.count !== 1) {
        throw new Error(`Atualizacao parcial: ${changed.count}`);
      }

      await tx.auditLog.create({
        data: {
          userName: 'Sistema',
          userEmail: 'system@vexxa.local',
          action: AUDIT_ACTION,
          resource: 'provider_accounts',
          method: 'PATCH',
          path: AUDIT_PATH,
          details: {
            operationId: OPERATION_ID,
            accountId: ACCOUNT_ID,
            accountName: ACCOUNT_NAME,
            accountEmail: ACCOUNT_EMAIL,
            provider: PROVIDER,
            bettingHouse: HOUSE,
            oldApiBaseUrl: RETIRED_API_BASE,
            newApiBaseUrl: CURRENT_API_BASE,
            backfillDates: DATES,
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

async function runBackfill() {
  const modules = await Promise.all([
    import('@nestjs/config'),
    import('../dist/src/modules/shared/crypto.service.js'),
    import('../dist/src/modules/prisma/prisma.service.js'),
    import('../dist/src/modules/provider-account/infrastructure/persistence/provider-account.prisma-repository.js'),
    import('../dist/src/modules/provider-account/application/provider-account-credential.service.js'),
    import('../dist/src/modules/sync/infrastructure/persistence/sync.prisma-repository.js'),
    import('../dist/src/modules/sync/application/sync-orchestrator.service.js'),
    import('../dist/src/modules/sync/infrastructure/extractors/betboard.extractor.js'),
  ]);
  const exported = (module, name) => module[name] ?? module.default?.[name];
  const ConfigService = exported(modules[0], 'ConfigService');
  const CryptoService = exported(modules[1], 'CryptoService');
  const PrismaService = exported(modules[2], 'PrismaService');
  const ProviderAccountPrismaRepository = exported(
    modules[3],
    'ProviderAccountPrismaRepository',
  );
  const ProviderAccountCredentialService = exported(
    modules[4],
    'ProviderAccountCredentialService',
  );
  const SyncPrismaRepository = exported(modules[5], 'SyncPrismaRepository');
  const SyncOrchestratorService = exported(
    modules[6],
    'SyncOrchestratorService',
  );
  const BetboardExtractor = exported(modules[7], 'BetboardExtractor');
  if (
    !ConfigService ||
    !CryptoService ||
    !PrismaService ||
    !ProviderAccountPrismaRepository ||
    !ProviderAccountCredentialService ||
    !SyncPrismaRepository ||
    !SyncOrchestratorService ||
    !BetboardExtractor
  ) {
    throw new Error('Build dist incompleto para executar o backfill');
  }

  const config = new ConfigService(process.env);
  const prisma = new PrismaService(config);
  await prisma.$connect();
  try {
    const accountRepo = new ProviderAccountPrismaRepository(prisma);
    const account = await accountRepo.findById(ACCOUNT_ID);
    const association = account?.houses.find(
      (item) => item.bettingHouseSlug === HOUSE,
    );
    if (
      !account ||
      account.email.toLowerCase() !== ACCOUNT_EMAIL ||
      account.provider !== PROVIDER ||
      account.apiBaseUrl !== CURRENT_API_BASE ||
      !account.active ||
      !association?.active ||
      association.bookmarkerId !== BOOKMARKER_ID
    ) {
      throw new Error('Conta divergente antes do backfill');
    }

    const syncRepo = new SyncPrismaRepository(prisma);
    const credentials = new ProviderAccountCredentialService(
      accountRepo,
      new CryptoService(config),
    );
    const extractor = new BetboardExtractor();
    const webhook = {
      emitAffiliateDataSynced: async () => undefined,
    };
    const orchestrator = new SyncOrchestratorService(
      syncRepo,
      credentials,
      new Map([[PROVIDER, extractor]]),
      webhook,
    );
    return await orchestrator.runSync({
      account,
      houseSlug: HOUSE,
      bookmarkerId: BOOKMARKER_ID,
      triggeredBy: TRIGGERED_BY,
      dates: DATES,
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function verifyBackfill(db) {
  const logs = await db.syncLog.findMany({
    where: { bettingHouse: HOUSE, triggeredBy: TRIGGERED_BY },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      status: true,
      periodStart: true,
      periodEnd: true,
      totalRecords: true,
      inserted: true,
      updated: true,
      errors: true,
      errorMessage: true,
      createdAt: true,
    },
  });
  const rowsByDate = await db.affiliateData.groupBy({
    by: ['date'],
    where: {
      bettingHouse: HOUSE,
      utmCampaign: ACCOUNT_NAME,
      date: {
        gte: new Date(`${DATES[0]}T00:00:00.000Z`),
        lte: new Date(`${DATES[DATES.length - 1]}T23:59:59.999Z`),
      },
    },
    _count: { _all: true },
    _sum: {
      clicks: true,
      registrations: true,
      ftds: true,
      qftd: true,
      cpaQualified: true,
    },
    orderBy: { date: 'asc' },
  });
  const currentCampaignRows = await db.affiliateData.count({
    where: {
      bettingHouse: HOUSE,
      utmCampaign: ACCOUNT_NAME,
      campaignId: { startsWith: '5565-' },
      date: {
        gte: new Date(`${DATES[0]}T00:00:00.000Z`),
        lte: new Date(`${DATES[DATES.length - 1]}T23:59:59.999Z`),
      },
    },
  });
  const taggedCurrentLinks = await db.affiliateLink.count({
    where: {
      bettingHouse: HOUSE,
      providerAccountId: ACCOUNT_ID,
      campaignId: { startsWith: '5565-' },
      deletedAt: null,
    },
  });

  const successfulLogs = logs.filter(
    (log) =>
      log.status === 'SUCCESS' &&
      log.errors === 0 &&
      log.errorMessage === null,
  );
  if (
    successfulLogs.length < 1 ||
    rowsByDate.length < 2 ||
    currentCampaignRows === 0 ||
    taggedCurrentLinks === 0
  ) {
    throw new Error('Verificacao do backfill divergente');
  }
  return {
    logs,
    successfulLogCount: successfulLogs.length,
    rowsByDate,
    currentCampaignRows,
    taggedCurrentLinks,
  };
}

async function main() {
  const preview = makeClient();
  try {
    const before = await loadState(preview);
    const needsConfigurationUpdate =
      before.account?.apiBaseUrl === RETIRED_API_BASE;
    if (needsConfigurationUpdate) assertBefore(before);
    else assertAfter(before);
    console.log('PREVIEW');
    console.log(JSON.stringify(summary(before), null, 2));

    if (!APPLY) {
      console.log('\nDRY-RUN concluido. Use APPLY=1 para atualizar a conta.');
      return;
    }
    const after = needsConfigurationUpdate
      ? await applyConfiguration(preview, before)
      : before;
    console.log(
      needsConfigurationUpdate
        ? '\nCONFIGURACAO APLICADA'
        : '\nCONFIGURACAO JA ESTAVA APLICADA',
    );
    console.log(JSON.stringify(summary(after), null, 2));

    if (!BACKFILL) {
      console.log(
        '\nBackfill nao executado. Use BACKFILL=1 junto com APPLY=1.',
      );
      return;
    }
  } finally {
    await preview.$disconnect();
  }

  const result = await runBackfill();
  console.log('\nBACKFILL EXECUTADO');
  console.log(JSON.stringify(result, null, 2));

  const verify = makeClient();
  try {
    const state = await loadState(verify);
    assertAfter(state);
    const backfill = await verifyBackfill(verify);
    console.log('\nVERIFICACAO INDEPENDENTE OK');
    console.log(JSON.stringify({ state: summary(state), backfill }, null, 2));
  } finally {
    await verify.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

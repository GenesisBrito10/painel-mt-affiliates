/**
 * SportingBet Diário — casa, deal, regra e associação OTG inativos.
 *
 *   node --env-file=.env scripts/setup-sportingbet-diario.mjs
 *   node --env-file=.env scripts/setup-sportingbet-diario.mjs --apply
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const APPLY = process.argv.includes('--apply');
const SLUG = 'sportingbet-diario';
const NAME = 'SportingBet Diário';
const BASE_SLUG = 'sportingbet';
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const DRY_RUN_ROLLBACK = Symbol('DRY_RUN_ROLLBACK');

const json = (value) =>
  JSON.stringify(
    value,
    (_key, current) =>
      typeof current?.toNumber === 'function' ? current.toNumber() : current,
    2,
  );

async function configure(tx) {
  const houseData = {
    name: NAME,
    active: false,
    syncMode: 'AUTO',
    withdrawalEnabled: true,
    minAvgDepositPerCpa: 40,
    minCpaToWithdraw: 0,
    withdrawalDay: null,
    withdrawalDayEnd: null,
    withdrawalDay2: null,
    withdrawalDay2End: null,
    withdrawalWeekday: null,
  };
  const house = await tx.bettingHouse.upsert({
    where: { slug: SLUG },
    create: { slug: SLUG, ...houseData },
    update: houseData,
    select: {
      slug: true,
      name: true,
      active: true,
      syncMode: true,
      minAvgDepositPerCpa: true,
      withdrawalDay: true,
      withdrawalWeekday: true,
    },
  });

  const dealData = {
    name: NAME,
    cpa: 60,
    revshare: 0,
    minAvgDepositPerFtd: 40,
    conditionsText: 'Depósito médio mínimo: R$ 40,00\nRollover: 2x',
    paymentNotes: 'Pagamento Diário',
    active: false,
  };
  const existingDeal = await tx.deal.findFirst({
    where: { bettingHouseSlug: SLUG },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  const deal = existingDeal
    ? await tx.deal.update({
        where: { id: existingDeal.id },
        data: dealData,
        select: {
          id: true,
          name: true,
          active: true,
          cpa: true,
          revshare: true,
          minAvgDepositPerFtd: true,
          conditionsText: true,
        },
      })
    : await tx.deal.create({
        data: {
          bettingHouseSlug: SLUG,
          ...dealData,
        },
        select: {
          id: true,
          name: true,
          active: true,
          cpa: true,
          revshare: true,
          minAvgDepositPerFtd: true,
          conditionsText: true,
        },
      });

  const rule = await tx.houseLinkRule.upsert({
    where: { houseSlug: SLUG },
    create: {
      houseSlug: SLUG,
      requestEnabled: false,
      autoAssignEnabled: false,
      ruleType: 'INVITER_DISCOUNT',
      defaultCpa: 60,
      fallbackCpa: 60,
      inviterCpaThreshold: 60,
      inviterCpaDiscount: 5,
      defaultRevshare: 0,
      checkExistingLink: true,
      checkPendingRequest: true,
      useInviterCpa: true,
      applyFallbackNoInviterCpa: true,
      applyDefaultNoInviter: true,
      processOldRequests: true,
      requireActiveLinkInHouses: false,
      requiredHouseSlugs: [],
      blockMessage: '',
      updatedByName: 'setup-sportingbet-diario',
    },
    update: {
      requestEnabled: false,
      autoAssignEnabled: false,
      ruleType: 'INVITER_DISCOUNT',
      defaultCpa: 60,
      fallbackCpa: 60,
      inviterCpaThreshold: 60,
      inviterCpaDiscount: 5,
      defaultRevshare: 0,
      checkExistingLink: true,
      checkPendingRequest: true,
      useInviterCpa: true,
      applyFallbackNoInviterCpa: true,
      applyDefaultNoInviter: true,
      processOldRequests: true,
      requireActiveLinkInHouses: false,
      requiredHouseSlugs: [],
      blockMessage: '',
      updatedByName: 'setup-sportingbet-diario',
    },
    select: {
      houseSlug: true,
      requestEnabled: true,
      autoAssignEnabled: true,
      ruleType: true,
      defaultCpa: true,
      fallbackCpa: true,
      inviterCpaThreshold: true,
      inviterCpaDiscount: true,
      defaultRevshare: true,
      processOldRequests: true,
    },
  });

  const baseAssociation = await tx.providerAccountHouse.findFirst({
    where: {
      bettingHouseSlug: BASE_SLUG,
      providerAccount: { provider: 'otg' },
    },
    orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
    select: {
      providerAccountId: true,
      bookmarkerId: true,
      providerAccount: { select: { name: true, provider: true } },
    },
  });
  if (!baseAssociation) {
    throw new Error(
      'Associação OTG da SportingBet não encontrada; seed interrompido.',
    );
  }

  const association = await tx.providerAccountHouse.upsert({
    where: {
      uq_account_house: {
        providerAccountId: baseAssociation.providerAccountId,
        bettingHouseSlug: SLUG,
      },
    },
    create: {
      providerAccountId: baseAssociation.providerAccountId,
      bettingHouseSlug: SLUG,
      bookmarkerId: baseAssociation.bookmarkerId,
      active: false,
    },
    update: {
      bookmarkerId: baseAssociation.bookmarkerId,
      active: false,
    },
    select: {
      bettingHouseSlug: true,
      bookmarkerId: true,
      active: true,
      providerAccount: {
        select: { name: true, provider: true, active: true },
      },
    },
  });

  const duplicateDeals = await tx.deal.count({
    where: { bettingHouseSlug: SLUG },
  });
  if (duplicateDeals !== 1) {
    throw new Error(
      `Esperado exatamente 1 deal para ${SLUG}; encontrado: ${duplicateDeals}`,
    );
  }

  return { house, deal, rule, association };
}

async function main() {
  let preview;
  try {
    await prisma.$transaction(async (tx) => {
      preview = await configure(tx);
      if (!APPLY) throw DRY_RUN_ROLLBACK;
    });
  } catch (error) {
    if (error !== DRY_RUN_ROLLBACK) throw error;
  }

  console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'} ${SLUG}`);
  console.log(json(preview));
  console.log(
    APPLY
      ? 'COMMIT OK: configuração inativa gravada.'
      : 'ROLLBACK OK: nenhuma alteração gravada; use --apply.',
  );
}

main()
  .catch((error) => {
    console.error(`FATAL: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

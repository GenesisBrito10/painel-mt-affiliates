/**
 * Cria/atualiza a casa "Betano Diário" + deal + regra de link. Idempotente.
 *   node --env-file=.env scripts/seed-betano-diario.mjs
 *
 * Regras: PADRÃO 60 (sem inviter) · CONVIDADO inviter−5 · depósito médio
 * p/ saque R$20 · saque mínimo R$100 · saque DIÁRIO (sem janela).
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const SLUG = 'betano-diario';

async function main() {
  // 1. BettingHouse — saque diário (todos os campos de janela null).
  const house = await prisma.bettingHouse.upsert({
    where: { slug: SLUG },
    update: {
      name: 'Betano Diário',
      active: true,
      withdrawalEnabled: true,
      syncMode: 'AUTO',
      minAvgDepositPerCpa: 20,
      minWithdrawalAmount: 100,
      minCpaToWithdraw: 0,
      withdrawalDay: null,
      withdrawalDayEnd: null,
      withdrawalDay2: null,
      withdrawalDay2End: null,
      withdrawalWeekday: null,
    },
    create: {
      slug: SLUG,
      name: 'Betano Diário',
      active: true,
      withdrawalEnabled: true,
      syncMode: 'AUTO',
      minAvgDepositPerCpa: 20,
      minWithdrawalAmount: 100,
      minCpaToWithdraw: 0,
    },
    select: {
      slug: true,
      name: true,
      minAvgDepositPerCpa: true,
      minWithdrawalAmount: true,
    },
  });
  console.log('HOUSE:', JSON.stringify(house));

  // 2. Deal.
  const existingDeal = await prisma.deal.findFirst({
    where: { bettingHouseSlug: SLUG, name: 'Betano Diário' },
    select: { id: true },
  });
  const dealData = {
    bettingHouseSlug: SLUG,
    name: 'Betano Diário',
    cpa: 60,
    revshare: 0,
    minAvgDepositPerFtd: 20,
    minQualifiedFtd: 10,
    paymentCpaLabel: 'R$ 60 por CPA qualificado',
    conditionsText: 'Depósito médio mínimo de R$ 20 para saque.',
    paymentNotes: 'Saque mínimo de R$ 100.',
    active: true,
  };
  const deal = existingDeal
    ? await prisma.deal.update({
        where: { id: existingDeal.id },
        data: dealData,
        select: { id: true, name: true, cpa: true },
      })
    : await prisma.deal.create({
        data: dealData,
        select: { id: true, name: true, cpa: true },
      });
  console.log('DEAL:', JSON.stringify(deal));

  // 3. HouseLinkRule — INVITER_DISCOUNT: sem inviter→60; com inviter→inviter−5.
  const rule = await prisma.houseLinkRule.upsert({
    where: { houseSlug: SLUG },
    update: {
      ruleType: 'INVITER_DISCOUNT',
      defaultCpa: 60,
      fallbackCpa: 60,
      inviterCpaDiscount: 5,
      defaultRevshare: 0,
      requestEnabled: true,
      autoAssignEnabled: true,
      applyFallbackNoInviterCpa: false,
      processOldRequests: true,
    },
    create: {
      houseSlug: SLUG,
      ruleType: 'INVITER_DISCOUNT',
      defaultCpa: 60,
      fallbackCpa: 60,
      inviterCpaDiscount: 5,
      defaultRevshare: 0,
      requestEnabled: true,
      autoAssignEnabled: true,
      applyFallbackNoInviterCpa: false,
      processOldRequests: true,
    },
    select: {
      houseSlug: true,
      ruleType: true,
      defaultCpa: true,
      inviterCpaDiscount: true,
    },
  });
  console.log('RULE:', JSON.stringify(rule));

  // 4. Janela móvel usada pelo requisito de 10 CPAs na Superbet.
  const eligibilityWindow = await prisma.setting.upsert({
    where: { key: 'deal_eligibility_window_days' },
    update: { value: '30', label: 'Janela de elegibilidade de deals (dias)' },
    create: {
      key: 'deal_eligibility_window_days',
      value: '30',
      label: 'Janela de elegibilidade de deals (dias)',
    },
    select: { key: true, value: true },
  });
  console.log('SETTING:', JSON.stringify(eligibilityWindow));

  console.log('\nOK — Betano Diário criado/atualizado.');
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error('FATAL', String(e).slice(0, 400));
  process.exit(1);
});

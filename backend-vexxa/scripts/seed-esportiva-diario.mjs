/**
 * Cria/atualiza a casa "Esportiva Diário" + deal + regra. Idempotente.
 *   node --env-file=.env scripts/seed-esportiva-diario.mjs
 *
 * CPA é MANUAL: admin/convidante seta via PUT /v1/link-requests/:id/set-cpa.
 * Por isso a regra fica com autoAssignEnabled=false (createRequest NÃO resolve
 * CPA nem auto-atribui; o request fica PENDING sem resolvedCpa até ser setado).
 * Saque DIÁRIO (janela null). Pool = mesma conta esportiva (aba DIARIO).
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const SLUG = 'esportiva-diario';

async function main() {
  // Espelha minAvgDepositPerCpa da esportiva (se existir), senão default 70.
  const base = await prisma.bettingHouse.findUnique({
    where: { slug: 'esportivabet' },
    select: { minAvgDepositPerCpa: true },
  });
  const minAvgDep = base ? base.minAvgDepositPerCpa : 70;

  const house = await prisma.bettingHouse.upsert({
    where: { slug: SLUG },
    update: {
      name: 'Esportiva Diário',
      active: true,
      withdrawalEnabled: true,
      minAvgDepositPerCpa: minAvgDep,
      minCpaToWithdraw: 0,
      withdrawalDay: null,
      withdrawalDayEnd: null,
      withdrawalDay2: null,
      withdrawalDay2End: null,
      withdrawalWeekday: null,
    },
    create: {
      slug: SLUG,
      name: 'Esportiva Diário',
      active: true,
      withdrawalEnabled: true,
      minAvgDepositPerCpa: minAvgDep,
      minCpaToWithdraw: 0,
    },
    select: { slug: true, name: true, minAvgDepositPerCpa: true },
  });
  console.log('HOUSE:', JSON.stringify(house));

  // 1 deal por casa — busca por slug (não por nome, que o admin pode renomear).
  const existingDeal = await prisma.deal.findFirst({
    where: { bettingHouseSlug: SLUG },
    select: { id: true },
  });
  const dealCommon = {
    cpa: 0, // CPA definido manualmente por solicitação
    revshare: 0,
    conditionsText: 'CPA definido manualmente pelo admin/convidante.',
    active: true,
  };
  const deal = existingDeal
    ? await prisma.deal.update({ where: { id: existingDeal.id }, data: dealCommon, select: { id: true, name: true } })
    : await prisma.deal.create({ data: { bettingHouseSlug: SLUG, name: 'Esportivabet Diário', ...dealCommon }, select: { id: true, name: true } });
  console.log('DEAL:', JSON.stringify(deal));

  // Regra: autoAssignEnabled=false (não auto-atribui na criação). CPA é manual.
  // inviterCpaThreshold obrigatório p/ INVITER_DISCOUNT (validação) — 0 ok pois
  // o CPA não é resolvido por regra aqui.
  const rule = await prisma.houseLinkRule.upsert({
    where: { houseSlug: SLUG },
    update: {
      ruleType: 'INVITER_DISCOUNT',
      defaultCpa: 60,
      fallbackCpa: 0,
      inviterCpaThreshold: 0,
      inviterCpaDiscount: 0,
      defaultRevshare: 0,
      requestEnabled: true,
      autoAssignEnabled: false,
    },
    create: {
      houseSlug: SLUG,
      ruleType: 'INVITER_DISCOUNT',
      defaultCpa: 60,
      fallbackCpa: 0,
      inviterCpaThreshold: 0,
      inviterCpaDiscount: 0,
      defaultRevshare: 0,
      requestEnabled: true,
      autoAssignEnabled: false,
    },
    select: { houseSlug: true, requestEnabled: true, autoAssignEnabled: true },
  });
  console.log('RULE:', JSON.stringify(rule));

  console.log('\nOK — Esportiva Diário criado/atualizado (CPA manual).');
  await prisma.$disconnect();
}
main().catch((e) => { console.error('FATAL', String(e).slice(0, 400)); process.exit(1); });

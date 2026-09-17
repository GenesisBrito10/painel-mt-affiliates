// VALLEX: cadastra fraude (casa superbet) por campaignId, CAPADA para o saldo não
// ficar negativo, e DELETA os saques PENDENTES (superbet) dos usuários marcados.
// Como os saques pendentes serão apagados (liberam saldo), o cap considera o saldo
// COM esses pendentes devolvidos (addback). Usa o DashboardBalanceService real.
// DRY-RUN por padrão; grava (delete saques + upsert fraud_counts) só com --apply.
require('reflect-metadata');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const {
  DashboardBalanceService,
} = require('../dist/src/modules/dashboard/application/dashboard-balance.service.js');
const {
  DashboardPrismaRepository,
} = require('../dist/src/modules/dashboard/infrastructure/persistence/dashboard.prisma-repository.js');

const APPLY = process.argv.includes('--apply');
const HOUSE = 'superbet';

const DESIRED = {
  '5602-VALLEXBR982': 27, '32666-VALLEXBR53': 19, '5602-VALLEXBR27': 17,
  '32666-VALLEXBR224': 15, '5602-VALLEXBR299': 13, '5602-VALLEXBR875': 13,
  '5602-VALLEXBR757': 11, '5602-VALLEXBR142': 10, '5602-VALLEXBR586': 9,
  '5602-VALLEXBR351': 7, '32666-VALLEXBR55': 7, '5602-VALLEXBR209': 5,
  '5602-VALLEXBR910': 4, '32666-VALLEXBR37': 4, '5602-VALLEXBR558': 4,
  '32666-VALLEXBR62': 3, '5602-VALLEXBR20': 3, '5602-VALLEXBR159': 2,
  '5602-VALLEXBR170': 2, '5602-VALLEXBR878': 2, '5602-VALLEXBR698': 2,
  '32666-VALLEXBR13': 2, '32666-VALLEXBR533': 1, '5602-VALLEXBR291': 1,
  '5602-VALLEXBR368': 1, '5602-VALLEXBR510': 1, '5602-VALLEXBR806': 1,
  '32666-VALLEXBR122': 1, '32666-VALLEXBR388': 1, '5602-VALLEXBR29': 1,
  '5602-VALLEXBR650': 1, '32666-VALLEXBR65': 1, '5602-VALLEXBR789': 1,
  '32666-VALLEXBR112': 1, '32666-VALLEXBR31': 1,
};

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  const repo = new DashboardPrismaRepository(prisma);
  const settingsStub = {
    getMany: async () => {
      const rows = await prisma.setting.findMany();
      return new Map(rows.map((r) => [r.key, r.value]));
    },
  };
  const service = new DashboardBalanceService(repo, {}, settingsStub, prisma);

  const ids = Object.keys(DESIRED);
  const totalDesired = Object.values(DESIRED).reduce((a, b) => a + b, 0);

  // Mapeia campaignId -> link (superbet, ativo). Agrega vallexAdd por user.
  const links = await prisma.affiliateLink.findMany({
    where: { campaignId: { in: ids }, deletedAt: null },
    select: { campaignId: true, userId: true, bettingHouse: true, cpa: true, user: { select: { email: true } } },
  });
  const linkByCampaign = new Map();
  for (const l of links) if (!linkByCampaign.has(l.campaignId)) linkByCampaign.set(l.campaignId, l);

  const notFound = [];
  const byUser = new Map(); // userId -> {userId, house, email, cpa, vallexAdd, campaigns[]}
  for (const id of ids) {
    const l = linkByCampaign.get(id);
    if (!l) { notFound.push(id); continue; }
    const cur = byUser.get(l.userId) ?? { userId: l.userId, house: l.bettingHouse, email: l.user.email, cpa: Number(l.cpa) || 0, vallexAdd: 0, campaigns: [] };
    cur.vallexAdd += DESIRED[id];
    cur.campaigns.push(id);
    byUser.set(l.userId, cur);
  }
  if (notFound.length) { console.log('ABORTA — campanhas não encontradas:', notFound.join(', ')); await prisma.$disconnect(); process.exit(1); }

  const markedUserIds = [...byUser.keys()];

  // Saques PENDENTES dos marcados (superbet = a deletar; outras casas = só reporta).
  const pend = await prisma.withdrawalRequest.findMany({
    where: { userId: { in: markedUserIds }, status: 'PENDING' },
    select: { id: true, userId: true, bettingHouse: true, originalAmount: true, user: { select: { email: true } } },
  });
  const pendToDelete = pend.filter((w) => w.bettingHouse === HOUSE);
  const pendOtherHouse = pend.filter((w) => w.bettingHouse !== HOUSE);

  // Cap por usuário (com addback do pendente superbet que será deletado).
  const out = [];
  for (const u of byUser.values()) {
    const existingRow = await prisma.fraudCount.findUnique({
      where: { userId_bettingHouse: { userId: u.userId, bettingHouse: HOUSE } },
      select: { count: true },
    });
    const existing = existingRow?.count ?? 0;
    const bal = await service.getBalance({ sub: u.userId, role: 'AFFILIATE', email: u.email }, { bettingHouse: HOUSE });
    const entry = (bal.perHouse || []).find((h) => h.house === HOUSE);
    const total = entry ? Number(entry.total) : 0;
    const directFraud = entry ? Number(entry.fraudDeduction) : 0;
    const pendingHouse = Number(bal.withdrawalsPending) || 0; // será devolvido ao deletar
    const base0 = total + directFraud + pendingHouse; // saldo pré-fraude, pós-delete-saque
    const cpa = u.cpa;
    const maxCount = cpa > 0 && base0 > 0 ? Math.floor(base0 / cpa) : 0;
    const desiredTotal = existing + u.vallexAdd;
    const newCount = Math.min(desiredTotal, maxCount);
    const appliedVallex = Math.max(0, newCount - existing);
    const leftover = u.vallexAdd - appliedVallex;
    const finalBalance = base0 - cpa * newCount;
    out.push({ ...u, existing, cpa, base0, maxCount, newCount, appliedVallex, leftover, finalBalance });
  }

  console.log(`VALLEX | campanhas: ${ids.length} | soma desejada: ${totalDesired} | usuários: ${byUser.size} | casa: ${HOUSE}\n`);
  console.log('email                                     cpa  jaTinha  vallex  aplicado  sobra  saldoFinal');
  let totLeftover = 0, capped = 0;
  for (const o of out.sort((a, b) => b.leftover - a.leftover)) {
    totLeftover += o.leftover;
    if (o.leftover > 0) capped++;
    console.log(
      `${o.email.padEnd(41)} ${String(o.cpa).padStart(4)} ${String(o.existing).padStart(7)} ${String(o.vallexAdd).padStart(6)} ${String(o.appliedVallex).padStart(8)} ${String(o.leftover).padStart(6)} ${o.finalBalance.toFixed(2).padStart(11)}`,
    );
  }

  const delAmount = pendToDelete.reduce((s, w) => s + Number(w.originalAmount), 0);
  console.log(`\nSAQUES PENDENTES superbet a DELETAR: ${pendToDelete.length} (R$${delAmount.toFixed(2)})`);
  if (pendOtherHouse.length) {
    console.log(`Saques pendentes em OUTRA casa (NÃO deletados — reportando):`);
    for (const w of pendOtherHouse) console.log(`  ${w.user.email}  casa=${w.bettingHouse}  R$${w.originalAmount}  id=${w.id}`);
  }
  console.log(`\nTotal usuários: ${out.length} | capados (sobra>0): ${capped} | CPAs VALLEX sobrando: ${totLeftover}`);

  if (APPLY) {
    const del = await prisma.withdrawalRequest.deleteMany({
      where: { userId: { in: markedUserIds }, status: 'PENDING', bettingHouse: HOUSE },
    });
    let upserts = 0;
    for (const o of out) {
      await prisma.fraudCount.upsert({
        where: { userId_bettingHouse: { userId: o.userId, bettingHouse: HOUSE } },
        update: { count: o.newCount },
        create: { userId: o.userId, bettingHouse: HOUSE, count: o.newCount },
      });
      upserts++;
    }
    console.log(`\nOK — saques deletados: ${del.count} | fraud_counts gravados: ${upserts}.`);
  } else {
    console.log('\nDRY-RUN — rode com --apply para deletar saques e gravar fraude.');
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });

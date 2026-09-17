// Capa a fraude (casa superbet) para que o SALDO do usuário não fique negativo:
// aplica no máximo a quantidade de fraude-CPAs que zera o saldo (floor), e reporta
// quantos CPAs de fraude "sobram" (não puderam ser aplicados sem negativar).
// Usa o DashboardBalanceService REAL (compilado em dist) — não recalcula à mão.
// DRY-RUN por padrão; grava (reduz fraud_counts) só com --apply.
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

  // Usuários com fraude superbet > 0 + o CPA superbet (link ativo mais recente).
  const rows = await prisma.$queryRaw`
    SELECT fc."userId", u.email, fc.count AS current,
           (SELECT al.cpa FROM affiliate_links al
              WHERE al."userId" = fc."userId" AND al."bettingHouse" = ${HOUSE}
                AND al."deletedAt" IS NULL
              ORDER BY al."createdAt" DESC LIMIT 1) AS cpa
      FROM fraud_counts fc JOIN users u ON u.id = fc."userId"
     WHERE fc."bettingHouse" = ${HOUSE} AND fc.count > 0
     ORDER BY fc.count DESC`;

  const out = [];
  for (const r of rows) {
    const cpa = Number(r.cpa) || 0;
    const current = Number(r.current);
    const bal = await service.getBalance(
      { sub: r.userId, role: 'AFFILIATE', email: r.email },
      { bettingHouse: HOUSE },
    );
    const entry = (bal.perHouse || []).find((h) => h.house === HOUSE);
    const total = entry ? Number(entry.total) : 0; // saldo casa (já c/ fraude+saques)
    const directFraud = entry ? Number(entry.fraudDeduction) : 0;
    const base = total + directFraud; // saldo ANTES da fraude direta
    const maxCount = cpa > 0 && base > 0 ? Math.floor(base / cpa) : 0;
    const newCount = Math.min(current, maxCount);
    const leftover = current - newCount;
    const resultBalance = base - cpa * newCount;
    out.push({ ...r, cpa, current, base, maxCount, newCount, leftover, resultBalance, negBase: base < 0 });
  }

  console.log('email                                         cpa  fraudeAtual  saldoPreFraude  novaFraude  sobra  saldoFinal');
  let totLeftover = 0, capped = 0, negUsers = 0;
  for (const o of out.sort((a, b) => b.leftover - a.leftover)) {
    totLeftover += o.leftover;
    if (o.leftover > 0) capped++;
    if (o.negBase) negUsers++;
    console.log(
      `${o.email.padEnd(45)} ${String(o.cpa).padStart(4)} ${String(o.current).padStart(11)} ${o.base.toFixed(2).padStart(15)} ${String(o.newCount).padStart(11)} ${String(o.leftover).padStart(6)} ${o.resultBalance.toFixed(2).padStart(11)}${o.negBase ? '  <-- ja negativo antes da fraude' : ''}`,
    );
  }
  console.log(`\nTotal usuarios: ${out.length} | capados (sobra>0): ${capped} | CPAs sobrando: ${totLeftover} | ja negativos pre-fraude: ${negUsers}`);

  if (APPLY) {
    let updated = 0;
    for (const o of out) {
      if (o.newCount !== o.current) {
        await prisma.fraudCount.update({
          where: { userId_bettingHouse: { userId: o.userId, bettingHouse: HOUSE } },
          data: { count: o.newCount },
        });
        updated++;
      }
    }
    console.log(`\nOK — ${updated} fraud_counts ajustados.`);
  } else {
    console.log('\nDRY-RUN — rode com --apply para gravar o ajuste.');
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Força saque PENDENTE de betano-diario para TODOS os usuários com saldo sacável.
// Cada saque = saldo betano-diario do PRÓPRIO usuário, pro PIX dele (paga o
// afiliado; não fabrica nada). Pula: isExternal, sem PIX, saldo < mínimo, ou já
// com pendente betano-diario. DRY-RUN por padrão; grava só com --apply.
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
const NO_MIN = process.argv.includes('--no-min'); // ignora o mínimo de saque
const HOUSE = 'betano-diario';

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  const repo = new DashboardPrismaRepository(prisma);
  const settingsStub = {
    getMany: async () => new Map((await prisma.setting.findMany()).map((r) => [r.key, r.value])),
  };
  const service = new DashboardBalanceService(repo, {}, settingsStub, prisma);

  // Todos os usuários internos com link ativo betano-diario.
  const users = await prisma.user.findMany({
    where: {
      isExternal: false,
      deletedAt: null,
      affiliateLinks: { some: { bettingHouse: HOUSE, deletedAt: null } },
    },
    select: {
      id: true, email: true, role: true, pixKeyType: true, pixKey: true,
      bankName: true, bankAgency: true, bankAccount: true, accountHolder: true,
    },
  });
  console.log(`Candidatos (internos c/ link ${HOUSE}): ${users.length}\n`);

  let created = 0, totalOriginal = 0;
  const skipped = { nopix: 0, belowmin: 0, haspending: 0, zerobal: 0 };

  for (const u of users) {
    if (!u.pixKey || !u.pixKeyType) { skipped.nopix++; continue; }

    const bal = await service.getBalance({ sub: u.id, role: u.role, email: u.email }, { bettingHouse: HOUSE });
    const entry = (bal.perHouse || []).find((h) => h.house === HOUSE);
    const available = Math.max(0, entry ? Number(entry.total) : 0);
    const min = Number(bal.minWithdrawalAmount || 100);
    const feeRate = Number(bal.withdrawalFeeRate) || 0.06;

    if (available <= 0) { skipped.zerobal++; continue; }
    if (!NO_MIN && available < min) { skipped.belowmin++; continue; }

    const existing = await prisma.withdrawalRequest.count({
      where: { userId: u.id, status: 'PENDING', bettingHouse: HOUSE },
    });
    if (existing > 0) { skipped.haspending++; continue; }

    const originalAmount = parseFloat(available.toFixed(2));
    const withdrawalFee = parseFloat((originalAmount * feeRate).toFixed(2));
    const amount = parseFloat((originalAmount - withdrawalFee).toFixed(2));
    totalOriginal += originalAmount;
    created++;
    console.log(`${String(created).padStart(3)}  R$${String(originalAmount).padStart(9)}  liq R$${String(amount).padStart(9)}  ${u.email}`);

    if (APPLY) {
      await prisma.withdrawalRequest.create({
        data: {
          userId: u.id, amount, originalAmount, withdrawalFee,
          bettingHouse: HOUSE, requestNote: 'Saque forçado (admin)',
          pixKeyType: u.pixKeyType, pixKey: u.pixKey,
          bankName: u.bankName ?? '', bankAgency: u.bankAgency ?? '',
          bankAccount: u.bankAccount ?? '', accountHolder: u.accountHolder ?? '',
          status: 'PENDING',
        },
      });
    }
  }

  console.log(`\n${APPLY ? 'CRIADOS' : 'A CRIAR'}: ${created} saques | total original R$${totalOriginal.toFixed(2)}`);
  console.log(`Pulados -> sem PIX: ${skipped.nopix} | saldo 0: ${skipped.zerobal} | < mínimo: ${skipped.belowmin} | já pendente: ${skipped.haspending}`);
  if (!APPLY) console.log('\nDRY-RUN — rode com --apply para criar os saques pendentes.');

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });

// READ-ONLY: para os 2 emails, mostra userId/role/isExternal, dados PIX,
// saldo SPORTINGBET disponível (via DashboardBalanceService real) e saques
// PENDENTES existentes. NÃO grava nada.
require('reflect-metadata');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const {
  DashboardBalanceService,
} = require('../dist/src/modules/dashboard/application/dashboard-balance.service.js');
const {
  DashboardPrismaRepository,
} = require('../dist/src/modules/dashboard/infrastructure/persistence/dashboard.prisma-repository.js');

const HOUSE = 'sportingbet';
const EMAILS = ['suporteredesmolke@gmail.com', 'network@gmail.com'];

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  const repo = new DashboardPrismaRepository(prisma);
  const settingsStub = {
    getMany: async () => new Map((await prisma.setting.findMany()).map((r) => [r.key, r.value])),
  };
  const service = new DashboardBalanceService(repo, {}, settingsStub, prisma);

  for (const email of EMAILS) {
    const u = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true, name: true, email: true, role: true, status: true, active: true,
        isExternal: true, pixKeyType: true, pixKey: true, accountHolder: true,
      },
    });
    console.log(`\n=== ${email} ===`);
    if (!u) { console.log('  NÃO ENCONTRADO'); continue; }
    console.log(`  id=${u.id} role=${u.role} status=${u.status} active=${u.active} isExternal=${u.isExternal}`);
    console.log(`  pix: type=${u.pixKeyType || '(vazio)'} key=${u.pixKey || '(vazio)'} holder=${u.accountHolder || '(vazio)'}`);

    const bal = await service.getBalance({ sub: u.id, role: u.role, email: u.email }, { bettingHouse: HOUSE });
    const entry = (bal.perHouse || []).find((h) => h.house === HOUSE);
    console.log(`  saldo ${HOUSE}: total(casa)=${entry ? Number(entry.total).toFixed(2) : '0.00'} | withdrawableTotal=${Number(bal.withdrawableTotal).toFixed(2)} | netBalance=${Number(bal.netBalance).toFixed(2)}`);
    console.log(`  minWithdrawal=${bal.minWithdrawalAmount} | feeRate=${bal.withdrawalFeeRate}`);

    const pend = await prisma.withdrawalRequest.findMany({
      where: { userId: u.id, status: 'PENDING' },
      select: { id: true, bettingHouse: true, originalAmount: true },
    });
    console.log(`  saques PENDENTES: ${pend.length}` + (pend.length ? ' -> ' + pend.map((w) => `${w.bettingHouse} R$${w.originalAmount}`).join(', ') : ''));
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });

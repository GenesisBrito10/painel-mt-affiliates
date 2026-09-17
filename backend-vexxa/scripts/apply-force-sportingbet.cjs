// Força um saque SPORTINGBET PENDENTE para os 2 usuários: cria withdrawal_request
// status=PENDING com originalAmount = saldo sportingbet sacável (recalculado via
// serviço real p/ NÃO exceder saldo), taxa 6%, líquido = original-taxa, com o
// PIX/banco do próprio usuário. DRY-RUN por padrão; grava só com --apply.
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
const NO_MIN = process.argv.includes('--no-min');
const HOUSE = 'sportingbet';
// Emails vêm por argumento (qualquer arg com "@"); fallback = lista padrão.
const argEmails = process.argv.slice(2).filter((a) => a.includes('@'));
const EMAILS = argEmails.length ? argEmails : ['suporteredesmolke@gmail.com', 'network@gmail.com'];

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
        id: true, email: true, role: true, isExternal: true,
        pixKeyType: true, pixKey: true, bankName: true, bankAgency: true,
        bankAccount: true, accountHolder: true,
      },
    });
    console.log(`\n=== ${email} ===`);
    if (!u) { console.log('  NÃO ENCONTRADO — pulo'); continue; }
    if (u.isExternal) { console.log('  isExternal — pulo (saque API não é do painel interno)'); continue; }
    if (!u.pixKey || !u.pixKeyType) { console.log('  SEM PIX cadastrado — pulo'); continue; }

    const bal = await service.getBalance({ sub: u.id, role: u.role, email: u.email }, { bettingHouse: HOUSE });
    const entry = (bal.perHouse || []).find((h) => h.house === HOUSE);
    const available = Math.max(0, entry ? Number(entry.total) : 0); // saldo sacável da casa
    const feeRate = Number(bal.withdrawalFeeRate) || 0.06;

    if (!NO_MIN && available < Number(bal.minWithdrawalAmount || 100)) {
      console.log(`  saldo ${HOUSE} R$${available.toFixed(2)} < mínimo R$${bal.minWithdrawalAmount} — pulo`);
      continue;
    }
    if (available <= 0) { console.log(`  saldo ${HOUSE} zero — pulo`); continue; }

    const existing = await prisma.withdrawalRequest.count({
      where: { userId: u.id, status: 'PENDING', bettingHouse: HOUSE },
    });
    if (existing > 0) { console.log(`  já tem ${existing} saque PENDENTE ${HOUSE} — pulo`); continue; }

    const originalAmount = parseFloat(available.toFixed(2));
    const withdrawalFee = parseFloat((originalAmount * feeRate).toFixed(2));
    const amount = parseFloat((originalAmount - withdrawalFee).toFixed(2));
    console.log(`  original=R$${originalAmount} taxa=R$${withdrawalFee} liquido=R$${amount} pix=${u.pixKeyType}:${u.pixKey}`);

    if (APPLY) {
      const wd = await prisma.withdrawalRequest.create({
        data: {
          userId: u.id, amount, originalAmount, withdrawalFee,
          bettingHouse: HOUSE, requestNote: 'Saque forçado (admin)',
          pixKeyType: u.pixKeyType, pixKey: u.pixKey,
          bankName: u.bankName ?? '', bankAgency: u.bankAgency ?? '',
          bankAccount: u.bankAccount ?? '', accountHolder: u.accountHolder ?? '',
          status: 'PENDING',
        },
        select: { id: true },
      });
      console.log(`  OK — saque PENDENTE criado id=${wd.id}`);
    }
  }

  if (!APPLY) console.log('\nDRY-RUN — rode com --apply para criar os saques pendentes.');

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });

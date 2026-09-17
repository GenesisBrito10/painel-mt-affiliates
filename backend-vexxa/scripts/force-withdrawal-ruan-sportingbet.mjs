import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Forca saque PENDING sportingbet do saldo TOTAL de ruanoliveiraro341. Sem downline
// (network=0). Espelha a formula do getBalance (own+adj-fraude-saques, pos-cutover).
// DRY-RUN por padrao; APPLY=1 cria o saque.
const EMAIL = 'ruanoliveiraro341@gmail.com';
const HOUSE = 'sportingbet';
const CUTOVER = new Date('2026-05-22T00:00:00.000Z');
const FEE_RATE = 0.06;
const ACTIVE = ['PENDING', 'APPROVED', 'PROCESSING', 'COMPLETED'];
const APPLY = process.env.APPLY === '1';

const u = await prisma.user.findFirst({
  where: { email: { equals: EMAIL, mode: 'insensitive' } },
  select: {
    id: true, name: true, referredById: true,
    pixKeyType: true, pixKey: true, accountHolder: true, bankName: true, bankAgency: true, bankAccount: true,
    affiliateLinks: { where: { deletedAt: null, bettingHouse: HOUSE }, select: { campaignId: true, cpa: true, revshare: true } },
    fraudCounts: { where: { bettingHouse: HOUSE }, select: { count: true } },
    balanceAdjustments: { where: { bettingHouse: HOUSE }, select: { amount: true } },
  },
});
if (!u) { console.log('USER NAO ENCONTRADO'); await prisma.$disconnect(); process.exit(1); }

const kids = await prisma.user.count({ where: { referredById: u.id } });

// OWN sportingbet: sum(cpaQ)xcpa + (revshare/100)xsum(revShare), campanhas do link, date>=cutover
let own = 0;
for (const l of u.affiliateLinks) {
  const agg = await prisma.affiliateData.aggregate({ where: { campaignId: l.campaignId, bettingHouse: HOUSE, date: { gte: CUTOVER } }, _sum: { cpaQualified: true, revShare: true } });
  const q = agg._sum.cpaQualified ?? 0; const rev = Number(agg._sum.revShare ?? 0);
  own += Number(l.cpa ?? 0) * q + (Number(l.revshare ?? 0) / 100) * rev;
}
// FRAUD
const cpaRate = Number(u.affiliateLinks[0]?.cpa ?? 0);
const fraud = u.fraudCounts.reduce((a, f) => a + f.count, 0) * cpaRate;
// ADJUSTMENT
const adj = u.balanceAdjustments.reduce((a, x) => a + Number(x.amount), 0);
// WITHDRAWALS sportingbet ativos pos-cutover
const wds = await prisma.withdrawalRequest.findMany({ where: { userId: u.id, bettingHouse: HOUSE, status: { in: ACTIVE }, createdAt: { gte: CUTOVER } }, select: { originalAmount: true, gatewayRefundedAmount: true, status: true, createdAt: true } });
const withdrawn = wds.reduce((a, w) => a + Math.max(0, Number(w.originalAmount) - Number(w.gatewayRefundedAmount ?? 0)), 0);

const total = own + adj - fraud - withdrawn;
const available = Math.max(0, parseFloat(total.toFixed(2)));

console.log(`USER ${u.name} | downline=${kids} (network=${kids ? 'CHECAR' : '0'})`);
console.log(`own=R$${own.toFixed(2)} | adj=R$${adj.toFixed(2)} | fraude=R$${fraud.toFixed(2)} | saques=R$${withdrawn.toFixed(2)} (${wds.length})`);
console.log(`SALDO DISPONIVEL sportingbet = R$${available.toFixed(2)}`);
console.log(`pix: ${u.pixKeyType} ${u.pixKey} | holder=${u.accountHolder}`);

if (kids > 0) { console.log('\nABORT: user tem downline — network spread nao calculado neste script. Revisar.'); await prisma.$disconnect(); process.exit(1); }
if (available <= 0) { console.log('\nABORT: saldo <= 0.'); await prisma.$disconnect(); process.exit(1); }

const fee = parseFloat((available * FEE_RATE).toFixed(2));
const net = parseFloat((available - fee).toFixed(2));
console.log(`\nSAQUE a criar: bruto=R$${available.toFixed(2)} | taxa(6%)=R$${fee.toFixed(2)} | liquido=R$${net.toFixed(2)} | status=PENDING`);

if (!APPLY) { console.log('\nDRY-RUN (APPLY!=1). Nada criado.'); await prisma.$disconnect(); process.exit(0); }

const w = await prisma.withdrawalRequest.create({
  data: {
    userId: u.id, bettingHouse: HOUSE, status: 'PENDING',
    originalAmount: available, withdrawalFee: fee, amount: net,
    pixKeyType: u.pixKeyType, pixKey: u.pixKey, accountHolder: u.accountHolder,
    bankName: u.bankName, bankAgency: u.bankAgency, bankAccount: u.bankAccount,
    requestNote: 'Saque forcado manual (admin) - saldo total sportingbet',
  },
  select: { id: true, originalAmount: true, amount: true, status: true },
});
console.log(`\nCRIADO saque ${w.id} | bruto=R$${Number(w.originalAmount).toFixed(2)} | liquido=R$${Number(w.amount).toFixed(2)} | ${w.status}`);
await prisma.$disconnect();

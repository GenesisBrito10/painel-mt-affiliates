import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// READ-ONLY. Investiga FinancialLedger e Deal como fontes de cpa. Inventário final.
const total = await prisma.financialLedger.count();
console.log(`=== FinancialLedger: ${total} eventos ===`);
if (total > 0) {
  const byType = await prisma.financialLedger.groupBy({ by: ['eventType'], _count: { _all: true } });
  console.log('por eventType:', byType.map(r=>`${r.eventType}=${r._count._all}`).join(' '));
  const first = await prisma.financialLedger.findFirst({ orderBy: { eventDate: 'asc' }, select: { eventDate: true } });
  const last = await prisma.financialLedger.findFirst({ orderBy: { eventDate: 'desc' }, select: { eventDate: true } });
  console.log(`eventDate range: ${first?.eventDate.toISOString().slice(0,10)} → ${last?.eventDate.toISOString().slice(0,10)}`);
  const sample = await prisma.financialLedger.findMany({ where: { eventType: { in: ['COMMISSION_CPA','NETWORK_CPA'] } }, take: 6, orderBy: { createdAt: 'asc' }, select: { eventType: true, amount: true, bettingHouse: true, eventDate: true, sourceUserId: true, description: true } });
  console.log('amostra COMMISSION_CPA/NETWORK_CPA:');
  for (const s of sample) console.log(`  ${s.eventDate.toISOString().slice(0,10)} ${s.eventType} R$${s.amount} ${s.bettingHouse ?? '-'} src=${s.sourceUserId?'sim':'-'} "${(s.description??'').slice(0,40)}"`);
} else console.log('VAZIO — não usado.');

console.log(`\n=== Deal (catálogo de ofertas) ===`);
const deals = await prisma.deal.findMany({ select: { bettingHouseSlug: true, name: true, cpa: true, revshare: true } });
console.log(`total deals: ${deals.length}`);
for (const d of deals.filter(x=>x.bettingHouseSlug==='superbet')) console.log(`  superbet "${d.name}" cpa=${d.cpa} rev=${d.revshare}`);
const otherHouses = [...new Set(deals.map(d=>d.bettingHouseSlug))];
console.log('casas com deal:', otherHouses.join(' '));

await prisma.$disconnect();

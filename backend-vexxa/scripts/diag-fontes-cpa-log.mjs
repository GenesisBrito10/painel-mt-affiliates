import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// READ-ONLY. Todas as FONTES de cpa no log: ações de AuditLog c/ cpa, LinkRequest, AffiliateLink datas.
const auds = await prisma.auditLog.findMany({ select: { action: true, details: true } });
const actionStats = new Map();
for (const a of auds) { const e = actionStats.get(a.action) ?? { total: 0, comCpa: 0 }; e.total++; if (a.details?.cpa != null) e.comCpa++; actionStats.set(a.action, e); }
console.log('=== AÇÕES de AuditLog (total | com details.cpa) ===');
for (const [act, e] of [...actionStats.entries()].sort((a,b)=>b[1].total-a[1].total)) console.log(`  ${act}: ${e.total} (cpa em ${e.comCpa})`);

const lrCount = await prisma.linkRequest.count();
console.log(`\n=== LinkRequest: ${lrCount} ===`);
const lrSample = await prisma.linkRequest.findMany({ where: { bettingHouseSlug: 'superbet' }, orderBy: { createdAt: 'asc' }, take: 12, select: { message: true, status: true, createdAt: true, fulfilledByName: true } });
for (const l of lrSample) console.log(`  ${l.createdAt.toISOString().slice(0,16)} ${l.status} by=${l.fulfilledByName||'-'} | "${(l.message ?? '').slice(0,70)}"`);
const lrCpa = await prisma.linkRequest.count({ where: { bettingHouseSlug: 'superbet', message: { contains: 'CPA' } } });
console.log(`LinkRequest superbet com "CPA" na message: ${lrCpa}`);

const sampleLinks = await prisma.affiliateLink.findMany({ where: { bettingHouse: 'superbet' }, take: 6, select: { cpa: true, createdAt: true, updatedAt: true, providerAccountId: true } });
console.log('\n=== AffiliateLink superbet (amostra: createdAt/updatedAt) ===');
for (const l of sampleLinks) console.log(`  cpa=${l.cpa} criado=${l.createdAt?.toISOString().slice(0,16)} atualizado=${l.updatedAt?.toISOString().slice(0,16)} provider=${l.providerAccountId ? 'sim' : 'não'}`);

await prisma.$disconnect();

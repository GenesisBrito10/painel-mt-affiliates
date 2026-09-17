import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// READ-ONLY. Datas do AuditLog UPDATE_STATUS + inventário do CommissionLog (logs de cpa).
const day = (d) => d.toISOString().slice(0, 10);

const auds = await prisma.auditLog.findMany({ where: { action: 'UPDATE_STATUS' }, select: { createdAt: true, details: true }, orderBy: { createdAt: 'asc' } });
const sbAuds = auds.filter(a => a.details?.bettingHouse === 'superbet' && a.details?.cpa != null && a.details?.targetUserId);
console.log('=== AuditLog UPDATE_STATUS (superbet, c/ cpa) ===');
console.log(`total: ${sbAuds.length}`);
if (sbAuds.length) { console.log(`primeiro: ${sbAuds[0].createdAt.toISOString()}`); console.log(`último:   ${sbAuds[sbAuds.length-1].createdAt.toISOString()}`); }
const byDayA = new Map(); for (const a of sbAuds) byDayA.set(day(a.createdAt), (byDayA.get(day(a.createdAt)) ?? 0) + 1);
console.log('por dia:', [...byDayA.entries()].sort().map(([d,n])=>`${d}:${n}`).join(' '));

const clCount = await prisma.commissionLog.count();
console.log(`\n=== CommissionLog (mudanças de cpa/revshare) ===`);
console.log(`total: ${clCount}`);
if (clCount > 0) {
  const first = await prisma.commissionLog.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
  const last = await prisma.commissionLog.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
  console.log(`primeiro: ${first.createdAt.toISOString()}`);
  console.log(`último:   ${last.createdAt.toISOString()}`);
  const byField = await prisma.commissionLog.groupBy({ by: ['field'], _count: { _all: true } });
  console.log('por field:', byField.map(r => `${r.field}=${r._count._all}`).join(' '));
  const byChanger = await prisma.commissionLog.groupBy({ by: ['changedById'], _count: { _all: true } });
  console.log('por changedById:', byChanger.map(r => `${r.changedById ?? 'null(script)'}=${r._count._all}`).join(' '));
  const rows = await prisma.commissionLog.findMany({ select: { createdAt: true } });
  const byDayC = new Map(); for (const r of rows) byDayC.set(day(r.createdAt), (byDayC.get(day(r.createdAt)) ?? 0) + 1);
  console.log('por dia:', [...byDayC.entries()].sort().map(([d,n])=>`${d}:${n}`).join(' '));
  const sample = await prisma.commissionLog.findMany({ where: { field: 'cpa', bettingHouse: 'superbet' }, orderBy: { createdAt: 'asc' }, take: 8, select: { userEmail: true, oldValue: true, newValue: true, createdAt: true, changedById: true } });
  console.log('\namostra cpa superbet (mais antigos):');
  for (const s of sample) console.log(`  ${s.createdAt.toISOString().slice(0,16)} ${s.userEmail}: ${s.oldValue ?? 'null'}→${s.newValue ?? 'null'} (by ${s.changedById ?? 'script'})`);
}
await prisma.$disconnect();

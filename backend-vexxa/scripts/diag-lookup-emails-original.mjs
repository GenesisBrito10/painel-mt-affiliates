import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// READ-ONLY. cpa original (audit + linkreq) + atual, busca fuzzy por termo.
const TERMS = ['dragon', 'affiliatescode01', 'nexusaffil', 'leoaguiar', 'leo.dragon'];
const all = await prisma.user.findMany({
  select: { id: true, name: true, email: true, referredById: true,
    affiliateLinks: { where: { bettingHouse: 'superbet' }, select: { cpa: true } } },
});
const liveCpa = (u) => { const l = u.affiliateLinks[0]; return l && l.cpa != null ? Number(l.cpa) : null; };

const auds = await prisma.auditLog.findMany({ select: { action: true, details: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
const auditByUser = new Map();
for (const a of auds) { const d = a.details; if (!d || d.cpa == null || !d.targetUserId) continue; if (d.bettingHouse && d.bettingHouse !== 'superbet') continue; if (!auditByUser.has(d.targetUserId)) auditByUser.set(d.targetUserId, []); auditByUser.get(d.targetUserId).push({ cpa: Number(d.cpa), action: a.action, date: a.createdAt }); }

const matched = new Set();
for (const t of TERMS) for (const u of all) if (u.email.toLowerCase().includes(t)) matched.add(u.id);

for (const id of matched) {
  const u = all.find(x => x.id === id);
  console.log(`\n=== ${u.email} (${u.name}) ===`);
  console.log(`  ${u.referredById ? 'downline' : 'TOPO (raiz)'} | cpa ATUAL=${liveCpa(u) ?? 'sem link'}`);
  const ae = auditByUser.get(id) ?? [];
  if (ae.length) { console.log(`  audit cpa (${ae.length}):`); for (const e of ae) console.log(`    ${e.date.toISOString().slice(0,16)} ${e.action} → cpa=${e.cpa}`); }
  else console.log('  audit cpa: NENHUM (não foi aprovado/setado via log — provável raiz setada por script)');
  const lrs = await prisma.linkRequest.findMany({ where: { userId: id, bettingHouseSlug: 'superbet', message: { contains: 'CPA' } }, orderBy: { createdAt: 'asc' }, select: { message: true, createdAt: true, fulfilledByName: true } });
  if (lrs.length) { console.log(`  linkreq (${lrs.length}):`); for (const l of lrs) console.log(`    ${l.createdAt.toISOString().slice(0,16)} by=${l.fulfilledByName||'-'} "${l.message.slice(0,60)}"`); }
}
if (matched.size === 0) console.log('Nenhum email encontrado pros termos.');
await prisma.$disconnect();

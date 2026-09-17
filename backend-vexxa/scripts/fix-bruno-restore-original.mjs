import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Restaura a rede do BRUNO pro cpa ORIGINAL (audit). Downline c/ fonte → audit; sem fonte → fica.
// Bruno (root) fica 120. rev=0. DRY por padrão. APPLY=1. Loga CommissionLog.
const APPLY = process.env.APPLY === '1';
const EMAIL = 'brunoeduardo26nicoly@gmail.com';
const all = await prisma.user.findMany({
  select: { id: true, name: true, email: true, referredById: true,
    affiliateLinks: { where: { bettingHouse: 'superbet' }, select: { id: true, cpa: true, revshare: true } } },
});
const byId = new Map(all.map(u => [u.id, u]));
const children = new Map();
for (const u of all) { if (!u.referredById) continue; if (!children.has(u.referredById)) children.set(u.referredById, []); children.get(u.referredById).push(u.id); }
const bruno = all.find(u => u.email.toLowerCase() === EMAIL);

const auds = await prisma.auditLog.findMany({ select: { details: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
const auditFirst = new Map();
for (const a of auds) { const d = a.details; if (!d || d.cpa == null || !d.targetUserId) continue; if (d.bettingHouse && d.bettingHouse !== 'superbet') continue; if (!auditFirst.has(d.targetUserId)) auditFirst.set(d.targetUserId, Number(d.cpa)); }

const mem = new Set(); let fr = [bruno.id]; while (fr.length) { const nx=[]; for (const id of fr) for (const c of (children.get(id)??[])) { if (!mem.has(c)) { mem.add(c); nx.push(c); } } fr = nx; }

const plan = []; let semFonte = 0;
for (const id of mem) {
  const u = byId.get(id); const link = u.affiliateLinks[0]; if (!link) continue;
  if (!auditFirst.has(id)) { semFonte++; continue; }
  const target = auditFirst.get(id);
  const cur = link.cpa != null ? Number(link.cpa) : null;
  const curRev = link.revshare != null ? Number(link.revshare) : null;
  if (cur === target && (curRev ?? 0) === 0) continue;
  plan.push({ uid: id, linkId: link.id, email: u.email, name: u.name, cur, curRev, target });
}
const dist = new Map(); for (const p of plan) dist.set(p.target, (dist.get(p.target) ?? 0) + 1);
console.log(`Bruno downline c/ link superbet & fonte: ${plan.length} a mudar | sem fonte (mantém): ${semFonte}`);
console.log('distrib alvo (original):', [...dist.entries()].sort((a,b)=>b[0]-a[0]).map(([v,n])=>v+'='+n).join(' '));

if (!APPLY) { console.log('\nDRY-RUN. APPLY=1 aplica.'); await prisma.$disconnect(); process.exit(0); }

const logRows = []; let n = 0;
for (const p of plan) {
  await prisma.affiliateLink.update({ where: { id: p.linkId }, data: { cpa: p.target, revshare: 0 } });
  if (p.cur !== p.target) logRows.push({ userId: p.uid, userName: p.name, userEmail: p.email, changedById: null, bettingHouse: 'superbet', field: 'cpa', oldValue: p.cur, newValue: p.target });
  if ((p.curRev ?? 0) !== 0) logRows.push({ userId: p.uid, userName: p.name, userEmail: p.email, changedById: null, bettingHouse: 'superbet', field: 'revshare', oldValue: p.curRev, newValue: 0 });
  n++;
}
for (let i = 0; i < logRows.length; i += 500) await prisma.commissionLog.createMany({ data: logRows.slice(i, i + 500) });
console.log(`\n✅ APLICADO: ${n} links | CommissionLog=${logRows.length}`);
await prisma.$disconnect();

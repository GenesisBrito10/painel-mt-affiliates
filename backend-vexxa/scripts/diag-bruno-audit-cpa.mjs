import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// READ-ONLY. CPAs ORIGINAIS (audit) da rede do Bruno vs cpa atual. Métricas.
const EMAIL = 'brunoeduardo26nicoly@gmail.com';
const all = await prisma.user.findMany({
  select: { id: true, name: true, email: true, referredById: true,
    affiliateLinks: { where: { bettingHouse: 'superbet' }, select: { cpa: true } } },
});
const byId = new Map(all.map(u => [u.id, u]));
const children = new Map();
for (const u of all) { if (!u.referredById) continue; if (!children.has(u.referredById)) children.set(u.referredById, []); children.get(u.referredById).push(u.id); }
const sbCpa = (u) => { const l = u.affiliateLinks[0]; return l && l.cpa != null ? Number(l.cpa) : null; };
const bruno = all.find(u => u.email.toLowerCase() === EMAIL);
console.log(`${bruno.email} (${bruno.name}) cpa próprio=${sbCpa(bruno)}`);

// downline (BFS por nível)
const lvl = new Map(); let fr = [bruno.id]; let level = 0;
const members = [];
while (fr.length) { level++; const nx = []; for (const id of fr) for (const c of (children.get(id) ?? [])) { if (lvl.has(c)) continue; lvl.set(c, level); members.push(c); nx.push(c); } fr = nx; }
console.log(`downline total: ${members.length} | profundidade: ${Math.max(0,...[...lvl.values()])}`);

// 1) AuditLog UPDATE_STATUS — cpa original superbet por user (último)
const auds = await prisma.auditLog.findMany({ where: { action: 'UPDATE_STATUS' }, select: { details: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
const auditCpa = new Map();
for (const a of auds) { const d = a.details; if (!d || d.bettingHouse !== 'superbet' || d.cpa == null || !d.targetUserId) continue; auditCpa.set(d.targetUserId, Number(d.cpa)); }
// 2) LinkRequest.message
const lrs = await prisma.linkRequest.findMany({ where: { bettingHouseSlug: 'superbet', message: { contains: 'CPA' } }, select: { userId: true, message: true } });
const msgCpa = new Map();
for (const l of lrs) { const m = l.message.match(/CPA R\$\s*([0-9.]+)/); if (m) msgCpa.set(l.userId, Number(m[1])); }

let viaAudit = 0, viaMsg = 0, semFonte = 0;
const distOrig = new Map(); const cmp = [];
for (const id of members) {
  const u = byId.get(id); const cur = sbCpa(u);
  let orig = null, src = null;
  if (auditCpa.has(id)) { orig = auditCpa.get(id); src = 'audit'; viaAudit++; }
  else if (msgCpa.has(id)) { orig = msgCpa.get(id); src = 'msg'; viaMsg++; }
  else { semFonte++; }
  if (orig != null) distOrig.set(orig, (distOrig.get(orig) ?? 0) + 1);
  cmp.push({ email: u.email, lvl: lvl.get(id), cur, orig, src });
}
console.log(`\n=== FONTE do cpa original ===`);
console.log(`  via AuditLog: ${viaAudit} | via LinkRequest msg: ${viaMsg} | SEM fonte: ${semFonte} | cobertura: ${((viaAudit+viaMsg)/members.length*100).toFixed(1)}%`);
console.log(`\n=== DISTRIBUIÇÃO cpa ORIGINAL (audit/msg) ===`);
console.log('  ' + [...distOrig.entries()].sort((a,b)=>b[0]-a[0]).map(([v,n])=>`R$${v}=${n}`).join(' '));
// divergência original vs atual
const diff = cmp.filter(c => c.orig != null && c.cur !== c.orig);
console.log(`\n=== ORIGINAL vs ATUAL ===`);
console.log(`  iguais: ${cmp.filter(c=>c.orig!=null&&c.cur===c.orig).length} | diferentes: ${diff.length}`);
for (const c of diff.slice(0, 40)) console.log(`  N${c.lvl} ${c.email}: original R$${c.orig} → atual R$${c.cur ?? 'sem'} (${c.src})`);
await prisma.$disconnect();

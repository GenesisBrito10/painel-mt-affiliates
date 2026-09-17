import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// READ-ONLY. Reconstrói cpa ORIGINAL superbet combinando TODAS as fontes:
// AuditLog (qualquer ação c/ details.cpa+targetUserId) + LinkRequest.message.
// Pega o MAIS ANTIGO por user (= valor de origem). Reporta cobertura e origem.
const all = await prisma.user.findMany({
  select: { id: true, email: true, referredById: true,
    affiliateLinks: { where: { bettingHouse: 'superbet' }, select: { cpa: true } } },
});
const byId = new Map(all.map(u => [u.id, u]));
const hasSb = (u) => !!u.affiliateLinks[0];
const liveCpa = (u) => { const l = u.affiliateLinks[0]; return l && l.cpa != null ? Number(l.cpa) : null; };

const auds = await prisma.auditLog.findMany({ select: { action: true, details: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
const auditFirst = new Map();
for (const a of auds) {
  const d = a.details; if (!d || d.cpa == null || !d.targetUserId) continue;
  if (d.bettingHouse && d.bettingHouse !== 'superbet') continue;
  if (!auditFirst.has(d.targetUserId)) auditFirst.set(d.targetUserId, { cpa: Number(d.cpa), action: a.action, date: a.createdAt });
}

const lrs = await prisma.linkRequest.findMany({ where: { bettingHouseSlug: 'superbet', message: { contains: 'CPA' } }, orderBy: { createdAt: 'asc' }, select: { userId: true, message: true, fulfilledByName: true, createdAt: true } });
const lrFirst = new Map();
for (const l of lrs) { const m = l.message.match(/CPA R\$\s*([0-9.]+)/); if (!m) continue; if (!lrFirst.has(l.userId)) lrFirst.set(l.userId, { cpa: Number(m[1]), by: l.fulfilledByName || '?', date: l.createdAt }); }

let cobAudit = 0, cobLr = 0, cobAmbas = 0, semNada = 0;
const orig = new Map(); const srcCount = new Map();
const downSb = all.filter(u => u.referredById && hasSb(u));
for (const u of downSb) {
  const a = auditFirst.get(u.id), l = lrFirst.get(u.id);
  let chosen = null, src = null;
  if (a && l) { cobAmbas++; if (a.date <= l.date) { chosen = a.cpa; src = 'audit'; } else { chosen = l.cpa; src = 'linkreq'; } }
  else if (a) { cobAudit++; chosen = a.cpa; src = 'audit'; }
  else if (l) { cobLr++; chosen = l.cpa; src = 'linkreq'; }
  else { semNada++; continue; }
  orig.set(u.id, chosen); srcCount.set(src, (srcCount.get(src) ?? 0) + 1);
}
const totalDown = downSb.length;
const cobertos = orig.size;
console.log(`Downline c/ link superbet: ${totalDown}`);
console.log(`COBERTURA original: ${cobertos} (${(cobertos/totalDown*100).toFixed(1)}%) | sem nenhuma fonte: ${semNada}`);
console.log(`  só audit: ${cobAudit} | só linkreq: ${cobLr} | ambas: ${cobAmbas}`);
console.log(`  origem escolhida: ${[...srcCount.entries()].map(([s,n])=>`${s}=${n}`).join(' ')}`);

const distO = new Map(); let igual = 0, dif = 0;
for (const [uid, o] of orig) { distO.set(o, (distO.get(o) ?? 0) + 1); const cur = liveCpa(byId.get(uid)); if (cur === o) igual++; else dif++; }
console.log('\ndistrib cpa ORIGINAL reconstruído:', [...distO.entries()].sort((a,b)=>b[0]-a[0]).map(([v,n])=>`${v}=${n}`).join(' '));
console.log(`original == atual: ${igual} | diferente: ${dif}`);
await prisma.$disconnect();

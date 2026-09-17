import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// READ-ONLY. Para cada user c/ audit original (superbet): o audit dele bate com
// referer_ATUAL − 5? E o original(audit) do referer == cpa atual do referer?
// Caso eullers: audit=100 mas referer atual=115 → correto seria 110.
const STEP = 5;
const all = await prisma.user.findMany({
  select: { id: true, name: true, email: true, referredById: true,
    affiliateLinks: { where: { bettingHouse: 'superbet' }, select: { cpa: true } } },
});
const byId = new Map(all.map(u => [u.id, u]));
const liveCpa = (u) => { const l = u?.affiliateLinks[0]; return l && l.cpa != null ? Number(l.cpa) : null; };

const auds = await prisma.auditLog.findMany({ where: { action: 'UPDATE_STATUS' }, select: { details: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
const auditCpa = new Map();
for (const a of auds) { const d = a.details; if (!d || d.bettingHouse !== 'superbet' || d.cpa == null || !d.targetUserId) continue; auditCpa.set(d.targetUserId, Number(d.cpa)); }

let comAudit = 0, consistente = 0;
const problem = [];
const refMovedCount = { sim: 0, nao: 0, refSemAudit: 0 };
for (const u of all) {
  if (!u.referredById) continue;
  if (!auditCpa.has(u.id)) continue;
  if (!u.affiliateLinks[0]) continue;
  comAudit++;
  const userOrig = auditCpa.get(u.id);
  const ref = byId.get(u.referredById);
  const refCur = liveCpa(ref);
  const refOrig = auditCpa.has(ref?.id) ? auditCpa.get(ref.id) : null;
  const expected = refCur != null ? refCur - STEP : null;
  const refMoved = refOrig == null ? 'refSemAudit' : (refOrig === refCur ? 'nao' : 'sim');
  refMovedCount[refMoved]++;
  if (expected != null && userOrig !== expected) {
    problem.push({ email: u.email, userOrig, refEmail: ref?.email, refCur, refOrig, expected, refMoved });
  } else consistente++;
}

console.log(`Users c/ audit original (downline superbet): ${comAudit}`);
console.log(`  audit == referer_atual − 5 (consistente): ${consistente}`);
console.log(`  audit != referer_atual − 5 (PROBLEMA tipo eullers): ${problem.length}`);
console.log(`\nReferer moveu (original != atual)?  sim=${refMovedCount.sim}  nao=${refMovedCount.nao}  referer-sem-audit=${refMovedCount.refSemAudit}`);

const dd = new Map();
for (const p of problem) dd.set(p.expected - p.userOrig, (dd.get(p.expected - p.userOrig) ?? 0) + 1);
console.log('\ndiferença (referer_atual−5) − audit:', [...dd.entries()].sort((a,b)=>b[1]-a[1]).map(([d,n])=>`${d>0?'+':''}${d}:${n}`).join(' '));

console.log('\n=== PROBLEMA (amostra 40) ===');
for (const p of problem.slice(0, 40)) console.log(`  ${p.email}: audit=${p.userOrig} | referer ${p.refEmail} atual=${p.refCur} orig=${p.refOrig ?? 'sem'} → correto(ref−5)=${p.expected} (refMoveu=${p.refMoved})`);
await prisma.$disconnect();

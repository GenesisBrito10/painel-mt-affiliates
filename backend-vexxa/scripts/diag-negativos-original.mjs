import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// READ-ONLY. Negativos SE restaurar cpa ORIGINAL (audit else live) em todos.
// Replica DashboardBalanceService: own + rede(margem head−l1, 10 níveis) + bonus + adj
//   − fraude − saque(pós-cut, ativo, ≠all). Floor max(0,base).
const cut = new Date('2026-05-22T00:00:00.000Z');
const ACTIVE = ['PENDING','APPROVED','PROCESSING','COMPLETED'];

const all = await prisma.user.findMany({
  select: { id: true, name: true, email: true, referredById: true, bonusBalance: true, balanceAdjustment: true,
    affiliateLinks: { select: { campaignId: true, bettingHouse: true, cpa: true, revshare: true } },
    fraudCounts: { select: { bettingHouse: true, count: true } } },
});
const byId = new Map(all.map(u => [u.id, u]));
const children = new Map();
for (const u of all) { if (!u.referredById) continue; if (!children.has(u.referredById)) children.set(u.referredById, []); children.get(u.referredById).push(u.id); }

const auds = await prisma.auditLog.findMany({ where: { action: 'UPDATE_STATUS' }, select: { details: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
const auditCpa = new Map();
for (const a of auds) { const d = a.details; if (!d || d.bettingHouse !== 'superbet' || d.cpa == null || !d.targetUserId) continue; auditCpa.set(d.targetUserId, Number(d.cpa)); }

const agg = await prisma.affiliateData.groupBy({ by: ['campaignId','bettingHouse'], where: { date: { gte: cut } }, _sum: { cpaQualified: true, revShare: true } });
const data = new Map();
for (const r of agg) data.set(`${r.campaignId}|${r.bettingHouse}`, { q: r._sum.cpaQualified ?? 0, rev: Number(r._sum.revShare ?? 0) });

const ws = await prisma.withdrawalRequest.findMany({ where: { status: { in: ACTIVE }, createdAt: { gte: cut }, bettingHouse: { not: 'all' } }, select: { userId: true, originalAmount: true, gatewayRefundedAmount: true } });
const wByUser = new Map();
for (const w of ws) wByUser.set(w.userId, (wByUser.get(w.userId) ?? 0) + (w.originalAmount.toNumber() - (w.gatewayRefundedAmount?.toNumber() ?? 0)));

const liveSb = (u) => { const l = u.affiliateLinks.find(x=>x.bettingHouse==='superbet'); return l && l.cpa != null ? Number(l.cpa) : null; };
const origSb = (uid) => auditCpa.has(uid) ? auditCpa.get(uid) : liveSb(byId.get(uid));
function ratesOf(u) {
  const rate = new Map(), rev = new Map();
  for (const l of u.affiliateLinks) {
    if (l.bettingHouse === 'superbet') { rate.set('superbet', origSb(u.id) ?? 0); rev.set('superbet', 0); }
    else { rate.set(l.bettingHouse, l.cpa ? Number(l.cpa) : 0); rev.set(l.bettingHouse, l.revshare ? Number(l.revshare) : 0); }
  }
  return { rate, rev };
}
function networkSpread(headId, rate, rev) {
  const l1 = children.get(headId) ?? []; if (!l1.length) return 0;
  const anc = new Map(); for (const id of l1) anc.set(id, ratesOf(byId.get(id)));
  let net = 0; let frontier = [...l1], lvl = 1; const seen = new Set([headId, ...l1]);
  while (frontier.length && lvl <= 10) {
    for (const id of frontier) { const m = byId.get(id); const a = anc.get(id); if (!a) continue;
      for (const l of m.affiliateLinks) { const h = l.bettingHouse; const mc = Math.max(0,(rate.get(h)??0)-(a.rate.get(h)??0)); const mr = Math.max(0,(rev.get(h)??0)-(a.rev.get(h)??0)); if (mc<=0&&mr<=0) continue; const d = data.get(`${l.campaignId}|${h}`); if (!d) continue; net += mc*d.q + (mr/100)*d.rev; } }
    const nx=[]; for (const id of frontier) for (const c of (children.get(id)??[])) { if (seen.has(c)) continue; seen.add(c); anc.set(c, anc.get(id)); nx.push(c); } frontier = nx; lvl++;
  }
  return net;
}

const negs = [];
for (const [uid, wsum] of wByUser) {
  const u = byId.get(uid); if (!u) continue;
  const { rate, rev } = ratesOf(u);
  let own = 0; for (const l of u.affiliateLinks) { const d = data.get(`${l.campaignId}|${l.bettingHouse}`); if (!d) continue; own += (rate.get(l.bettingHouse)??0)*d.q + ((rev.get(l.bettingHouse)??0)/100)*d.rev; }
  const net = networkSpread(uid, rate, rev);
  let fraud = 0; for (const f of u.fraudCounts) if (f.count>0) fraud += (rate.get(f.bettingHouse)??0)*f.count;
  const base = own + net + u.bonusBalance.toNumber() + u.balanceAdjustment.toNumber();
  const bal = Math.max(0, base) - fraud - wsum;
  if (bal < -0.01) negs.push({ email: u.email, name: u.name, bal, wsum, gross: own+net });
}
negs.sort((a,b)=>a.bal-b.bal);
const total = negs.reduce((a,n)=>a+n.bal,0);
console.log(`(regime ORIGINAL — audit else live)`);
console.log(`saque pós-cut: ${wByUser.size} | NEGATIVOS: ${negs.length} | total: R$${total.toFixed(2)}\n`);
for (const n of negs) console.log(`  R$${n.bal.toFixed(2)} | sacou=${n.wsum.toFixed(2)} ganho=${n.gross.toFixed(2)} | ${n.email} (${n.name})`);
await prisma.$disconnect();

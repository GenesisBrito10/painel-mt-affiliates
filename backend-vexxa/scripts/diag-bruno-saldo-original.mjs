import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// READ-ONLY. Saldo do Bruno: regime ATUAL (120-cascata) vs ORIGINAL (audit).
const EMAIL = (process.env.TARGET_EMAIL ?? 'brunoeduardo26nicoly@gmail.com').toLowerCase();
const cut = new Date('2026-05-22T00:00:00.000Z');
const ACTIVE = ['PENDING','APPROVED','PROCESSING','COMPLETED'];

const all = await prisma.user.findMany({
  select: { id: true, email: true, referredById: true, bonusBalance: true, balanceAdjustment: true,
    affiliateLinks: { select: { campaignId: true, bettingHouse: true, cpa: true, revshare: true } },
    fraudCounts: { select: { bettingHouse: true, count: true } } },
});
const byId = new Map(all.map(u => [u.id, u]));
const children = new Map();
for (const u of all) { if (!u.referredById) continue; if (!children.has(u.referredById)) children.set(u.referredById, []); children.get(u.referredById).push(u.id); }
const bruno = all.find(u => u.email.toLowerCase() === EMAIL);

// audit original superbet
const auds = await prisma.auditLog.findMany({ where: { action: 'UPDATE_STATUS' }, select: { details: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
const auditCpa = new Map();
for (const a of auds) { const d = a.details; if (!d || d.bettingHouse !== 'superbet' || d.cpa == null || !d.targetUserId) continue; auditCpa.set(d.targetUserId, Number(d.cpa)); }

// dados pós-cut por campaign|house
const agg = await prisma.affiliateData.groupBy({ by: ['campaignId','bettingHouse'], where: { date: { gte: cut } }, _sum: { cpaQualified: true, revShare: true } });
const data = new Map();
for (const r of agg) data.set(`${r.campaignId}|${r.bettingHouse}`, { q: r._sum.cpaQualified ?? 0, rev: Number(r._sum.revShare ?? 0) });

const liveSb = (u) => { const l = u.affiliateLinks.find(x=>x.bettingHouse==='superbet'); return l && l.cpa != null ? Number(l.cpa) : null; };
const sbCpaReg = (uid, regime) => { const lv = liveSb(byId.get(uid)); if (regime === 'cascade') return lv; return auditCpa.has(uid) ? auditCpa.get(uid) : lv; };

function ratesOf(u, regime) {
  const rate = new Map(), rev = new Map();
  for (const l of u.affiliateLinks) {
    if (l.bettingHouse === 'superbet') { rate.set('superbet', sbCpaReg(u.id, regime) ?? 0); rev.set('superbet', 0); }
    else { rate.set(l.bettingHouse, l.cpa ? Number(l.cpa) : 0); rev.set(l.bettingHouse, l.revshare ? Number(l.revshare) : 0); }
  }
  return { rate, rev };
}

function balanceOf(regime) {
  const { rate, rev } = ratesOf(bruno, regime);
  let own = 0;
  for (const l of bruno.affiliateLinks) { const d = data.get(`${l.campaignId}|${l.bettingHouse}`); if (!d) continue; own += (rate.get(l.bettingHouse) ?? 0) * d.q + ((rev.get(l.bettingHouse) ?? 0)/100) * d.rev; }
  const l1 = children.get(bruno.id) ?? [];
  const anc = new Map(); for (const id of l1) anc.set(id, ratesOf(byId.get(id), regime));
  let net = 0; let frontier = [...l1], lvl = 1; const seen = new Set([bruno.id, ...l1]);
  while (frontier.length && lvl <= 10) {
    for (const id of frontier) { const m = byId.get(id); const a = anc.get(id); if (!a) continue;
      for (const l of m.affiliateLinks) { const h = l.bettingHouse; const mc = Math.max(0, (rate.get(h) ?? 0) - (a.rate.get(h) ?? 0)); const mr = Math.max(0, (rev.get(h) ?? 0) - (a.rev.get(h) ?? 0)); if (mc<=0&&mr<=0) continue; const d = data.get(`${l.campaignId}|${h}`); if (!d) continue; net += mc*d.q + (mr/100)*d.rev; } }
    const nx = []; for (const id of frontier) for (const c of (children.get(id) ?? [])) { if (seen.has(c)) continue; seen.add(c); anc.set(c, anc.get(id)); nx.push(c); } frontier = nx; lvl++;
  }
  let fraud = 0; for (const f of bruno.fraudCounts) if (f.count>0) fraud += (rate.get(f.bettingHouse) ?? 0) * f.count;
  return { own, net, fraud };
}

const ws = await prisma.withdrawalRequest.findMany({ where: { userId: bruno.id, status: { in: ACTIVE }, createdAt: { gte: cut }, bettingHouse: { not: 'all' } }, select: { originalAmount: true, gatewayRefundedAmount: true } });
const wsum = ws.reduce((a,w)=>a+(w.originalAmount.toNumber()-(w.gatewayRefundedAmount?.toNumber()??0)),0);
const bonus = bruno.bonusBalance.toNumber(), adj = bruno.balanceAdjustment.toNumber();

console.log(`${bruno.email}`);
console.log(`cpa próprio: cascata=${sbCpaReg(bruno.id,'cascade')} | original(audit)=${auditCpa.has(bruno.id)?auditCpa.get(bruno.id):'sem audit (mantém '+sbCpaReg(bruno.id,'cascade')+')'}`);
console.log(`bonus=${bonus} adj=${adj} saque(≠all)=R$${wsum.toFixed(2)}\n`);
for (const reg of ['cascade','original']) {
  const { own, net, fraud } = balanceOf(reg);
  const bal = Math.max(0, own+net+bonus+adj) - fraud - wsum;
  console.log(`${reg.padEnd(9)}: own=R$${own.toFixed(2)} rede=R$${net.toFixed(2)} fraude=R$${fraud.toFixed(2)} → SALDO=R$${bal.toFixed(2)}`);
}
await prisma.$disconnect();

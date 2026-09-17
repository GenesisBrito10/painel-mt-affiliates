import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// READ-ONLY. Para cada email: rede por dia (spread), own, bonus, saques, saldo.
const EMAILS = ['richarlysondossantos795@gmail.com','lucassmedeiross397@gmail.com','vp8672901@gmail.com','eullers12@gmail.com'];
const cut = new Date('2026-05-22T00:00:00.000Z');
const ACTIVE = ['PENDING','APPROVED','PROCESSING','COMPLETED'];
const FEE = 0.06;

const all = await prisma.user.findMany({
  select: { id: true, name: true, email: true, referredById: true, bonusBalance: true, balanceAdjustment: true,
    affiliateLinks: { select: { campaignId: true, bettingHouse: true, cpa: true, revshare: true } },
    fraudCounts: { select: { bettingHouse: true, count: true } } },
});
const byId = new Map(all.map(u => [u.id, u]));
const byEmail = new Map(all.map(u => [u.email.toLowerCase(), u]));
const children = new Map();
for (const u of all) { if (!u.referredById) continue; if (!children.has(u.referredById)) children.set(u.referredById, []); children.get(u.referredById).push(u.id); }
const ratesOf = (u) => { const r = new Map(); for (const l of u.affiliateLinks) if (l.cpa && Number(l.cpa) > 0) r.set(l.bettingHouse, Number(l.cpa)); return r; };

const agg = await prisma.affiliateData.groupBy({ by: ['campaignId','bettingHouse'], where: { date: { gte: cut } }, _sum: { cpaQualified: true, revShare: true } });
const dataTotal = new Map();
for (const r of agg) dataTotal.set(`${r.campaignId}|${r.bettingHouse}`, { q: r._sum.cpaQualified ?? 0, rev: Number(r._sum.revShare ?? 0) });

for (const email of EMAILS) {
  const u = byEmail.get(email);
  console.log('\n==================================================');
  if (!u) { console.log(`${email}: NÃO ENCONTRADO`); continue; }
  console.log(`${u.email} (${u.name})`);
  const kRate = new Map(), kRev = new Map();
  for (const l of u.affiliateLinks) { kRate.set(l.bettingHouse, l.cpa ? Number(l.cpa) : 0); kRev.set(l.bettingHouse, l.revshare ? Number(l.revshare) : 0); }
  console.log(`cpa superbet=${kRate.get('superbet') ?? 'sem'} | referredById=${u.referredById ? 'tem upline' : 'topo'}`);

  let own = 0;
  for (const l of u.affiliateLinks) { const d = dataTotal.get(`${l.campaignId}|${l.bettingHouse}`); if (!d) continue; own += (kRate.get(l.bettingHouse) ?? 0) * d.q + ((kRev.get(l.bettingHouse) ?? 0) / 100) * d.rev; }

  // ganho PRÓPRIO por dia
  const ownCamps = u.affiliateLinks.map(l => l.campaignId);
  if (ownCamps.length) {
    const orows = await prisma.affiliateData.groupBy({ by: ['campaignId','bettingHouse','date'], where: { campaignId: { in: ownCamps }, date: { gte: cut } }, _sum: { cpaQualified: true, revShare: true } });
    const od = new Map();
    for (const r of orows) { const rate = kRate.get(r.bettingHouse) ?? 0; const q = r._sum.cpaQualified ?? 0; const val = rate * q + ((kRev.get(r.bettingHouse) ?? 0)/100) * Number(r._sum.revShare ?? 0); const day = r.date.toISOString().slice(0,10); const e = od.get(day) ?? { q:0, v:0 }; e.q += q; e.v += val; od.set(day, e); }
    console.log('GANHO PRÓPRIO por dia (cpaQ | R$):');
    for (const [d, e] of [...od.entries()].sort()) console.log(`  ${d}: ${e.q} cpa | R$${e.v.toFixed(2)}`);
  }

  const anc = new Map();
  for (const id of (children.get(u.id) ?? [])) anc.set(id, ratesOf(byId.get(id)));
  let frontier = [...(children.get(u.id) ?? [])], lvl = 1; const seen = new Set([u.id, ...frontier]);
  while (frontier.length && lvl < 10) { lvl++; const nx = []; for (const id of frontier) for (const c of (children.get(id) ?? [])) { if (seen.has(c)) continue; seen.add(c); anc.set(c, anc.get(id)); nx.push(c); } frontier = nx; }
  const memberIds = [...anc.keys()];
  const memberByCH = new Map();
  for (const id of memberIds) for (const l of byId.get(id).affiliateLinks) memberByCH.set(`${l.campaignId}|${l.bettingHouse}`, id);
  const campIds = [...new Set(memberIds.flatMap(id => byId.get(id).affiliateLinks.map(l => l.campaignId)))];

  let netTotal = 0;
  if (campIds.length) {
    const rows = await prisma.affiliateData.groupBy({ by: ['campaignId','bettingHouse','date'], where: { campaignId: { in: campIds }, date: { gte: cut } }, _sum: { cpaQualified: true, revShare: true } });
    const byDay = new Map();
    for (const r of rows) {
      const mid = memberByCH.get(`${r.campaignId}|${r.bettingHouse}`); if (!mid) continue;
      const a = anc.get(mid); const h = r.bettingHouse;
      const mc = Math.max(0, (kRate.get(h) ?? 0) - (a.get(h) ?? 0));
      const q = r._sum.cpaQualified ?? 0;
      const val = mc * q;
      const day = r.date.toISOString().slice(0,10);
      const e = byDay.get(day) ?? { q: 0, spread: 0 }; e.q += q; e.spread += val; byDay.set(day, e);
      netTotal += val;
    }
    console.log('REDE por dia (cpaQ | spread):');
    for (const [d, e] of [...byDay.entries()].sort()) console.log(`  ${d}: ${e.q} cpa | R$${e.spread.toFixed(2)}`);
  } else console.log('REDE: nenhum membro com dados');
  console.log(`  rede total pós-cut: R$${netTotal.toFixed(2)}`);

  const ws = await prisma.withdrawalRequest.findMany({ where: { userId: u.id, status: { in: ACTIVE }, createdAt: { gte: cut }, bettingHouse: { not: 'all' } }, select: { createdAt: true, bettingHouse: true, originalAmount: true, gatewayRefundedAmount: true } });
  let wsum = 0;
  console.log('SAQUES pós-cutover (≠ liquidação):');
  for (const w of ws) { const o = w.originalAmount.toNumber(); const net = o - (w.gatewayRefundedAmount?.toNumber() ?? 0); wsum += net; console.log(`  ${w.createdAt.toISOString().slice(0,10)} ${w.bettingHouse} bruto=R$${o.toFixed(2)} líquido≈R$${(o*(1-FEE)).toFixed(2)}`); }
  if (!ws.length) console.log('  nenhum');

  const bonus = u.bonusBalance.toNumber(), adj = u.balanceAdjustment.toNumber();
  let fraud = 0; for (const f of u.fraudCounts) if (f.count > 0) fraud += (kRate.get(f.bettingHouse) ?? 0) * f.count;
  const base = own + netTotal + bonus + adj;
  const bal = Math.max(0, base) - fraud - wsum;
  console.log(`own=R$${own.toFixed(2)} | rede=R$${netTotal.toFixed(2)} | bonus=R$${bonus.toFixed(2)} | adj=R$${adj.toFixed(2)} | fraude=R$${fraud.toFixed(2)} | saque=R$${wsum.toFixed(2)}`);
  console.log(`SALDO DISPONÍVEL = R$${bal.toFixed(2)}`);
}
await prisma.$disconnect();

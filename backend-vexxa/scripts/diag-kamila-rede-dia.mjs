import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// READ-ONLY. Rede da Kamila (BFS 10 níveis, âncora L1) por DIA:
// cpaQualified total + spread (margem = kamilaCpa − l1Cpa) + breakdown de margem.
const all = await prisma.user.findMany({
  select: { id: true, email: true, referredById: true,
    affiliateLinks: { select: { campaignId: true, bettingHouse: true, cpa: true, revshare: true } } },
});
const byId = new Map(all.map(u => [u.id, u]));
const children = new Map();
for (const u of all) { if (!u.referredById) continue; if (!children.has(u.referredById)) children.set(u.referredById, []); children.get(u.referredById).push(u.id); }
const k = all.find(u => u.email === 'kamilabrambati@hotmail.com');
const kRate = new Map(); for (const l of k.affiliateLinks) kRate.set(l.bettingHouse, l.cpa ? Number(l.cpa) : 0);
const ratesOf = (u) => { const r = new Map(); for (const l of u.affiliateLinks) if (l.cpa && Number(l.cpa) > 0) r.set(l.bettingHouse, Number(l.cpa)); return r; };

// BFS 10 níveis, âncora = cpa do ancestral L1 por casa
const anc = new Map(); const memberLevel = new Map();
for (const id of (children.get(k.id) ?? [])) { anc.set(id, ratesOf(byId.get(id))); memberLevel.set(id, 1); }
let frontier = [...(children.get(k.id) ?? [])], level = 1; const visited = new Set([k.id, ...frontier]);
while (frontier.length && level < 10) { level++; const next = []; for (const id of frontier) for (const c of (children.get(id) ?? [])) { if (visited.has(c)) continue; visited.add(c); anc.set(c, anc.get(id)); memberLevel.set(c, level); next.push(c); } frontier = next; }

const memberIds = [...anc.keys()];
const campIds = [...new Set(memberIds.flatMap(id => byId.get(id).affiliateLinks.map(l => l.campaignId)))];

// AffiliateData por dia dos membros
const rows = await prisma.affiliateData.groupBy({ by: ['campaignId', 'bettingHouse', 'date'], where: { campaignId: { in: campIds }, date: { gte: new Date('2026-05-21T00:00:00.000Z') } }, _sum: { cpaQualified: true, revShare: true } });
// indexa membro por (campaign|house)
const memberByCH = new Map();
for (const id of memberIds) for (const l of byId.get(id).affiliateLinks) memberByCH.set(`${l.campaignId}|${l.bettingHouse}`, id);

const byDay = new Map(); // day -> { q, spread, marginCount: Map }
for (const r of rows) {
  const mid = memberByCH.get(`${r.campaignId}|${r.bettingHouse}`); if (!mid) continue;
  const a = anc.get(mid); const h = r.bettingHouse;
  const margin = Math.max(0, (kRate.get(h) ?? 0) - (a.get(h) ?? 0));
  const q = r._sum.cpaQualified ?? 0;
  const day = r.date.toISOString().slice(0, 10);
  const e = byDay.get(day) ?? { q: 0, spread: 0, mc: new Map() };
  e.q += q; e.spread += margin * q;
  e.mc.set(margin, (e.mc.get(margin) ?? 0) + q);
  byDay.set(day, e);
}
console.log(`Kamila cpa próprio superbet=${kRate.get('superbet')} | membros rede(10 níveis)=${memberIds.length}\n`);
console.log('=== REDE por dia: cpaQualified + spread ===');
for (const [day, e] of [...byDay.entries()].sort()) {
  const mcStr = [...e.mc.entries()].sort((a,b)=>b[0]-a[0]).map(([m,n])=>`margem${m}×${n}cpa`).join(' ');
  console.log(`  ${day}: cpaQ=${e.q} | spread=R$${e.spread.toFixed(2)} | ${mcStr}`);
}
await prisma.$disconnect();

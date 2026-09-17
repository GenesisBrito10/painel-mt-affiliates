import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// READ-ONLY. Heads (users com downline) cujo cpa próprio superbet != 120.
const all = await prisma.user.findMany({
  select: { id: true, name: true, email: true, referredById: true,
    affiliateLinks: { where: { bettingHouse: 'superbet' }, select: { cpa: true } } },
});
const children = new Map();
for (const u of all) { if (!u.referredById) continue; if (!children.has(u.referredById)) children.set(u.referredById, []); children.get(u.referredById).push(u.id); }
const downlineSize = (id) => { const mem = new Set(); let fr = [id]; while (fr.length) { const nx = []; for (const x of fr) for (const c of (children.get(x) ?? [])) { if (!mem.has(c)) { mem.add(c); nx.push(c); } } fr = nx; } return mem.size; };
const sbCpa = (u) => { const l = u.affiliateLinks[0]; return l && l.cpa != null ? Number(l.cpa) : null; };

const heads = all.filter(u => (children.get(u.id)?.length ?? 0) > 0);
const topo = [], sub = [];
for (const h of heads) {
  const cpa = sbCpa(h);
  if (cpa === 120) continue;
  const row = { email: h.email, name: h.name, cpa, dl: downlineSize(h.id) };
  if (!h.referredById) topo.push(row); else sub.push(row);
}
topo.sort((a,b)=>b.dl-a.dl); sub.sort((a,b)=>b.dl-a.dl);

console.log(`Total heads: ${heads.length} | topo(raiz): ${heads.filter(h=>!h.referredById).length} | sub-head: ${heads.filter(h=>h.referredById).length}\n`);
console.log(`=== TOPO (referredById=null) com cpa != 120: ${topo.length} ===`);
for (const r of topo) console.log(`  cpa=${r.cpa ?? 'sem-superbet'} | downline=${r.dl} | ${r.email} (${r.name})`);
console.log(`\n=== SUB-HEADS (têm referer) com cpa != 120: ${sub.length} ===`);
console.log('(esperado != 120 — são downline, cpa = referer−5)');
const dist = new Map(); for (const r of sub) dist.set(r.cpa, (dist.get(r.cpa) ?? 0) + 1);
console.log('distribuição cpa sub-heads:', [...dist.entries()].sort((a,b)=>(b[0]??-1)-(a[0]??-1)).map(([v,n])=>`${v}=${n}`).join(' '));

await prisma.$disconnect();

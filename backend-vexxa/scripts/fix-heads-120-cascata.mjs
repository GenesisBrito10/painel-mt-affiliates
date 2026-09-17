import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Top heads (referredById=null) COM link superbet → cpa=120. Depois cascateia
// o downline: child = pai − 5 (floor 0), top-down a partir de 120. rev=0.
// Roots SEM link superbet (gestores) → subtree intocado (sem âncora).
// DRY por padrão. APPLY=1 aplica. Loga CommissionLog.
const APPLY = process.env.APPLY === '1';
const TOP = 120, STEP = 5;

const all = await prisma.user.findMany({
  select: { id: true, name: true, email: true, referredById: true,
    affiliateLinks: { where: { bettingHouse: 'superbet' }, select: { id: true, cpa: true, revshare: true } } },
});
const byId = new Map(all.map(u => [u.id, u]));
const children = new Map();
for (const u of all) { if (!u.referredById) continue; if (!children.has(u.referredById)) children.set(u.referredById, []); children.get(u.referredById).push(u.id); }
const sbLink = (u) => u.affiliateLinks[0] ?? null;

// Propaga cpa notional top-down. Root c/ superbet = 120 (forçado). Root sem superbet = null.
const cpaOf = new Map();
const roots = all.filter(u => !u.referredById);
let rootsComSb = 0, rootsSemSb = 0;
for (const r of roots) {
  const anchor = sbLink(r) ? TOP : null;
  if (anchor != null) rootsComSb++; else rootsSemSb++;
  cpaOf.set(r.id, anchor);
  const stack = [r.id]; const seen = new Set([r.id]);
  while (stack.length) {
    const pid = stack.pop(); const pc = cpaOf.get(pid);
    for (const cid of (children.get(pid) ?? [])) {
      if (seen.has(cid)) continue; seen.add(cid);
      cpaOf.set(cid, pc == null ? null : Math.max(0, pc - STEP));
      stack.push(cid);
    }
  }
}

// Plano de mudanças
const rootChanges = [], dlChanges = []; let semCpa = 0;
for (const u of all) {
  const link = sbLink(u); if (!link) continue;
  const target = cpaOf.get(u.id);
  if (target == null) { semCpa++; continue; }
  const cur = link.cpa != null ? Number(link.cpa) : null;
  const curRev = link.revshare != null ? Number(link.revshare) : null;
  if (cur === target && (curRev ?? 0) === 0) continue;
  const rec = { uid: u.id, linkId: link.id, email: u.email, name: u.name, cur, curRev, target };
  if (!u.referredById) rootChanges.push(rec); else dlChanges.push(rec);
}

console.log(`Roots: ${roots.length} | c/ superbet (→120): ${rootsComSb} | sem superbet (ignorados): ${rootsSemSb}`);
console.log(`\n=== ROOTS que mudam p/ 120: ${rootChanges.length} ===`);
for (const r of rootChanges) console.log(`  ${r.cur ?? 'null'}→120 | ${r.email} (${r.name})`);
console.log(`\n=== DOWNLINE que muda (cascata −5): ${dlChanges.length} | links sem âncora (root gestor, pulados): ${semCpa} ===`);
const dist = new Map(); for (const d of dlChanges) dist.set(d.target, (dist.get(d.target) ?? 0) + 1);
console.log('distrib alvo downline:', [...dist.entries()].sort((a,b)=>b[0]-a[0]).map(([v,n])=>v+'='+n).join(' '));
const floored = dlChanges.filter(d => d.target === 0).length;
console.log(`chegando a floor 0: ${floored}`);

if (!APPLY) { console.log('\nDRY-RUN. APPLY=1 aplica.'); await prisma.$disconnect(); process.exit(0); }

const logRows = []; let n = 0;
for (const c of [...rootChanges, ...dlChanges]) {
  await prisma.affiliateLink.update({ where: { id: c.linkId }, data: { cpa: c.target, revshare: 0 } });
  if (c.cur !== c.target) logRows.push({ userId: c.uid, userName: c.name, userEmail: c.email, changedById: null, bettingHouse: 'superbet', field: 'cpa', oldValue: c.cur, newValue: c.target });
  if ((c.curRev ?? 0) !== 0) logRows.push({ userId: c.uid, userName: c.name, userEmail: c.email, changedById: null, bettingHouse: 'superbet', field: 'revshare', oldValue: c.curRev, newValue: 0 });
  n++;
}
for (let i = 0; i < logRows.length; i += 500) await prisma.commissionLog.createMany({ data: logRows.slice(i, i + 500) });
console.log(`\n✅ APLICADO: ${n} links (${rootChanges.length} roots + ${dlChanges.length} downline) | CommissionLog=${logRows.length}`);
await prisma.$disconnect();

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// READ-ONLY. Users c/ link superbet SEM fonte de cpa (audit+linkreq), split root vs downline.
const all = await prisma.user.findMany({
  select: { id: true, name: true, email: true, referredById: true,
    affiliateLinks: { where: { bettingHouse: 'superbet' }, select: { cpa: true } } },
});
const children = new Map();
for (const u of all) { if (!u.referredById) continue; if (!children.has(u.referredById)) children.set(u.referredById, []); children.get(u.referredById).push(u.id); }
const dlSize = (id) => { const m = new Set(); let f=[id]; while(f.length){const n=[];for(const x of f)for(const c of (children.get(x)??[])){if(!m.has(c)){m.add(c);n.push(c);}}f=n;} return m.size; };
const hasSb = (u) => !!u.affiliateLinks[0];
const cpa = (u) => { const l=u.affiliateLinks[0]; return l&&l.cpa!=null?Number(l.cpa):null; };

const auds = await prisma.auditLog.findMany({ select: { details: true } });
const auditSet = new Set();
for (const a of auds) { const d=a.details; if (d && d.cpa!=null && d.targetUserId && (!d.bettingHouse || d.bettingHouse==='superbet')) auditSet.add(d.targetUserId); }
const lrs = await prisma.linkRequest.findMany({ where: { bettingHouseSlug: 'superbet', message: { contains: 'CPA' } }, select: { userId: true } });
const lrSet = new Set(lrs.map(l=>l.userId));

const semFonteRoots = [], semFonteDown = [];
for (const u of all) {
  if (!hasSb(u)) continue;
  if (auditSet.has(u.id) || lrSet.has(u.id)) continue;
  if (u.referredById) semFonteDown.push(u); else semFonteRoots.push(u);
}
console.log(`Superbet-link SEM fonte de cpa: ${semFonteRoots.length + semFonteDown.length}`);
console.log(`  ROOTS (topo): ${semFonteRoots.length}`);
console.log(`  downline: ${semFonteDown.length}\n`);

const rows = semFonteRoots.map(u => ({ email: u.email, name: u.name, cpa: cpa(u), dl: dlSize(u.id) })).sort((a,b)=>b.dl-a.dl);
console.log('=== ROOTS sem fonte (ordenado por downline) ===');
for (const r of rows) console.log(`  cpa=${r.cpa} downline=${r.dl} | ${r.email} (${r.name})`);
const distCpa = new Map(); for (const r of rows) distCpa.set(r.cpa, (distCpa.get(r.cpa)??0)+1);
console.log('\ndistrib cpa atual dos roots sem fonte:', [...distCpa.entries()].sort((a,b)=>(b[0]??-1)-(a[0]??-1)).map(([v,n])=>`${v}=${n}`).join(' '));
await prisma.$disconnect();

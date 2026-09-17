import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// READ-ONLY. Confirma todo downline superbet = referer DIRETO − 5.
const STEP = 5;
const all = await prisma.user.findMany({
  select: { id: true, name: true, email: true, referredById: true,
    affiliateLinks: { where: { bettingHouse: 'superbet' }, select: { cpa: true, revshare: true } } },
});
const byId = new Map(all.map(u => [u.id, u]));
const sbCpa = (u) => { const l = u?.affiliateLinks[0]; return l && l.cpa != null ? Number(l.cpa) : null; };
const sbRev = (u) => { const l = u?.affiliateLinks[0]; return l && l.revshare != null ? Number(l.revshare) : null; };

const mismatch = [], semRefCpa = []; let ok = 0; const revNot0 = [];
for (const u of all) {
  if (!u.referredById) continue;
  const cpa = sbCpa(u); if (cpa == null) continue;
  const rev = sbRev(u);
  const ref = byId.get(u.referredById);
  const refCpa = sbCpa(ref);
  if (refCpa == null) { semRefCpa.push({ email: u.email, cpa, refEmail: ref?.email }); continue; }
  const expected = Math.max(0, refCpa - STEP);
  if (cpa !== expected) mismatch.push({ email: u.email, cpa, refCpa, expected, refEmail: ref?.email });
  else ok++;
  if ((rev ?? 0) !== 0) revNot0.push({ email: u.email, rev });
}
console.log(`OK (= referer−5): ${ok}`);
console.log(`DIVERGENTES: ${mismatch.length}`);
for (const m of mismatch) console.log(`  ${m.email} cpa=${m.cpa} | referer ${m.refEmail} cpa=${m.refCpa} → esperado ${m.expected}`);
console.log(`REFERER SEM cpa superbet (não dá p/ −5): ${semRefCpa.length}`);
console.log(`rev != 0: ${revNot0.length}`);
await prisma.$disconnect();

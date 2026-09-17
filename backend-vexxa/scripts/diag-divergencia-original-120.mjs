import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// READ-ONLY. Divergência no SALDO: 120-cascata vs cpa ORIGINAL (audit), system-wide.
// Componente próprio: Δown = (cpaCascata − cpaOriginal) × cpaQualified_superbet (pós-cut).
// Componente rede: margem = head−l1; mede também sob os dois regimes.
const cut = new Date('2026-05-22T00:00:00.000Z');
const all = await prisma.user.findMany({
  select: { id: true, email: true, referredById: true,
    affiliateLinks: { where: { bettingHouse: 'superbet' }, select: { campaignId: true, cpa: true } } },
});
const byId = new Map(all.map(u => [u.id, u]));
const children = new Map();
for (const u of all) { if (!u.referredById) continue; if (!children.has(u.referredById)) children.set(u.referredById, []); children.get(u.referredById).push(u.id); }
const liveCpa = (u) => { const l = u.affiliateLinks[0]; return l && l.cpa != null ? Number(l.cpa) : null; };
const sbCamp = (u) => u.affiliateLinks[0]?.campaignId ?? null;

// audit original superbet
const auds = await prisma.auditLog.findMany({ where: { action: 'UPDATE_STATUS' }, select: { details: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
const auditCpa = new Map();
for (const a of auds) { const d = a.details; if (!d || d.bettingHouse !== 'superbet' || d.cpa == null || !d.targetUserId) continue; auditCpa.set(d.targetUserId, Number(d.cpa)); }

// cpaQualified superbet pós-cutover por campaign
const agg = await prisma.affiliateData.groupBy({ by: ['campaignId'], where: { bettingHouse: 'superbet', date: { gte: cut } }, _sum: { cpaQualified: true } });
const qByCamp = new Map();
for (const r of agg) qByCamp.set(r.campaignId, r._sum.cpaQualified ?? 0);

// mapas cpa: cascade(live) e original(audit se houver, senão live)
const cascade = new Map(), original = new Map();
for (const u of all) { const lv = liveCpa(u); cascade.set(u.id, lv); original.set(u.id, auditCpa.has(u.id) ? auditCpa.get(u.id) : lv); }

// ── Δ GANHO PRÓPRIO ──
let ownCascade = 0, ownOriginal = 0, usersComAudit = 0, usersComAuditEProd = 0;
const diffPairs = new Map();
for (const u of all) {
  const camp = sbCamp(u); if (!camp) continue;
  const q = qByCamp.get(camp) ?? 0;
  const c = cascade.get(u.id) ?? 0, o = original.get(u.id) ?? 0;
  ownCascade += c * q; ownOriginal += o * q;
  if (auditCpa.has(u.id)) { usersComAudit++; if (q > 0) usersComAuditEProd++; if (c !== o) diffPairs.set(`${o}→${c}`, (diffPairs.get(`${o}→${c}`) ?? 0) + 1); }
}

// ── Δ REDE (spread) — margem = head − l1 ancestral, sob cada regime ──
function netSystem(cpaMap) {
  let total = 0;
  for (const head of all) {
    const l1 = children.get(head.id) ?? []; if (!l1.length) continue;
    const hc = cpaMap.get(head.id) ?? 0; if (!hc) continue;
    const anc = new Map(); for (const id of l1) anc.set(id, cpaMap.get(id) ?? 0);
    let frontier = [...l1], lvl = 1; const seen = new Set([head.id, ...l1]);
    while (frontier.length && lvl <= 10) {
      for (const id of frontier) { const m = byId.get(id); const camp = sbCamp(m); if (!camp) continue; const q = qByCamp.get(camp) ?? 0; if (!q) continue; const margin = Math.max(0, hc - (anc.get(id) ?? 0)); total += margin * q; }
      const nx = []; for (const id of frontier) for (const c of (children.get(id) ?? [])) { if (seen.has(c)) continue; seen.add(c); anc.set(c, anc.get(id)); nx.push(c); } frontier = nx; lvl++;
    }
  }
  return total;
}
const netCascade = netSystem(cascade), netOriginal = netSystem(original);

console.log('=== COBERTURA ===');
console.log(`users c/ audit superbet: ${usersComAudit} | com produção pós-cut: ${usersComAuditEProd} | (audit cobre ~15% da base)`);
console.log('\n=== GANHO PRÓPRIO (superbet, pós-cutover) ===');
console.log(`  120-cascata: R$${ownCascade.toFixed(2)}`);
console.log(`  original:    R$${ownOriginal.toFixed(2)}`);
console.log(`  DIVERGÊNCIA own: R$${(ownCascade - ownOriginal).toFixed(2)} (120 paga a mais)`);
console.log('\n=== REDE/SPREAD (superbet, pós-cutover) ===');
console.log(`  120-cascata: R$${netCascade.toFixed(2)}`);
console.log(`  original:    R$${netOriginal.toFixed(2)}`);
console.log(`  DIVERGÊNCIA rede: R$${(netCascade - netOriginal).toFixed(2)}`);
console.log('\n=== TOTAL ===');
console.log(`  DIVERGÊNCIA total no saldo (own+rede): R$${((ownCascade+netCascade)-(ownOriginal+netOriginal)).toFixed(2)}`);
console.log('  (piso — só conta divergência onde há audit original)');
console.log('\n=== pares original→cascata (audit) ===');
console.log('  ' + [...diffPairs.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15).map(([k,n])=>`${k}:${n}`).join('  '));
await prisma.$disconnect();

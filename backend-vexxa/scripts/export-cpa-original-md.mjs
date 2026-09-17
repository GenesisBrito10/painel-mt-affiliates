import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { writeFileSync } from 'node:fs';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// READ-ONLY (escreve só 1 .md de relatório). Exporta cpa ORIGINAL (audit) de todos os
// users que têm registro, p/ verificação: atual vs original vs esperado (referer−5).
const OUT = '/Users/user/Documents/dashboard-afiliados/docs/cpa-original-audit-2026-05-24.md';
const STEP = 5;
const all = await prisma.user.findMany({
  select: { id: true, name: true, email: true, referredById: true,
    affiliateLinks: { where: { bettingHouse: 'superbet' }, select: { cpa: true } } },
});
const byId = new Map(all.map(u => [u.id, u]));
const liveCpa = (u) => { const l = u?.affiliateLinks[0]; return l && l.cpa != null ? Number(l.cpa) : null; };

const auds = await prisma.auditLog.findMany({ select: { action: true, details: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
const auditFirst = new Map();
for (const a of auds) { const d = a.details; if (!d || d.cpa == null || !d.targetUserId) continue; if (d.bettingHouse && d.bettingHouse !== 'superbet') continue; if (!auditFirst.has(d.targetUserId)) auditFirst.set(d.targetUserId, { cpa: Number(d.cpa), action: a.action, date: a.createdAt }); }

const rows = [];
for (const u of all) {
  const a = auditFirst.get(u.id); if (!a) continue;
  const ref = u.referredById ? byId.get(u.referredById) : null;
  const refCpa = ref ? liveCpa(ref) : null;
  const expected = refCpa != null ? Math.max(0, refCpa - STEP) : null;
  const cur = liveCpa(u);
  rows.push({
    email: u.email, nome: (u.name || '').replace(/\|/g, '/'), tipo: u.referredById ? 'downline' : 'ROOT',
    atual: cur, original: a.cpa, data: a.date.toISOString().slice(0, 10), acao: a.action.slice(0, 24),
    refEmail: ref?.email ?? '-', refCpaAtual: refCpa ?? '-', esperado: expected ?? '-',
    bate: (expected != null && a.cpa === expected) ? 'sim' : 'NAO',
  });
}
rows.sort((x, y) => (x.refEmail).localeCompare(y.refEmail) || x.email.localeCompare(y.email));

const igualAtual = rows.filter(r => r.atual === r.original).length;
const bateRef5 = rows.filter(r => r.bate === 'sim').length;
let md = `# CPA Original (Audit) — verificação\n\n`;
md += `**Gerado:** 2026-05-24 · **Fonte:** AuditLog (UPDATE_STATUS + edições) com cpa superbet\n\n`;
md += `Total com original no audit: **${rows.length}**\n\n`;
md += `- \`original == atual (cascata)\`: ${igualAtual}\n`;
md += `- \`original == referer_atual − 5\`: ${bateRef5}\n`;
md += `- \`original != referer−5 (stale tipo eullers)\`: ${rows.length - bateRef5}\n\n`;
md += `> **atual** = cpa em vigor (cascata −5). **original** = cpa do audit (aprovação). `;
md += `**esperado** = referer_atual − 5. **bate** = original confere com esperado.\n\n`;
md += `| email | nome | tipo | atual | original | data | ação | referer | ref_atual | esperado(−5) | bate |\n`;
md += `|---|---|---|---|---|---|---|---|---|---|---|\n`;
for (const r of rows) md += `| ${r.email} | ${r.nome} | ${r.tipo} | ${r.atual ?? '-'} | ${r.original} | ${r.data} | ${r.acao} | ${r.refEmail} | ${r.refCpaAtual} | ${r.esperado} | ${r.bate} |\n`;

writeFileSync(OUT, md);
console.log(`Arquivo gerado: ${OUT}`);
console.log(`linhas: ${rows.length} | original==atual: ${igualAtual} | original==referer−5: ${bateRef5}`);
await prisma.$disconnect();

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { writeFileSync } from 'node:fs';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// READ-ONLY (escreve 1 .md). Rede do Bruno sob RESTORE original (audit else atual).
const OUT = '/Users/user/Documents/dashboard-afiliados/docs/bruno-restore-original-2026-05-24.md';
const EMAIL = 'brunoeduardo26nicoly@gmail.com';
const all = await prisma.user.findMany({
  select: { id: true, name: true, email: true, referredById: true,
    affiliateLinks: { where: { bettingHouse: 'superbet' }, select: { cpa: true } } },
});
const byId = new Map(all.map(u => [u.id, u]));
const children = new Map();
for (const u of all) { if (!u.referredById) continue; if (!children.has(u.referredById)) children.set(u.referredById, []); children.get(u.referredById).push(u.id); }
const liveCpa = (u) => { const l = u?.affiliateLinks[0]; return l && l.cpa != null ? Number(l.cpa) : null; };
const bruno = all.find(u => u.email.toLowerCase() === EMAIL);

const auds = await prisma.auditLog.findMany({ select: { details: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
const auditFirst = new Map();
for (const a of auds) { const d = a.details; if (!d || d.cpa == null || !d.targetUserId) continue; if (d.bettingHouse && d.bettingHouse !== 'superbet') continue; if (!auditFirst.has(d.targetUserId)) auditFirst.set(d.targetUserId, Number(d.cpa)); }

const lvl = new Map(); let fr = [bruno.id]; let level = 0; const members = [];
while (fr.length) { level++; const nx = []; for (const id of fr) for (const c of (children.get(id) ?? [])) { if (lvl.has(c)) continue; lvl.set(c, level); members.push(c); nx.push(c); } fr = nx; }

const rows = [];
let comFonte = 0, semFonte = 0;
const distAtual = new Map(), distRestore = new Map();
for (const id of members) {
  const u = byId.get(id); const cur = liveCpa(u); if (cur == null) continue;
  const orig = auditFirst.has(id) ? auditFirst.get(id) : null;
  const target = orig != null ? orig : cur;
  if (orig != null) comFonte++; else semFonte++;
  distAtual.set(cur, (distAtual.get(cur) ?? 0) + 1);
  distRestore.set(target, (distRestore.get(target) ?? 0) + 1);
  rows.push({ email: u.email, nome: (u.name||'').replace(/\|/g,'/'), lvl: lvl.get(id), atual: cur, original: orig ?? 'sem-fonte', alvo: target, delta: target - cur });
}
rows.sort((a,b)=> a.lvl-b.lvl || a.email.localeCompare(b.email));

const fmt = (m) => [...m.entries()].sort((a,b)=>b[0]-a[0]).map(([v,n])=>`${v}=${n}`).join(' ');
let md = `# Rede do Bruno — RESTORE original (audit)\n\n`;
md += `**Bruno** ${bruno.email} cpa=${liveCpa(bruno)} (ROOT, sem audit → fica 120)\n\n`;
md += `Downline c/ link superbet: **${rows.length}** | com fonte audit: ${comFonte} | sem fonte (fica atual): ${semFonte}\n\n`;
md += `distrib **ATUAL** (cascata): ${fmt(distAtual)}\n\n`;
md += `distrib **RESTORE** (original/audit): ${fmt(distRestore)}\n\n`;
md += `> alvo = original do audit se houver, senão mantém atual. delta = alvo − atual.\n\n`;
md += `| email | nome | nível | atual | original | alvo_restore | delta |\n|---|---|---|---|---|---|---|\n`;
for (const r of rows) md += `| ${r.email} | ${r.nome} | ${r.lvl} | ${r.atual} | ${r.original} | ${r.alvo} | ${r.delta>0?'+':''}${r.delta} |\n`;
writeFileSync(OUT, md);
console.log(`Arquivo: ${OUT}`);
console.log(`downline superbet: ${rows.length} | com fonte: ${comFonte} | sem fonte: ${semFonte}`);
console.log(`distrib ATUAL:   ${fmt(distAtual)}`);
console.log(`distrib RESTORE: ${fmt(distRestore)}`);
await prisma.$disconnect();

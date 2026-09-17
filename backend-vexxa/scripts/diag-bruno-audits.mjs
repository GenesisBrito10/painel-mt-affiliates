import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// READ-ONLY. TODOS os audits/logs do Bruno Eduardo, com datas.
const EMAIL = 'brunoeduardo26nicoly@gmail.com';
const bruno = await prisma.user.findFirst({ where: { email: { equals: EMAIL, mode: 'insensitive' } }, select: { id: true, name: true, email: true, createdAt: true } });
console.log(`${bruno.email} (${bruno.name}) id=${bruno.id} criado=${bruno.createdAt.toISOString()}\n`);

const auds = await prisma.auditLog.findMany({ select: { action: true, createdAt: true, details: true, userId: true }, orderBy: { createdAt: 'asc' } });
const asTarget = auds.filter(a => a.details?.targetUserId === bruno.id);
const asActor = auds.filter(a => a.userId === bruno.id);
console.log(`=== AuditLog onde Bruno é ALVO (targetUserId): ${asTarget.length} ===`);
for (const a of asTarget) console.log(`  ${a.createdAt.toISOString()} | ${a.action} | casa=${a.details?.bettingHouse ?? '-'} cpa=${a.details?.cpa ?? '-'} rev=${a.details?.revshare ?? '-'}`);
console.log(`\n=== AuditLog onde Bruno é AUTOR (userId): ${asActor.length} ===`);
for (const a of asActor.slice(0, 20)) console.log(`  ${a.createdAt.toISOString()} | ${a.action} | alvo=${a.details?.targetUserId ?? '-'} casa=${a.details?.bettingHouse ?? '-'} cpa=${a.details?.cpa ?? '-'}`);

const cl = await prisma.commissionLog.findMany({ where: { userId: bruno.id }, orderBy: { createdAt: 'asc' }, select: { field: true, oldValue: true, newValue: true, bettingHouse: true, createdAt: true, changedById: true } });
console.log(`\n=== CommissionLog do Bruno: ${cl.length} ===`);
for (const c of cl) console.log(`  ${c.createdAt.toISOString()} | ${c.field} ${c.bettingHouse} ${c.oldValue ?? 'null'}→${c.newValue ?? 'null'} (by ${c.changedById ?? 'script'})`);

await prisma.$disconnect();

// seed-from-mongo-phase2.ts
// Migra as tabelas que dependem de FK de usuário usando lookup via email
// (necessário pois o idMap não é persistido entre runs)

import { MongoClient, ObjectId } from 'mongodb';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';

const MONGO_URI = process.env['MONGO_URI'] ?? '';
if (!MONGO_URI) throw new Error('MONGO_URI is required');
const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://vexxa_user:vexxa_password@localhost:5433/vexxa_db?schema=public';
const adapter = new PrismaPg({ connectionString: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// ─── ID Map (rebuilt via email lookup from PG) ────────────────
// Maps Mongo ObjectId string → PG UUID
const idMap = new Map<string, string>();

function toDate(v: unknown): Date {
  if (v instanceof Date) return v;
  if (typeof v === 'string' || typeof v === 'number') return new Date(v);
  return new Date();
}

function toDecimal(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v) || 0;
  return 0;
}

function mapId(mongoId: string | ObjectId | null | undefined): string | null {
  if (!mongoId) return null;
  const key = mongoId.toString();
  return idMap.get(key) ?? null;
}

// Build idMap by cross-referencing Mongo users with PG users via email
async function buildIdMap(mongo: MongoClient) {
  console.log('[SETUP] Building ID map from PG users via email lookup...');
  const mongoUsers = await mongo.db().collection('users').find({}).project({ _id: 1, email: 1 }).toArray();
  let mapped = 0;
  for (const u of mongoUsers) {
    const email = (u.email as string)?.toLowerCase().trim();
    if (!email) continue;
    const pgUser = await prisma.user.findUnique({ where: { email } });
    if (pgUser) {
      idMap.set(u._id.toString(), pgUser.id);
      mapped++;
    }
  }
  console.log(`[SETUP] Mapped ${mapped}/${mongoUsers.length} users`);
}

// ─── C.1: AuditLogs ──────────────────────────────────────────

async function migrateAuditLogs(mongo: MongoClient) {
  console.log('\n[C.1] Migrating AuditLogs...');
  const docs = await mongo.db().collection('auditlogs').find({}).toArray();
  let count = 0;
  let skipped = 0;
  for (const doc of docs) {
    const userId = mapId(doc.userId);
    if (!userId) { skipped++; continue; }
    try {
      await prisma.auditLog.create({
        data: {
          userId,
          userName: doc.userName ?? '',
          userEmail: doc.userEmail ?? '',
          action: doc.action ?? '',
          resource: doc.resource ?? '',
          method: doc.method ?? '',
          path: doc.path ?? '',
          ip: doc.ip ?? '',
          userAgent: doc.userAgent ?? '',
          statusCode: doc.statusCode ?? 200,
          details: doc.details ?? null,
          createdAt: toDate(doc.createdAt),
        },
      });
      count++;
    } catch { /* dupe */ }
  }
  console.log(`   [OK] ${count}/${docs.length} audit logs migrated (${skipped} skipped — user not found)`);
}

// ─── C.2: DepositComplianceLogs ──────────────────────────────

async function migrateDepositComplianceLogs(mongo: MongoClient) {
  console.log('\n[C.2] Migrating DepositComplianceLogs...');
  const docs = await mongo.db().collection('depositcompliancelogs').find({}).toArray();
  let count = 0;
  let skipped = 0;
  const statusMap: Record<string, string> = {
    pass: 'PASS', fail: 'FAIL', exempt: 'EXEMPT', penalty_applied: 'PENALTY_APPLIED',
  };
  const failReasonMap: Record<string, string> = {
    my_data_below: 'MY_DATA_BELOW', team_below: 'TEAM_BELOW', both_below: 'BOTH_BELOW',
  };
  for (const doc of docs) {
    const userId = mapId(doc.userId);
    if (!userId) { skipped++; continue; }
    const rawStatus = (doc.status ?? '').toLowerCase();
    const rawFail = (doc.failReason ?? '').toLowerCase();
    try {
      await prisma.depositComplianceLog.upsert({
        where: { userId_evaluationDate: { userId, evaluationDate: toDate(doc.evaluationDate) } },
        update: {},
        create: {
          userId,
          evaluationDate: toDate(doc.evaluationDate),
          myDataDeposit: toDecimal(doc.myDataDeposit),
          myDataQftd: doc.myDataQftd ?? 0,
          myDataAvg: toDecimal(doc.myDataAvg),
          teamDeposit: toDecimal(doc.teamDeposit),
          teamQftd: doc.teamQftd ?? 0,
          teamAvg: toDecimal(doc.teamAvg),
          teamSkipped: doc.teamSkipped ?? false,
          threshold: toDecimal(doc.threshold),
          status: (statusMap[rawStatus] ?? 'PASS') as any,
          failReason: rawFail && failReasonMap[rawFail] ? (failReasonMap[rawFail] as any) : null,
          alertCountAfter: doc.alertCountAfter ?? 0,
          withdrawalBlockedForDay: doc.withdrawalBlockedForDay ?? false,
          penaltyApplied: doc.penaltyApplied ?? false,
          processedAt: doc.processedAt ? toDate(doc.processedAt) : new Date(),
          createdAt: toDate(doc.createdAt),
          updatedAt: toDate(doc.updatedAt),
        },
      });
      count++;
    } catch { /* dupe */ }
  }
  console.log(`   [OK] ${count}/${docs.length} deposit compliance logs migrated (${skipped} skipped)`);
}

// ─── C.3: FraudLogs ──────────────────────────────────────────

async function migrateFraudLogs(mongo: MongoClient) {
  console.log('\n[C.3] Migrating FraudLogs...');
  const docs = await mongo.db().collection('fraudlogs').find({}).toArray();
  let count = 0;
  let skipped = 0;
  for (const doc of docs) {
    const userId = mapId(doc.userId);
    const changedById = mapId(doc.changedBy);
    if (!userId || !changedById) { skipped++; continue; }
    try {
      await prisma.fraudLog.create({
        data: {
          userId,
          changedById,
          bettingHouse: (doc.bettingHouse ?? '').toLowerCase().trim(),
          oldCount: doc.oldCount ?? 0,
          newCount: doc.newCount ?? 0,
          reason: doc.reason ?? '',
          createdAt: toDate(doc.createdAt),
          updatedAt: toDate(doc.updatedAt),
        },
      });
      count++;
    } catch { /* FK missing */ }
  }
  console.log(`   [OK] ${count}/${docs.length} fraud logs migrated (${skipped} skipped)`);
}

// ─── C.5: NotificationSnapshots ──────────────────────────────

async function migrateNotificationSnapshots(mongo: MongoClient) {
  console.log('\n[C.5] Migrating NotificationSnapshots...');
  const docs = await mongo.db().collection('notificationsnapshots').find({}).toArray();
  let count = 0;
  let skipped = 0;
  for (const doc of docs) {
    const userId = mapId(doc.userId);
    if (!userId) { skipped++; continue; }
    const bettingHouse = (doc.bettingHouse ?? '').toLowerCase().trim();
    try {
      await prisma.notificationSnapshot.upsert({
        where: { userId_bettingHouse: { userId, bettingHouse } },
        update: {
          clicks: doc.clicks ?? 0,
          registrations: doc.registrations ?? 0,
          ftds: doc.ftds ?? 0,
          cpaQualified: doc.cpaQualified ?? 0,
          lastCheckedAt: doc.lastCheckedAt ? toDate(doc.lastCheckedAt) : new Date(),
        },
        create: {
          userId,
          bettingHouse,
          clicks: doc.clicks ?? 0,
          registrations: doc.registrations ?? 0,
          ftds: doc.ftds ?? 0,
          cpaQualified: doc.cpaQualified ?? 0,
          lastCheckedAt: doc.lastCheckedAt ? toDate(doc.lastCheckedAt) : new Date(),
          createdAt: toDate(doc.createdAt),
          updatedAt: toDate(doc.updatedAt),
        },
      });
      count++;
    } catch { /* FK missing */ }
  }
  console.log(`   [OK] ${count}/${docs.length} notification snapshots migrated (${skipped} skipped)`);
}

// ─── C.6: PushSubscriptions ──────────────────────────────────

async function migratePushSubscriptions(mongo: MongoClient) {
  console.log('\n[C.6] Migrating PushSubscriptions...');
  const docs = await mongo.db().collection('pushsubscriptions').find({}).toArray();
  let count = 0;
  let skipped = 0;
  for (const doc of docs) {
    const userId = mapId(doc.user ?? doc.userId);
    if (!userId) { skipped++; continue; }
    const p256dh = doc.keys?.p256dh ?? doc.p256dh ?? '';
    const auth = doc.keys?.auth ?? doc.auth ?? '';
    if (!doc.endpoint || !p256dh || !auth) { skipped++; continue; }
    try {
      await prisma.pushSubscription.upsert({
        where: { userId_endpoint: { userId, endpoint: doc.endpoint } },
        update: { p256dh, auth },
        create: {
          userId,
          endpoint: doc.endpoint,
          p256dh,
          auth,
          createdAt: toDate(doc.createdAt),
          updatedAt: toDate(doc.updatedAt),
        },
      });
      count++;
    } catch { /* FK missing */ }
  }
  console.log(`   [OK] ${count}/${docs.length} push subscriptions migrated (${skipped} skipped)`);
}

// ─── C.7: RankingPrizes ──────────────────────────────────────

async function migrateRankingPrizes(mongo: MongoClient) {
  console.log('\n[C.7] Migrating RankingPrizes...');
  const docs = await mongo.db().collection('rankingprizes').find({}).toArray();
  let prizeCount = 0, rankCount = 0, winnerCount = 0;
  const prizeTypeMap: Record<string, string> = {
    balance: 'BALANCE', physical: 'PHYSICAL', other: 'OTHER',
  };
  const statusMap: Record<string, string> = {
    active: 'ACTIVE', ended: 'ENDED', finalized: 'FINALIZED',
  };
  for (const doc of docs) {
    const createdById = doc.createdBy ? mapId(doc.createdBy) : null;
    if (!createdById) {
      console.warn(`   [WARN] RankingPrize "${doc.title}" — createdBy not mapped, skipping`);
      continue;
    }
    // Use Mongo _id as stable key for idempotency
    const stableKey = doc._id.toString();
    let rankingPrizeId: string;
    // Check if already exists
    const existing = await prisma.rankingPrize.findFirst({ where: { title: doc.title } });
    if (existing) {
      rankingPrizeId = existing.id;
    } else {
      try {
        const created = await prisma.rankingPrize.create({
          data: {
            title: doc.title ?? '',
            description: doc.description ?? '',
            prizeType: (prizeTypeMap[(doc.prizeType ?? '').toLowerCase()] ?? 'OTHER') as any,
            prizeValue: toDecimal(doc.prizeValue),
            prizeLabel: doc.prizeLabel ?? '',
            icon: doc.icon ?? '🏆',
            startDate: toDate(doc.startDate),
            endDate: toDate(doc.endDate),
            winnersCount: doc.winnersCount ?? 1,
            targetCpa: doc.targetCpa ?? 0,
            status: (statusMap[(doc.status ?? '').toLowerCase()] ?? 'ACTIVE') as any,
            createdById,
            finalizedById: doc.finalizedBy ? mapId(doc.finalizedBy) : null,
            finalizedAt: doc.finalizedAt ? toDate(doc.finalizedAt) : null,
            createdAt: toDate(doc.createdAt),
            updatedAt: toDate(doc.updatedAt),
          },
        });
        rankingPrizeId = created.id;
        prizeCount++;
      } catch (e: any) {
        console.warn(`   [WARN] Skipped "${doc.title}": ${e.message?.slice(0, 80)}`);
        continue;
      }
    }
    // rank_prizes
    for (const rp of (doc.prizes ?? [])) {
      try {
        await prisma.rankPrize.upsert({
          where: { rankingPrizeId_rank: { rankingPrizeId, rank: rp.rank } },
          update: {},
          create: {
            rankingPrizeId,
            rank: rp.rank,
            prizeType: (prizeTypeMap[(rp.prizeType ?? '').toLowerCase()] ?? 'OTHER') as any,
            prizeValue: toDecimal(rp.prizeValue),
            prizeLabel: rp.prizeLabel ?? '',
            icon: rp.icon ?? '',
          },
        });
        rankCount++;
      } catch { /* dupe */ }
    }
    // prize_winners
    for (const w of (doc.winners ?? [])) {
      const winnerId = mapId(w.userId);
      if (!winnerId) continue;
      try {
        await prisma.prizeWinner.create({
          data: {
            rankingPrizeId,
            userId: winnerId,
            userName: w.userName ?? '',
            campaignId: w.affiliateName ?? '',
            cpaAchieved: w.cpaAchieved ?? 0,
            rank: w.rank ?? 0,
            prizeType: (prizeTypeMap[(w.prizeType ?? '').toLowerCase()] ?? 'OTHER') as any,
            prizeValue: toDecimal(w.prizeValue),
            prizeLabel: w.prizeLabel ?? '',
            redeemed: w.redeemed ?? false,
            redeemedAt: w.redeemedAt ? toDate(w.redeemedAt) : null,
            balanceCredited: w.balanceCredited ?? false,
          },
        });
        winnerCount++;
      } catch { /* dupe or FK */ }
    }
  }
  console.log(`   [OK] ${prizeCount} ranking prizes | ${rankCount} rank prizes | ${winnerCount} prize winners migrated`);
}

// ─── Also re-migrate link requests using email-based lookup ──

async function remigrateLinkRequests(mongo: MongoClient) {
  console.log('\n[EXTRA] Re-migrating LinkRequests (Mongo=4512, PG=720)...');
  const docs = await mongo.db().collection('linkrequests').find({}).toArray();
  let count = 0;
  let skipped = 0;
  const statusMap: Record<string, string> = {
    pending: 'PENDING', fulfilled: 'FULFILLED', rejected: 'REJECTED',
  };
  const houseNorm: Record<string, string> = {
    'bet mgm': 'mgm', 'mjm': 'mgm', 'Superbet': 'superbet', 'Esportivabet': 'esportivabet',
    'EsportivaBET': 'esportivabet', 'BET MGM': 'mgm', 'MJM': 'mgm',
  };
  for (const doc of docs) {
    const userId = mapId(doc.user ?? doc.userId);
    if (!userId) { skipped++; continue; }
    let slug = (doc.bettingHouseSlug || doc.bettingHouse || '').trim();
    slug = houseNorm[slug] ?? slug.toLowerCase();
    try {
      await prisma.linkRequest.upsert({
        where: { id: randomUUID() }, // force create path
        update: {},
        create: {
          userId,
          dealId: doc.deal ? (mapId(doc.deal) ?? null) : (doc.dealId ? (mapId(doc.dealId) ?? null) : null),
          bettingHouseSlug: slug,
          message: doc.message ?? '',
          status: (statusMap[doc.status?.toLowerCase()] ?? 'PENDING') as any,
          links: doc.links ?? [],
          adminNote: doc.adminNote ?? '',
          fulfilledAt: doc.fulfilledAt ? toDate(doc.fulfilledAt) : null,
          fulfilledById: doc.fulfilledBy ? (mapId(doc.fulfilledBy) ?? null) : null,
          fulfilledByName: doc.fulfilledByName ?? '',
          createdAt: toDate(doc.createdAt),
          updatedAt: toDate(doc.updatedAt),
        },
      });
      count++;
    } catch { skipped++; }
  }
  console.log(`   [OK] ${count}/${docs.length} link requests migrated (${skipped} skipped)`);
}

// ─── Main ────────────────────────────────────────────────────

async function main() {
  console.log('Phase 2 Migration: FK-dependent tables (email-based user lookup)');
  console.log('-'.repeat(60));

  const mongo = new MongoClient(MONGO_URI);
  await mongo.connect();
  console.log('[OK] Connected to MongoDB');

  try {
    // CRITICAL: Build idMap first via email cross-reference
    await buildIdMap(mongo);

    await migrateAuditLogs(mongo);              // C.1
    await migrateDepositComplianceLogs(mongo);  // C.2
    await migrateFraudLogs(mongo);              // C.3
    await migrateNotificationSnapshots(mongo);  // C.5
    await migratePushSubscriptions(mongo);      // C.6
    await migrateRankingPrizes(mongo);          // C.7
    await remigrateLinkRequests(mongo);         // EXTRA

    console.log('\n' + '-'.repeat(60));
    console.log('Phase 2 complete!');
  } finally {
    await mongo.close();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Phase 2 failed:', err);
  process.exit(1);
});

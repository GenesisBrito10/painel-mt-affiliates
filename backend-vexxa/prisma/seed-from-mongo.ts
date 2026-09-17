// Mongo → Postgres Migration Script
import { MongoClient, ObjectId } from 'mongodb';
import { PrismaClient, UserRole, UserStatus, SyncMode } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'crypto';

// ─── Config ──────────────────────────────────────────────────
const MONGO_URI = process.env['MONGO_URI'] ?? '';
if (!MONGO_URI) throw new Error('MONGO_URI is required');
const DATABASE_URL = process.env['DATABASE_URL'] ?? 'postgresql://vexxa_user:vexxa_password@localhost:5433/vexxa_db?schema=public';
const adapter = new PrismaPg({ connectionString: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// ObjectId → UUID mapping (maintains referential integrity across tables)
const idMap = new Map<string, string>();

function mapId(mongoId: string | ObjectId | null | undefined): string | null {
  if (!mongoId) return null;
  const key = mongoId.toString();
  if (!idMap.has(key)) {
    idMap.set(key, randomUUID());
  }
  return idMap.get(key)!;
}

function ensureId(mongoId: string | ObjectId): string {
  return mapId(mongoId)!;
}

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

function normalizeRole(r: string): UserRole {
  return r?.toUpperCase() === 'ADMIN' ? UserRole.ADMIN : UserRole.AFFILIATE;
}

function normalizeStatus(s: string): UserStatus {
  const map: Record<string, UserStatus> = {
    pending: UserStatus.PENDING,
    approved: UserStatus.APPROVED,
    rejected: UserStatus.REJECTED,
  };
  return map[s?.toLowerCase()] ?? UserStatus.PENDING;
}

function normalizeSyncMode(m: string): SyncMode {
  return m?.toUpperCase() === 'MANUAL' ? SyncMode.MANUAL : SyncMode.AUTO;
}

// ─── Migration Functions ─────────────────────────────────────

async function migrateSettings(mongo: MongoClient) {
  console.log('\n📋 Migrating Settings...');
  const docs = await mongo.db().collection('settings').find({}).toArray();
  let count = 0;
  for (const doc of docs) {
    await prisma.setting.upsert({
      where: { key: doc.key },
      update: { value: String(doc.value ?? ''), label: String(doc.label ?? '') },
      create: {
        key: doc.key,
        value: String(doc.value ?? ''),
        label: String(doc.label ?? ''),
      },
    });
    count++;
  }
  console.log(`   ✅ ${count} settings migrated`);
}

async function migrateBettingHouses(mongo: MongoClient) {
  console.log('\n🏠 Migrating BettingHouses...');
  const docs = await mongo.db().collection('bettinghouses').find({}).toArray();
  let count = 0;
  for (const doc of docs) {
    const id = ensureId(doc._id);
    await prisma.bettingHouse.upsert({
      where: { slug: doc.slug },
      update: {},
      create: {
        id,
        name: doc.name,
        slug: doc.slug.toLowerCase().trim(),
        apiBaseURL: doc.apiBaseURL ?? '',
        apiBasePath: doc.apiBasePath ?? '/api/v1',
        apiKey: doc.apiKey ?? '',
        active: doc.active ?? true,
        syncSchedule: doc.syncSchedule ?? '0 */2 * * *',
        syncMode: normalizeSyncMode(doc.syncMode ?? 'auto'),
        withdrawalDay: doc.withdrawalDay ?? null,
        lastSyncAt: doc.lastSyncAt ? toDate(doc.lastSyncAt) : null,
        createdAt: toDate(doc.createdAt),
        updatedAt: toDate(doc.updatedAt),
      },
    });
    count++;
  }
  console.log(`   ✅ ${count} betting houses migrated`);
}

async function migrateUsers(mongo: MongoClient) {
  console.log('\n👤 Migrating Users...');
  const docs = await mongo.db().collection('users').find({}).toArray();

  // First pass: create all users (without referredById — handle circular refs)
  let count = 0;
  for (const doc of docs) {
    const id = ensureId(doc._id);
    const pi = doc.paymentInfo ?? {};
    try {
      await prisma.user.create({
        data: {
          id,
          name: doc.name,
          email: doc.email.toLowerCase().trim(),
          password: doc.password, // Already bcrypt-hashed in Mongo
          role: normalizeRole(doc.role),
          status: normalizeStatus(doc.status),
          active: doc.active ?? true,
          ageVerified: doc.ageVerified ?? false,
          withdrawalBlocked: doc.withdrawalBlocked ?? false,
          bonusBalance: toDecimal(doc.bonusBalance),
          referralCode: doc.referralCode ?? null,
          pixKeyType: pi.pixKeyType ?? '',
          pixKey: pi.pixKey ?? '',
          bankName: pi.bankName ?? '',
          bankAgency: pi.bankAgency ?? '',
          bankAccount: pi.bankAccount ?? '',
          accountHolder: pi.accountHolder ?? '',
          depositComplianceAlertCount: doc.depositComplianceAlertCount ?? 0,
          depositCompliancePenalizedAt: doc.depositCompliancePenalizedAt ? toDate(doc.depositCompliancePenalizedAt) : null,
          createdAt: toDate(doc.createdAt),
          updatedAt: toDate(doc.updatedAt),
        },
      });
      count++;
    } catch (e: any) {
      console.warn(`   ⚠️ Skipped user ${doc.email}: ${e.message?.slice(0, 80)}`);
    }
  }
  console.log(`   ✅ ${count}/${docs.length} users created`);

  // Second pass: set referredBy
  let refCount = 0;
  for (const doc of docs) {
    if (doc.referredBy) {
      const userId = ensureId(doc._id);
      const referrerId = mapId(doc.referredBy);
      if (referrerId) {
        try {
          await prisma.user.update({
            where: { id: userId },
            data: { referredById: referrerId },
          });
          refCount++;
        } catch { /* referrer may not exist */ }
      }
    }
  }
  console.log(`   ✅ ${refCount} referral links set`);

  // Third pass: affiliate links (embedded → separate table)
  let linkCount = 0;
  for (const doc of docs) {
    if (!doc.affiliateLinks?.length) continue;
    const userId = ensureId(doc._id);
    for (const link of doc.affiliateLinks) {
      const house = (link.bettingHouse ?? '').toLowerCase().trim();
      // In Mongo, affiliateName is used as campaignId equivalent
      const campaignId = (link.affiliateName || link.affiliateId || `legacy_${house}_${userId.slice(0, 8)}`).trim();
      if (!campaignId || !house) continue;
      try {
        await prisma.affiliateLink.create({
          data: {
            userId,
            bettingHouse: house,
            affiliateId: link.affiliateId ?? '',
            campaignId,
            cpa: link.cpa != null ? toDecimal(link.cpa) : null,
            revshare: link.revshare != null ? toDecimal(link.revshare) : null,
          },
        });
        linkCount++;
      } catch (e: any) {
        console.warn(`   ⚠️ Skipped link ${campaignId}@${house}: ${e.message?.slice(0, 80)}`);
      }
    }
  }
  console.log(`   ✅ ${linkCount} affiliate links migrated`);

  // Fourth pass: fraud counts (embedded → separate table)
  let fraudCount = 0;
  for (const doc of docs) {
    if (!doc.fraudCounts?.length) continue;
    const userId = ensureId(doc._id);
    for (const fc of doc.fraudCounts) {
      try {
        await prisma.fraudCount.create({
          data: {
            userId,
            bettingHouse: (fc.bettingHouse ?? '').toLowerCase().trim(),
            count: fc.count ?? 0,
            updatedById: fc.updatedBy ? mapId(fc.updatedBy) : null,
          },
        });
        fraudCount++;
      } catch { /* duplicate or missing FK */ }
    }
  }
  console.log(`   ✅ ${fraudCount} fraud counts migrated`);
}

async function migrateDeals(mongo: MongoClient) {
  console.log('\n🤝 Migrating Deals...');
  const docs = await mongo.db().collection('deals').find({}).toArray();
  let count = 0;
  for (const doc of docs) {
    const id = ensureId(doc._id);
    const slug = (doc.bettingHouseSlug ?? '').toLowerCase().trim();
    // Verify house exists
    const house = await prisma.bettingHouse.findUnique({ where: { slug } });
    if (!house) {
      console.warn(`   ⚠️ Skipped deal "${doc.name}" — house "${slug}" not found`);
      continue;
    }
    try {
      await prisma.deal.create({
        data: {
          id,
          bettingHouseSlug: slug,
          name: doc.name,
          cpa: toDecimal(doc.cpa),
          revshare: toDecimal(doc.revshare),
          baseline: toDecimal(doc.baseline),
          exclusive: doc.exclusive ?? false,
          featured: doc.featured ?? false,
          newArrival: doc.newArrival ?? false,
          sortOrder: doc.sortOrder ?? 0,
          paymentCpaLabel: doc.paymentCpaLabel ?? '',
          paymentRevshareLabel: doc.paymentRevshareLabel ?? '',
          revenueType: doc.revenueType ?? '',
          revNegativeAccumulates: doc.revNegativeAccumulates ?? false,
          revNegativeOffsetsCpa: doc.revNegativeOffsetsCpa ?? false,
          withdrawalIndicators: doc.withdrawalIndicators ?? [],
          trafficSources: doc.trafficSources ?? [],
          conditionsText: doc.conditionsText ?? '',
          paymentNotes: doc.paymentNotes ?? '',
          logoUrl: doc.logoUrl ?? '',
          active: doc.active ?? true,
          legacyKey: doc.legacyKey ?? null,
          createdAt: toDate(doc.createdAt),
          updatedAt: toDate(doc.updatedAt),
        },
      });
      count++;
    } catch (e: any) {
      console.warn(`   ⚠️ Skipped deal "${doc.name}": ${e.message?.slice(0, 80)}`);
    }
  }
  console.log(`   ✅ ${count}/${docs.length} deals migrated`);
}

async function migrateAffiliateData(mongo: MongoClient) {
  console.log('\n📊 Migrating AffiliateData...');
  const docs = await mongo.db().collection('affiliatedatas').find({}).toArray();
  let count = 0;
  let skipped = 0;
  for (const doc of docs) {
    // AUDIT FIX: In MongoDB, affiliateName IS the campaignId (the unique affiliate identifier per house)
    // campaignId field did NOT exist in Mongo — affiliateName was the real key
    const campaignId = (doc.affiliateName || doc.campaignId || '').trim();
    const bettingHouse = (doc.bettingHouse ?? '').toLowerCase().trim();
    const campaignName = doc.campaignName ?? 'default';
    const utmCampaign = doc.utmCampaign ?? '';
    const date = toDate(doc.date);
    if (!campaignId || !bettingHouse) { skipped++; continue; }
    try {
      await prisma.affiliateData.upsert({
        where: {
          uq_affiliate_data: { campaignId, bettingHouse, date, campaignName, utmCampaign },
        },
        update: {
          clicks: doc.clicks ?? 0,
          registrations: doc.registrations ?? 0,
          ftds: doc.ftds ?? 0,
          qftd: doc.qftd ?? 0,
          deposit: toDecimal(doc.deposit),
          revShare: toDecimal(doc.revShare ?? doc.revshare),
          cpaQualified: doc.cpaQualified ?? 0,
          cpaValue: toDecimal(doc.cpaValue),
          totalCommission: toDecimal(doc.totalCommission),
          lastSyncAt: doc.lastSyncAt ? toDate(doc.lastSyncAt) : new Date(),
          updatedAt: toDate(doc.updatedAt),
        },
        create: {
          // AUDIT FIX: affiliateName → affiliateId (= the providor's affiliate identifier)
          affiliateId: (doc.affiliateName || doc.affiliateId || '').trim(),
          campaignId,
          bettingHouse,
          campaignName,
          utmCampaign,
          date,
          clicks: doc.clicks ?? 0,
          registrations: doc.registrations ?? 0,
          ftds: doc.ftds ?? 0,
          qftd: doc.qftd ?? 0,
          deposit: toDecimal(doc.deposit),
          revShare: toDecimal(doc.revShare ?? doc.revshare),
          cpaQualified: doc.cpaQualified ?? 0,
          cpaValue: toDecimal(doc.cpaValue),
          totalCommission: toDecimal(doc.totalCommission),
          source: doc.source ?? 'otg-api',
          lastSyncAt: doc.lastSyncAt ? toDate(doc.lastSyncAt) : new Date(),
          createdAt: toDate(doc.createdAt),
          updatedAt: toDate(doc.updatedAt),
        },
      });
      count++;
    } catch {
      skipped++;
    }
  }
  console.log(`   ✅ ${count} affiliate data rows migrated (${skipped} skipped — missing key fields)`);
}


async function migrateNotifications(mongo: MongoClient) {
  console.log('\n🔔 Migrating Notifications...');
  const docs = await mongo.db().collection('notifications').find({}).toArray();
  let count = 0;
  for (const doc of docs) {
    const userId = mapId(doc.userId);
    if (!userId) continue;
    const typeMap: Record<string, string> = {
      registration: 'REGISTRATION',
      commission_change: 'COMMISSION_CHANGE',
      withdrawal_approved: 'WITHDRAWAL_APPROVED',
      status_change: 'STATUS_CHANGE',
    };
    try {
      await prisma.notification.create({
        data: {
          userId,
          type: (typeMap[doc.type?.toLowerCase()] ?? 'GENERAL') as any,
          title: doc.title ?? '',
          message: doc.message ?? '',
          read: doc.read ?? false,
          metadata: doc.metadata ?? null,
          createdAt: toDate(doc.createdAt),
          updatedAt: toDate(doc.updatedAt),
        },
      });
      count++;
    } catch { /* FK missing */ }
  }
  console.log(`   ✅ ${count}/${docs.length} notifications migrated`);
}

async function migrateWithdrawals(mongo: MongoClient) {
  console.log('\n💰 Migrating WithdrawalRequests...');
  const docs = await mongo.db().collection('withdrawalrequests').find({}).toArray();
  let count = 0;
  let skipped = 0;
  for (const doc of docs) {
    // Mongo uses 'user' field (ObjectId ref), not 'userId'
    const userId = mapId(doc.user ?? doc.userId);
    if (!userId) { skipped++; continue; }
    const statusMap: Record<string, string> = {
      pending: 'PENDING', approved: 'APPROVED', rejected: 'REJECTED',
    };
    try {
      await prisma.withdrawalRequest.create({
        data: {
          id: ensureId(doc._id),
          userId,
          amount: toDecimal(doc.amount),
          originalAmount: toDecimal(doc.originalAmount ?? doc.amount),
          withdrawalFee: toDecimal(doc.withdrawalFee),
          bettingHouse: (doc.bettingHouse ?? 'unknown').toLowerCase().trim(),
          pixKeyType: doc.pixKeyType ?? '',
          pixKey: doc.pixKey ?? '',
          bankName: doc.bankName ?? '',
          bankAgency: doc.bankAgency ?? '',
          bankAccount: doc.bankAccount ?? '',
          accountHolder: doc.accountHolder ?? '',
          status: (statusMap[doc.status?.toLowerCase()] ?? 'PENDING') as any,
          adminNote: doc.adminNote ?? '',
          approvedAt: doc.approvedAt ? toDate(doc.approvedAt) : null,
          approvedById: doc.approvedBy ? mapId(doc.approvedBy) : null,
          createdAt: toDate(doc.createdAt),
          updatedAt: toDate(doc.updatedAt),
        },
      });
      count++;
    } catch (e: any) {
      skipped++;
    }
  }
  console.log(`   ✅ ${count}/${docs.length} withdrawals migrated (${skipped} skipped)`);
}

async function migrateCommissionLogs(mongo: MongoClient) {
  console.log('\n📝 Migrating CommissionLogs...');
  const docs = await mongo.db().collection('commissionlogs').find({}).toArray();
  let count = 0;
  for (const doc of docs) {
    const userId = mapId(doc.userId);
    try {
      await prisma.commissionLog.create({
        data: {
          userId,
          userName: doc.userName ?? '',
          userEmail: doc.userEmail ?? '',
          changedById: doc.changedById ? mapId(doc.changedById) : null,
          bettingHouse: (doc.bettingHouse ?? '').toLowerCase().trim(),
          field: doc.field ?? 'cpa',
          oldValue: doc.oldValue != null ? toDecimal(doc.oldValue) : null,
          newValue: doc.newValue != null ? toDecimal(doc.newValue) : null,
          createdAt: toDate(doc.createdAt),
          updatedAt: toDate(doc.updatedAt),
        },
      });
      count++;
    } catch { /* FK missing */ }
  }
  console.log(`   ✅ ${count}/${docs.length} commission logs migrated`);
}

async function migrateLinkRequests(mongo: MongoClient) {
  console.log('\n🔗 Migrating LinkRequests...');
  const docs = await mongo.db().collection('linkrequests').find({}).toArray();
  let count = 0;
  let skipped = 0;
  for (const doc of docs) {
    // Mongo uses 'user' field (ObjectId ref), not 'userId'
    const userId = mapId(doc.user ?? doc.userId);
    if (!userId) { skipped++; continue; }
    const statusMap: Record<string, string> = {
      pending: 'PENDING', fulfilled: 'FULFILLED', rejected: 'REJECTED',
    };
    try {
      await prisma.linkRequest.create({
        data: {
          id: ensureId(doc._id),
          userId,
          dealId: doc.deal ? mapId(doc.deal) : (doc.dealId ? mapId(doc.dealId) : null),
          bettingHouseSlug: (doc.bettingHouseSlug ?? doc.bettingHouse ?? '').toLowerCase().trim(),
          message: doc.message ?? '',
          status: (statusMap[doc.status?.toLowerCase()] ?? 'PENDING') as any,
          links: doc.links ?? [],
          adminNote: doc.adminNote ?? '',
          fulfilledAt: doc.fulfilledAt ? toDate(doc.fulfilledAt) : null,
          fulfilledById: doc.fulfilledBy ? mapId(doc.fulfilledBy) : (doc.fulfilledById ? mapId(doc.fulfilledById) : null),
          fulfilledByName: doc.fulfilledByName ?? '',
          createdAt: toDate(doc.createdAt),
          updatedAt: toDate(doc.updatedAt),
        },
      });
      count++;
    } catch (e: any) {
      skipped++;
    }
  }
  console.log(`   ✅ ${count}/${docs.length} link requests migrated (${skipped} skipped)`);
}


// ─── New Migration Functions ─────────────────────────────────────────────────
// C.1 – AuditLogs (5.856 docs)

async function migrateAuditLogs(mongo: MongoClient) {
  console.log('\n[C.1] Migrating AuditLogs...');
  const docs = await mongo.db().collection('auditlogs').find({}).toArray();
  let count = 0;
  for (const doc of docs) {
    const userId = mapId(doc.userId);
    if (!userId) continue;
    try {
      await prisma.auditLog.create({
        data: {
          id: ensureId(doc._id),
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
    } catch { /* FK missing or dupe */ }
  }
  console.log(`   [OK] ${count}/${docs.length} audit logs migrated`);
}

// C.2 – DepositComplianceLogs (3.446 docs)

async function migrateDepositComplianceLogs(mongo: MongoClient) {
  console.log('\n[C.2] Migrating DepositComplianceLogs...');
  const docs = await mongo.db().collection('depositcompliancelogs').find({}).toArray();
  let count = 0;
  const statusMap: Record<string, string> = {
    pass: 'PASS',
    fail: 'FAIL',
    exempt: 'EXEMPT',
    penalty_applied: 'PENALTY_APPLIED',
  };
  const failReasonMap: Record<string, string> = {
    my_data_below: 'MY_DATA_BELOW',
    team_below: 'TEAM_BELOW',
    both_below: 'BOTH_BELOW',
  };
  for (const doc of docs) {
    const userId = mapId(doc.userId);
    if (!userId) continue;
    const rawStatus = (doc.status ?? '').toLowerCase();
    const rawFail = (doc.failReason ?? '').toLowerCase();
    try {
      await prisma.depositComplianceLog.upsert({
        where: { userId_evaluationDate: { userId, evaluationDate: toDate(doc.evaluationDate) } },
        update: {},
        create: {
          id: ensureId(doc._id),
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
    } catch { /* dupe or FK */ }
  }
  console.log(`   [OK] ${count}/${docs.length} deposit compliance logs migrated`);
}

// C.3 – FraudLogs (188 docs)

async function migrateFraudLogs(mongo: MongoClient) {
  console.log('\n[C.3] Migrating FraudLogs...');
  const docs = await mongo.db().collection('fraudlogs').find({}).toArray();
  let count = 0;
  for (const doc of docs) {
    const userId = mapId(doc.userId);
    const changedById = mapId(doc.changedBy);
    if (!userId || !changedById) continue;
    try {
      await prisma.fraudLog.create({
        data: {
          id: ensureId(doc._id),
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
  console.log(`   [OK] ${count}/${docs.length} fraud logs migrated`);
}

// C.4 – SyncLogs (1.115 docs) — flatten periodo.inicio/fim → periodStart/periodEnd
//                              — flatten stats.totalRecords → totalRecords, etc.

async function migrateSyncLogs(mongo: MongoClient) {
  console.log('\n[C.4] Migrating SyncLogs...');
  const docs = await mongo.db().collection('synclogs').find({}).toArray();
  let count = 0;
  const statusMap: Record<string, string> = {
    running: 'RUNNING',
    success: 'SUCCESS',
    error: 'ERROR',
  };
  for (const doc of docs) {
    const house = (doc.bettingHouse ?? '').toLowerCase().trim();
    // SyncLog has a real FK → BettingHouse (unlike other tables)
    const houseExists = await prisma.bettingHouse.findUnique({ where: { slug: house } });
    if (!houseExists) continue;
    try {
      await prisma.syncLog.create({
        data: {
          id: ensureId(doc._id),
          bettingHouse: house,
          startTime: doc.startTime ? toDate(doc.startTime) : toDate(doc.createdAt),
          endTime: doc.endTime ? toDate(doc.endTime) : null,
          status: (statusMap[(doc.status ?? '').toLowerCase()] ?? 'SUCCESS') as any,
          triggeredBy: doc.triggeredBy ?? 'cron',
          // Flatten: Mongo nested periodo → flat fields
          periodStart: doc.periodo?.inicio ? toDate(doc.periodo.inicio) : null,
          periodEnd: doc.periodo?.fim ? toDate(doc.periodo.fim) : null,
          // Flatten: Mongo nested stats → flat fields
          totalRecords: doc.stats?.totalRecords ?? 0,
          inserted: doc.stats?.inserted ?? 0,
          updated: doc.stats?.updated ?? 0,
          errors: doc.stats?.errors ?? 0,
          errorMessage: doc.errorMessage ?? null,
          createdAt: toDate(doc.createdAt),
        },
      });
      count++;
    } catch { /* FK or dupe */ }
  }
  console.log(`   [OK] ${count}/${docs.length} sync logs migrated`);
}

// C.5 – NotificationSnapshots (1.859 docs)

async function migrateNotificationSnapshots(mongo: MongoClient) {
  console.log('\n[C.5] Migrating NotificationSnapshots...');
  const docs = await mongo.db().collection('notificationsnapshots').find({}).toArray();
  let count = 0;
  for (const doc of docs) {
    const userId = mapId(doc.userId);
    if (!userId) continue;
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
          id: ensureId(doc._id),
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
  console.log(`   [OK] ${count}/${docs.length} notification snapshots migrated`);
}

// C.6 – PushSubscriptions (136 docs) — flatten keys.p256dh / keys.auth → flat fields

async function migratePushSubscriptions(mongo: MongoClient) {
  console.log('\n[C.6] Migrating PushSubscriptions...');
  const docs = await mongo.db().collection('pushsubscriptions').find({}).toArray();
  let count = 0;
  for (const doc of docs) {
    // Mongo uses 'user' field (ObjectId ref), not 'userId'
    const userId = mapId(doc.user ?? doc.userId);
    if (!userId) continue;
    // Flatten: Mongo nested keys → flat fields
    const p256dh = doc.keys?.p256dh ?? doc.p256dh ?? '';
    const auth = doc.keys?.auth ?? doc.auth ?? '';
    if (!doc.endpoint || !p256dh || !auth) continue;
    try {
      await prisma.pushSubscription.upsert({
        where: { userId_endpoint: { userId, endpoint: doc.endpoint } },
        update: { p256dh, auth },
        create: {
          id: ensureId(doc._id),
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
  console.log(`   [OK] ${count}/${docs.length} push subscriptions migrated`);
}

// C.7 – RankingPrizes (5 docs) → 3 tables: ranking_prizes + rank_prizes + prize_winners
//       Mongo has embedded arrays prizes[] and winners[] that become separate rows.
//       NOTE: affiliateName in Mongo winners = campaignId in PG (same convention)

async function migrateRankingPrizes(mongo: MongoClient) {
  console.log('\n[C.7] Migrating RankingPrizes...');
  const docs = await mongo.db().collection('rankingprizes').find({}).toArray();
  let prizeCount = 0;
  let rankCount = 0;
  let winnerCount = 0;
  const prizeTypeMap: Record<string, string> = {
    balance: 'BALANCE',
    physical: 'PHYSICAL',
    other: 'OTHER',
  };
  const statusMap: Record<string, string> = {
    active: 'ACTIVE',
    ended: 'ENDED',
    finalized: 'FINALIZED',
  };
  for (const doc of docs) {
    const id = ensureId(doc._id);
    const createdById = doc.createdBy ? mapId(doc.createdBy) : null;
    if (!createdById) {
      console.warn(`   [WARN] RankingPrize "${doc.title}" — createdBy missing, skipping`);
      continue;
    }
    const userExists = await prisma.user.findUnique({ where: { id: createdById } });
    if (!userExists) continue;

    // 1. Create the main ranking_prizes row
    try {
      await prisma.rankingPrize.upsert({
        where: { id },
        update: {},
        create: {
          id,
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
      prizeCount++;
    } catch (e: any) {
      console.warn(`   [WARN] Skipped RankingPrize "${doc.title}": ${e.message?.slice(0, 80)}`);
      continue;
    }

    // 2. Migrate embedded prizes[] → rank_prizes table
    for (const rp of (doc.prizes ?? [])) {
      try {
        await prisma.rankPrize.upsert({
          where: { rankingPrizeId_rank: { rankingPrizeId: id, rank: rp.rank } },
          update: {},
          create: {
            rankingPrizeId: id,
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

    // 3. Migrate embedded winners[] → prize_winners table
    for (const w of (doc.winners ?? [])) {
      const winnerId = mapId(w.userId);
      if (!winnerId) continue;
      const winnerExists = await prisma.user.findUnique({ where: { id: winnerId } });
      if (!winnerExists) continue;
      try {
        await prisma.prizeWinner.create({
          data: {
            rankingPrizeId: id,
            userId: winnerId,
            userName: w.userName ?? '',
            campaignId: w.affiliateName ?? '', // affiliateName in Mongo = campaignId in PG
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

// ─── Main ────────────────────────────────────────────────────

async function main() {
  console.log('Starting MongoDB -> PostgreSQL migration');
  console.log('   MongoDB: mjmcompany @ 104.234.186.24');
  console.log('   Postgres: vexxa_db @ localhost:5433');
  console.log('-'.repeat(60));

  const mongo = new MongoClient(MONGO_URI);
  await mongo.connect();
  console.log('[OK] Connected to MongoDB');

  // List collections for reference
  const collections = await mongo.db().listCollections().toArray();
  console.log(`Collections found: ${collections.map((c: any) => c.name).join(', ')}`);

  try {
    // Order matters! Dependencies first.
    await migrateSettings(mongo);       // no FKs
    await migrateBettingHouses(mongo);  // no FKs
    await migrateUsers(mongo);          // includes AffiliateLink, FraudCount (embedded)
    await migrateDeals(mongo);          // FK -> BettingHouse
    await migrateAffiliateData(mongo);  // standalone analytics
    await migrateNotifications(mongo);  // FK -> User
    await migrateWithdrawals(mongo);    // FK -> User
    await migrateCommissionLogs(mongo); // FK -> User (nullable)
    await migrateLinkRequests(mongo);   // FK -> User, Deal
    // ── NEW TABLES ──────────────────────────────────────────
    await migrateAuditLogs(mongo);               // C.1: 5.856 docs
    await migrateDepositComplianceLogs(mongo);   // C.2: 3.446 docs
    await migrateFraudLogs(mongo);               // C.3: 188 docs
    await migrateSyncLogs(mongo);                // C.4: 1.115 docs (flatten periodo + stats)
    await migrateNotificationSnapshots(mongo);   // C.5: 1.859 docs
    await migratePushSubscriptions(mongo);       // C.6: 136 docs (flatten keys)
    await migrateRankingPrizes(mongo);           // C.7: 5 docs -> 3 tables

    console.log('\n' + '-'.repeat(60));
    console.log('Migration complete!');
    console.log(`   ID mappings created: ${idMap.size}`);
  } finally {
    await mongo.close();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});

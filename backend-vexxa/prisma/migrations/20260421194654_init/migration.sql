-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('AFFILIATE', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LinkRequestStatus" AS ENUM ('PENDING', 'FULFILLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SyncMode" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "SyncLogStatus" AS ENUM ('RUNNING', 'SUCCESS', 'ERROR');

-- CreateEnum
CREATE TYPE "PrizeStatus" AS ENUM ('ACTIVE', 'ENDED', 'FINALIZED');

-- CreateEnum
CREATE TYPE "PrizeType" AS ENUM ('BALANCE', 'PHYSICAL', 'OTHER');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('REGISTRATION', 'COMMISSION_CHANGE', 'WITHDRAWAL_APPROVED', 'STATUS_CHANGE', 'GENERAL');

-- CreateEnum
CREATE TYPE "DepositComplianceStatus" AS ENUM ('PASS', 'FAIL', 'EXEMPT', 'PENALTY_APPLIED');

-- CreateEnum
CREATE TYPE "DepositComplianceFailReason" AS ENUM ('MY_DATA_BELOW', 'TEAM_BELOW', 'BOTH_BELOW');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'AFFILIATE',
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "ageVerified" BOOLEAN NOT NULL DEFAULT false,
    "withdrawalBlocked" BOOLEAN NOT NULL DEFAULT false,
    "bonusBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "referralCode" TEXT,
    "referredById" TEXT,
    "pixKeyType" TEXT NOT NULL DEFAULT '',
    "pixKey" TEXT NOT NULL DEFAULT '',
    "bankName" TEXT NOT NULL DEFAULT '',
    "bankAgency" TEXT NOT NULL DEFAULT '',
    "bankAccount" TEXT NOT NULL DEFAULT '',
    "accountHolder" TEXT NOT NULL DEFAULT '',
    "depositComplianceAlertCount" INTEGER NOT NULL DEFAULT 0,
    "depositCompliancePenalizedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_links" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bettingHouse" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL DEFAULT '',
    "campaignId" TEXT NOT NULL,
    "cpa" DECIMAL(10,4),
    "revshare" DECIMAL(10,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_counts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bettingHouse" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fraud_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_data" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL DEFAULT '',
    "campaignId" TEXT NOT NULL,
    "bettingHouse" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL DEFAULT 'default',
    "utmCampaign" TEXT NOT NULL DEFAULT '',
    "date" DATE NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "registrations" INTEGER NOT NULL DEFAULT 0,
    "ftds" INTEGER NOT NULL DEFAULT 0,
    "qftd" INTEGER NOT NULL DEFAULT 0,
    "deposit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "revShare" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cpaQualified" INTEGER NOT NULL DEFAULT 0,
    "cpaValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalCommission" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'otg-api',
    "lastSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "betting_houses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "apiBaseURL" TEXT NOT NULL DEFAULT '',
    "apiBasePath" TEXT NOT NULL DEFAULT '/api/v1',
    "apiKey" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "syncSchedule" TEXT NOT NULL DEFAULT '0 */2 * * *',
    "syncMode" "SyncMode" NOT NULL DEFAULT 'AUTO',
    "withdrawalDay" INTEGER,
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "betting_houses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" TEXT NOT NULL,
    "bettingHouseSlug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cpa" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "revshare" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "baseline" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "exclusive" BOOLEAN NOT NULL DEFAULT false,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "newArrival" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "paymentCpaLabel" TEXT NOT NULL DEFAULT '',
    "paymentRevshareLabel" TEXT NOT NULL DEFAULT '',
    "revenueType" TEXT NOT NULL DEFAULT '',
    "revNegativeAccumulates" BOOLEAN NOT NULL DEFAULT false,
    "revNegativeOffsetsCpa" BOOLEAN NOT NULL DEFAULT false,
    "withdrawalIndicators" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "trafficSources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "conditionsText" TEXT NOT NULL DEFAULT '',
    "paymentNotes" TEXT NOT NULL DEFAULT '',
    "logoUrl" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "legacyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawal_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "originalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "withdrawalFee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "bettingHouse" TEXT NOT NULL,
    "pixKeyType" TEXT NOT NULL,
    "pixKey" TEXT NOT NULL,
    "bankName" TEXT NOT NULL DEFAULT '',
    "bankAgency" TEXT NOT NULL DEFAULT '',
    "bankAccount" TEXT NOT NULL DEFAULT '',
    "accountHolder" TEXT NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "adminNote" TEXT NOT NULL DEFAULT '',
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "withdrawal_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "link_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dealId" TEXT,
    "bettingHouseSlug" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "status" "LinkRequestStatus" NOT NULL DEFAULT 'PENDING',
    "links" JSONB NOT NULL DEFAULT '[]',
    "adminNote" TEXT NOT NULL DEFAULT '',
    "fulfilledAt" TIMESTAMP(3),
    "fulfilledById" TEXT,
    "fulfilledByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "link_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "changedById" TEXT,
    "bettingHouse" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" DECIMAL(10,4),
    "newValue" DECIMAL(10,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ranking_prizes" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "prizeType" "PrizeType" NOT NULL DEFAULT 'OTHER',
    "prizeValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "prizeLabel" TEXT NOT NULL DEFAULT '',
    "icon" TEXT NOT NULL DEFAULT '🏆',
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "winnersCount" INTEGER NOT NULL DEFAULT 1,
    "targetCpa" INTEGER NOT NULL DEFAULT 0,
    "status" "PrizeStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "finalizedById" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ranking_prizes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rank_prizes" (
    "id" TEXT NOT NULL,
    "rankingPrizeId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "prizeType" "PrizeType" NOT NULL,
    "prizeValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "prizeLabel" TEXT NOT NULL DEFAULT '',
    "icon" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rank_prizes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prize_winners" (
    "id" TEXT NOT NULL,
    "rankingPrizeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "cpaAchieved" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "prizeType" "PrizeType" NOT NULL DEFAULT 'OTHER',
    "prizeValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "prizeLabel" TEXT NOT NULL DEFAULT '',
    "redeemed" BOOLEAN NOT NULL DEFAULT false,
    "redeemedAt" TIMESTAMP(3),
    "balanceCredited" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prize_winners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "ip" TEXT NOT NULL DEFAULT '',
    "userAgent" TEXT NOT NULL DEFAULT '',
    "statusCode" INTEGER NOT NULL DEFAULT 200,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposit_compliance_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "evaluationDate" DATE NOT NULL,
    "myDataDeposit" DECIMAL(14,2) NOT NULL,
    "myDataQftd" INTEGER NOT NULL,
    "myDataAvg" DECIMAL(14,2) NOT NULL,
    "teamDeposit" DECIMAL(14,2) NOT NULL,
    "teamQftd" INTEGER NOT NULL,
    "teamAvg" DECIMAL(14,2) NOT NULL,
    "teamSkipped" BOOLEAN NOT NULL DEFAULT false,
    "threshold" DECIMAL(14,2) NOT NULL,
    "status" "DepositComplianceStatus" NOT NULL,
    "failReason" "DepositComplianceFailReason",
    "alertCountAfter" INTEGER NOT NULL DEFAULT 0,
    "withdrawalBlockedForDay" BOOLEAN NOT NULL DEFAULT false,
    "penaltyApplied" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deposit_compliance_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fraud_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "bettingHouse" TEXT NOT NULL,
    "oldCount" INTEGER NOT NULL DEFAULT 0,
    "newCount" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fraud_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_snapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bettingHouse" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "registrations" INTEGER NOT NULL DEFAULT 0,
    "ftds" INTEGER NOT NULL DEFAULT 0,
    "cpaQualified" INTEGER NOT NULL DEFAULT 0,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_logs" (
    "id" TEXT NOT NULL,
    "bettingHouse" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "status" "SyncLogStatus" NOT NULL DEFAULT 'RUNNING',
    "triggeredBy" TEXT NOT NULL DEFAULT 'cron',
    "periodStart" DATE,
    "periodEnd" DATE,
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "inserted" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "apiBaseUrl" TEXT NOT NULL DEFAULT 'https://api.betboard.com.br/api',
    "encryptedEmail" TEXT NOT NULL,
    "encryptedPassword" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_account_houses" (
    "id" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "bettingHouseSlug" TEXT NOT NULL,
    "bookmarkerId" TEXT NOT NULL,
    "extraConfig" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_account_houses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_referralCode_key" ON "users"("referralCode");

-- CreateIndex
CREATE INDEX "users_role_status_createdAt_idx" ON "users"("role", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "users_referredById_idx" ON "users"("referredById");

-- CreateIndex
CREATE INDEX "users_deletedAt_idx" ON "users"("deletedAt");

-- CreateIndex
CREATE INDEX "affiliate_links_userId_bettingHouse_idx" ON "affiliate_links"("userId", "bettingHouse");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_links_campaignId_bettingHouse_key" ON "affiliate_links"("campaignId", "bettingHouse");

-- CreateIndex
CREATE UNIQUE INDEX "fraud_counts_userId_bettingHouse_key" ON "fraud_counts"("userId", "bettingHouse");

-- CreateIndex
CREATE INDEX "affiliate_data_affiliateId_bettingHouse_date_idx" ON "affiliate_data"("affiliateId", "bettingHouse", "date");

-- CreateIndex
CREATE INDEX "affiliate_data_bettingHouse_date_idx" ON "affiliate_data"("bettingHouse", "date");

-- CreateIndex
CREATE INDEX "affiliate_data_campaignId_bettingHouse_idx" ON "affiliate_data"("campaignId", "bettingHouse");

-- CreateIndex
CREATE INDEX "affiliate_data_campaignId_bettingHouse_date_campaignName_idx" ON "affiliate_data"("campaignId", "bettingHouse", "date", "campaignName");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_data_campaignId_bettingHouse_date_campaignName_ut_key" ON "affiliate_data"("campaignId", "bettingHouse", "date", "campaignName", "utmCampaign");

-- CreateIndex
CREATE UNIQUE INDEX "betting_houses_slug_key" ON "betting_houses"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "deals_legacyKey_key" ON "deals"("legacyKey");

-- CreateIndex
CREATE INDEX "deals_bettingHouseSlug_sortOrder_name_idx" ON "deals"("bettingHouseSlug", "sortOrder" DESC, "name");

-- CreateIndex
CREATE INDEX "deals_active_idx" ON "deals"("active");

-- CreateIndex
CREATE INDEX "withdrawal_requests_userId_status_idx" ON "withdrawal_requests"("userId", "status");

-- CreateIndex
CREATE INDEX "withdrawal_requests_userId_createdAt_idx" ON "withdrawal_requests"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "withdrawal_requests_bettingHouse_idx" ON "withdrawal_requests"("bettingHouse");

-- CreateIndex
CREATE INDEX "link_requests_userId_idx" ON "link_requests"("userId");

-- CreateIndex
CREATE INDEX "link_requests_dealId_idx" ON "link_requests"("dealId");

-- CreateIndex
CREATE INDEX "link_requests_status_idx" ON "link_requests"("status");

-- CreateIndex
CREATE INDEX "link_requests_bettingHouseSlug_idx" ON "link_requests"("bettingHouseSlug");

-- CreateIndex
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "commission_logs_userId_createdAt_idx" ON "commission_logs"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "commission_logs_userId_bettingHouse_idx" ON "commission_logs"("userId", "bettingHouse");

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");

-- CreateIndex
CREATE INDEX "ranking_prizes_status_endDate_idx" ON "ranking_prizes"("status", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "rank_prizes_rankingPrizeId_rank_key" ON "rank_prizes"("rankingPrizeId", "rank");

-- CreateIndex
CREATE INDEX "prize_winners_rankingPrizeId_idx" ON "prize_winners"("rankingPrizeId");

-- CreateIndex
CREATE INDEX "prize_winners_userId_idx" ON "prize_winners"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_resource_createdAt_idx" ON "audit_logs"("resource", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "deposit_compliance_logs_evaluationDate_status_idx" ON "deposit_compliance_logs"("evaluationDate", "status");

-- CreateIndex
CREATE INDEX "deposit_compliance_logs_userId_status_idx" ON "deposit_compliance_logs"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "deposit_compliance_logs_userId_evaluationDate_key" ON "deposit_compliance_logs"("userId", "evaluationDate");

-- CreateIndex
CREATE INDEX "fraud_logs_userId_createdAt_idx" ON "fraud_logs"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "notification_snapshots_userId_bettingHouse_key" ON "notification_snapshots"("userId", "bettingHouse");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_userId_endpoint_key" ON "push_subscriptions"("userId", "endpoint");

-- CreateIndex
CREATE INDEX "sync_logs_bettingHouse_createdAt_idx" ON "sync_logs"("bettingHouse", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "provider_accounts_provider_active_idx" ON "provider_accounts"("provider", "active");

-- CreateIndex
CREATE UNIQUE INDEX "provider_accounts_name_provider_key" ON "provider_accounts"("name", "provider");

-- CreateIndex
CREATE INDEX "provider_account_houses_bettingHouseSlug_idx" ON "provider_account_houses"("bettingHouseSlug");

-- CreateIndex
CREATE UNIQUE INDEX "provider_account_houses_providerAccountId_bettingHouseSlug_key" ON "provider_account_houses"("providerAccountId", "bettingHouseSlug");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_referredById_fkey" FOREIGN KEY ("referredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliate_links" ADD CONSTRAINT "affiliate_links_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_counts" ADD CONSTRAINT "fraud_counts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_counts" ADD CONSTRAINT "fraud_counts_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_bettingHouseSlug_fkey" FOREIGN KEY ("bettingHouseSlug") REFERENCES "betting_houses"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawal_requests" ADD CONSTRAINT "withdrawal_requests_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_requests" ADD CONSTRAINT "link_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_requests" ADD CONSTRAINT "link_requests_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_requests" ADD CONSTRAINT "link_requests_fulfilledById_fkey" FOREIGN KEY ("fulfilledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_logs" ADD CONSTRAINT "commission_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_logs" ADD CONSTRAINT "commission_logs_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ranking_prizes" ADD CONSTRAINT "ranking_prizes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ranking_prizes" ADD CONSTRAINT "ranking_prizes_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rank_prizes" ADD CONSTRAINT "rank_prizes_rankingPrizeId_fkey" FOREIGN KEY ("rankingPrizeId") REFERENCES "ranking_prizes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prize_winners" ADD CONSTRAINT "prize_winners_rankingPrizeId_fkey" FOREIGN KEY ("rankingPrizeId") REFERENCES "ranking_prizes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prize_winners" ADD CONSTRAINT "prize_winners_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_compliance_logs" ADD CONSTRAINT "deposit_compliance_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_logs" ADD CONSTRAINT "fraud_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_logs" ADD CONSTRAINT "fraud_logs_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_snapshots" ADD CONSTRAINT "notification_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_bettingHouse_fkey" FOREIGN KEY ("bettingHouse") REFERENCES "betting_houses"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_account_houses" ADD CONSTRAINT "provider_account_houses_providerAccountId_fkey" FOREIGN KEY ("providerAccountId") REFERENCES "provider_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_account_houses" ADD CONSTRAINT "provider_account_houses_bettingHouseSlug_fkey" FOREIGN KEY ("bettingHouseSlug") REFERENCES "betting_houses"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

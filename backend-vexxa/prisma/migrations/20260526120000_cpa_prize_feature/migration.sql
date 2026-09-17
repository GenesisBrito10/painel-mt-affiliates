-- CreateEnum
CREATE TYPE "CpaPrizeCountMode" AS ENUM ('INDIVIDUAL', 'NETWORK');

-- CreateEnum
CREATE TYPE "CpaPrizeAwardStatus" AS ENUM ('AVAILABLE', 'REDEMPTION_REQUESTED', 'PAID', 'CANCELLED', 'REJECTED');

-- CreateTable
CREATE TABLE "cpa_prize_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "currentVersionId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cpa_prize_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cpa_prize_rule_versions" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "bettingHouse" TEXT,
    "cpaPerPrize" INTEGER NOT NULL,
    "countMode" "CpaPrizeCountMode" NOT NULL,
    "prizeType" "PrizeType" NOT NULL DEFAULT 'OTHER',
    "prizeValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "prizeLabel" TEXT NOT NULL DEFAULT '',
    "icon" TEXT NOT NULL DEFAULT '🎯',
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "effectiveFromDate" DATE NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cpa_prize_rule_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cpa_prize_progress" (
    "id" TEXT NOT NULL,
    "ruleVersionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "totalCpaCounted" INTEGER NOT NULL DEFAULT 0,
    "awardsGenerated" INTEGER NOT NULL DEFAULT 0,
    "lastEvaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ruleId" TEXT NOT NULL,

    CONSTRAINT "cpa_prize_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cpa_prize_awards" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleVersionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "bettingHouse" TEXT,
    "countMode" "CpaPrizeCountMode" NOT NULL,
    "cpaThreshold" INTEGER NOT NULL,
    "cycleIndex" INTEGER NOT NULL,
    "prizeType" "PrizeType" NOT NULL DEFAULT 'OTHER',
    "prizeValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "prizeLabel" TEXT NOT NULL DEFAULT '',
    "status" "CpaPrizeAwardStatus" NOT NULL DEFAULT 'AVAILABLE',
    "balanceCredited" BOOLEAN NOT NULL DEFAULT false,
    "redemptionRequestedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cpa_prize_awards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cpa_prize_logs" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT,
    "ruleVersionId" TEXT,
    "userId" TEXT,
    "adminId" TEXT,
    "event" TEXT NOT NULL,
    "bettingHouse" TEXT,
    "cpaBefore" INTEGER,
    "cpaAdded" INTEGER,
    "cpaAfter" INTEGER,
    "prizesGenerated" INTEGER,
    "totalValueGenerated" DECIMAL(14,2),
    "note" TEXT NOT NULL DEFAULT '',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cpa_prize_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cpa_prize_rules_active_archived_idx" ON "cpa_prize_rules"("active", "archived");

-- CreateIndex
CREATE INDEX "cpa_prize_rule_versions_supersededAt_idx" ON "cpa_prize_rule_versions"("supersededAt");

-- CreateIndex
CREATE UNIQUE INDEX "cpa_prize_rule_versions_ruleId_version_key" ON "cpa_prize_rule_versions"("ruleId", "version");

-- CreateIndex
CREATE INDEX "cpa_prize_progress_ruleId_idx" ON "cpa_prize_progress"("ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "cpa_prize_progress_ruleVersionId_userId_key" ON "cpa_prize_progress"("ruleVersionId", "userId");

-- CreateIndex
CREATE INDEX "cpa_prize_awards_status_idx" ON "cpa_prize_awards"("status");

-- CreateIndex
CREATE INDEX "cpa_prize_awards_userId_idx" ON "cpa_prize_awards"("userId");

-- CreateIndex
CREATE INDEX "cpa_prize_awards_ruleId_idx" ON "cpa_prize_awards"("ruleId");

-- CreateIndex
CREATE UNIQUE INDEX "cpa_prize_awards_ruleVersionId_userId_cycleIndex_key" ON "cpa_prize_awards"("ruleVersionId", "userId", "cycleIndex");

-- CreateIndex
CREATE INDEX "cpa_prize_logs_userId_createdAt_idx" ON "cpa_prize_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "cpa_prize_logs_ruleId_createdAt_idx" ON "cpa_prize_logs"("ruleId", "createdAt");

-- CreateIndex
CREATE INDEX "cpa_prize_logs_event_idx" ON "cpa_prize_logs"("event");

-- AddForeignKey
ALTER TABLE "cpa_prize_rules" ADD CONSTRAINT "cpa_prize_rules_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpa_prize_rule_versions" ADD CONSTRAINT "cpa_prize_rule_versions_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "cpa_prize_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpa_prize_rule_versions" ADD CONSTRAINT "cpa_prize_rule_versions_bettingHouse_fkey" FOREIGN KEY ("bettingHouse") REFERENCES "betting_houses"("slug") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpa_prize_progress" ADD CONSTRAINT "cpa_prize_progress_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "cpa_prize_rule_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpa_prize_progress" ADD CONSTRAINT "cpa_prize_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpa_prize_awards" ADD CONSTRAINT "cpa_prize_awards_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "cpa_prize_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpa_prize_awards" ADD CONSTRAINT "cpa_prize_awards_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "cpa_prize_rule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cpa_prize_awards" ADD CONSTRAINT "cpa_prize_awards_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


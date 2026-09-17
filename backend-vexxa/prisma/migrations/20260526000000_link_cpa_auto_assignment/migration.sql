-- Link request / CPA auto-assignment refactor.
-- CPA do convidado passa a ser calculado por regra configurável (house_link_rules)
-- no momento da solicitação (snapshot em link_requests), substituindo CPA manual
-- do líder + timeout de 24h. Esportiva entra no fluxo de pool automático.
--
-- ATENÇÃO PRODUÇÃO (rollout seguro — ver plano):
--  1) Esta migration adiciona affiliate_links.source de forma CONSERVADORA
--     (nullable -> backfill por padrão de campaignId -> NOT NULL). Placeholders
--     NUNCA são classificados como link real (POOL/MANUAL).
--  2) Os índices únicos PARCIAIS no fim exigem que NÃO existam duplicados ativos.
--     Rodar os diagnósticos abaixo ANTES e resolver duplicados:
--       SELECT "userId","bettingHouse",count(*) FROM "affiliate_links"
--         WHERE "deletedAt" IS NULL AND "source" IN ('POOL','MANUAL')
--         GROUP BY 1,2 HAVING count(*)>1;
--       SELECT "userId","bettingHouseSlug",count(*) FROM "link_requests"
--         WHERE "status"='PENDING' GROUP BY 1,2 HAVING count(*)>1;
--  3) Em tabelas grandes, criar os índices com CREATE UNIQUE INDEX CONCURRENTLY
--     via psql (fora desta transação) — ver prisma/migrations/MANUAL_INDEXES.md.

-- CreateEnum
CREATE TYPE "LinkSource" AS ENUM ('POOL', 'MANUAL', 'COMMISSION_ONLY', 'PLACEHOLDER');

-- CreateEnum
CREATE TYPE "LinkRuleType" AS ENUM ('INVITER_DISCOUNT', 'RANGE');

-- CreateEnum
CREATE TYPE "LinkAssignmentRuleApplied" AS ENUM ('DEFAULT', 'INVITER_MINUS_DISCOUNT', 'FALLBACK', 'RANGE_RULE', 'BLOCKED', 'ALREADY_HAS_LINK');

-- CreateEnum
CREATE TYPE "LinkAssignmentOutcome" AS ENUM ('LINK_ASSIGNED', 'WAITING_POOL_LINK', 'WAITING_SNAPSHOT', 'SKIPPED_AUTO_ASSIGN', 'WAITING_MANUAL_REVIEW', 'BLOCKED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "LinkAssignmentOrigin" AS ENUM ('NEW_REQUEST', 'BACKFILL_OLD_REQUESTS', 'ADMIN_REPROCESS', 'ADMIN_OVERRIDE');

-- CreateEnum
CREATE TYPE "BackfillRunStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED', 'FAILED_STALE');

-- AlterTable: affiliate_links.source — ETAPAS conservadoras (§1 do plano)
-- 1) nullable
ALTER TABLE "affiliate_links" ADD COLUMN "source" "LinkSource";
-- 2) backfill conservador por padrão de campaignId / vínculo real
--    placeholder de comissão (upsertCommissionOnly): pending_<slug>_<userId>
UPDATE "affiliate_links" SET "source" = 'COMMISSION_ONLY'
  WHERE LEFT("campaignId", 8) = 'pending_';
--    placeholder manual sem link real confirmado: manual_<slug>_<userId8>
UPDATE "affiliate_links" SET "source" = 'PLACEHOLDER'
  WHERE LEFT("campaignId", 7) = 'manual_';
--    sem identificador utilizável -> placeholder
UPDATE "affiliate_links" SET "source" = 'PLACEHOLDER'
  WHERE "source" IS NULL
    AND NULLIF("campaignId", '') IS NULL
    AND NULLIF("affiliateId", '') IS NULL;
--    demais (campaignId real) -> POOL. Na dúvida, nunca link real.
UPDATE "affiliate_links" SET "source" = 'POOL' WHERE "source" IS NULL;
-- 3) NOT NULL + default
ALTER TABLE "affiliate_links" ALTER COLUMN "source" SET DEFAULT 'POOL';
ALTER TABLE "affiliate_links" ALTER COLUMN "source" SET NOT NULL;

-- AlterTable: snapshot do CPA + bloqueio em link_requests
ALTER TABLE "link_requests" ADD COLUMN     "blockedMetadata" JSONB,
ADD COLUMN     "blockedReason" TEXT,
ADD COLUMN     "houseRuleId" TEXT,
ADD COLUMN     "houseRuleUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "inviterCpa" DECIMAL(10,4),
ADD COLUMN     "inviterId" TEXT,
ADD COLUMN     "missingHouseSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "rangeReferenceCpa" DECIMAL(10,4),
ADD COLUMN     "rangeReferenceHouse" TEXT,
ADD COLUMN     "requiredHouseSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedCpa" DECIMAL(10,4),
ADD COLUMN     "resolvedRevshare" DECIMAL(10,4),
ADD COLUMN     "resolvedRuleApplied" "LinkAssignmentRuleApplied";

-- CreateTable
CREATE TABLE "house_link_rules" (
    "id" TEXT NOT NULL,
    "houseSlug" TEXT NOT NULL,
    "requestEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoAssignEnabled" BOOLEAN NOT NULL DEFAULT true,
    "ruleType" "LinkRuleType" NOT NULL DEFAULT 'INVITER_DISCOUNT',
    "defaultCpa" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "fallbackCpa" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "inviterCpaThreshold" DECIMAL(10,4),
    "inviterCpaDiscount" DECIMAL(10,4) NOT NULL DEFAULT 5,
    "defaultRevshare" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "rangeReferenceHouse" TEXT,
    "rangeTiers" JSONB NOT NULL DEFAULT '[]',
    "checkExistingLink" BOOLEAN NOT NULL DEFAULT true,
    "checkPendingRequest" BOOLEAN NOT NULL DEFAULT true,
    "useInviterCpa" BOOLEAN NOT NULL DEFAULT true,
    "applyFallbackNoInviterCpa" BOOLEAN NOT NULL DEFAULT true,
    "applyDefaultNoInviter" BOOLEAN NOT NULL DEFAULT true,
    "blockOnRequiredFail" BOOLEAN NOT NULL DEFAULT true,
    "processOldRequests" BOOLEAN NOT NULL DEFAULT false,
    "requireActiveLinkInHouses" BOOLEAN NOT NULL DEFAULT false,
    "requiredHouseSlugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blockMessage" TEXT NOT NULL DEFAULT '',
    "updatedByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "house_link_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "house_link_rule_change_logs" (
    "id" TEXT NOT NULL,
    "houseRuleId" TEXT,
    "houseSlug" TEXT NOT NULL,
    "adminName" TEXT NOT NULL DEFAULT '',
    "changeReason" TEXT,
    "changes" JSONB NOT NULL DEFAULT '{}',
    "blockMessageOld" TEXT NOT NULL DEFAULT '',
    "blockMessageNew" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "house_link_rule_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "link_assignment_logs" (
    "id" TEXT NOT NULL,
    "linkRequestId" TEXT,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL DEFAULT '',
    "houseSlug" TEXT NOT NULL,
    "inviterId" TEXT,
    "inviterCpa" DECIMAL(10,4),
    "assignedCpa" DECIMAL(10,4),
    "ruleApplied" "LinkAssignmentRuleApplied",
    "outcome" "LinkAssignmentOutcome" NOT NULL,
    "origin" "LinkAssignmentOrigin" NOT NULL,
    "togglesApplied" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiredHouses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "missingHouses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "statusBefore" TEXT NOT NULL DEFAULT '',
    "statusAfter" TEXT NOT NULL DEFAULT '',
    "adminName" TEXT NOT NULL DEFAULT '',
    "reason" TEXT,
    "message" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "link_assignment_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backfill_runs" (
    "id" TEXT NOT NULL,
    "houseSlug" TEXT NOT NULL,
    "status" "BackfillRunStatus" NOT NULL DEFAULT 'RUNNING',
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "adminName" TEXT NOT NULL DEFAULT '',
    "reason" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "staleAt" TIMESTAMP(3),
    "failedReason" TEXT,
    "evaluated" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "blocked" INTEGER NOT NULL DEFAULT 0,
    "waitingPool" INTEGER NOT NULL DEFAULT 0,
    "waitingSnapshot" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "backfill_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "house_link_rules_houseSlug_key" ON "house_link_rules"("houseSlug");

-- CreateIndex
CREATE INDEX "house_link_rules_requestEnabled_idx" ON "house_link_rules"("requestEnabled");

-- CreateIndex
CREATE INDEX "house_link_rules_autoAssignEnabled_idx" ON "house_link_rules"("autoAssignEnabled");

-- CreateIndex
CREATE INDEX "house_link_rule_change_logs_houseSlug_createdAt_idx" ON "house_link_rule_change_logs"("houseSlug", "createdAt");

-- CreateIndex
CREATE INDEX "link_assignment_logs_linkRequestId_idx" ON "link_assignment_logs"("linkRequestId");

-- CreateIndex
CREATE INDEX "link_assignment_logs_userId_houseSlug_idx" ON "link_assignment_logs"("userId", "houseSlug");

-- CreateIndex
CREATE INDEX "link_assignment_logs_houseSlug_createdAt_idx" ON "link_assignment_logs"("houseSlug", "createdAt");

-- CreateIndex
CREATE INDEX "link_assignment_logs_origin_createdAt_idx" ON "link_assignment_logs"("origin", "createdAt");

-- CreateIndex
CREATE INDEX "link_assignment_logs_outcome_createdAt_idx" ON "link_assignment_logs"("outcome", "createdAt");

-- CreateIndex
CREATE INDEX "backfill_runs_houseSlug_status_idx" ON "backfill_runs"("houseSlug", "status");

-- CreateIndex
CREATE INDEX "backfill_runs_startedAt_idx" ON "backfill_runs"("startedAt");

-- CreateIndex
CREATE INDEX "link_requests_houseRuleId_idx" ON "link_requests"("houseRuleId");

-- AddForeignKey
ALTER TABLE "link_requests" ADD CONSTRAINT "link_requests_houseRuleId_fkey" FOREIGN KEY ("houseRuleId") REFERENCES "house_link_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "house_link_rules" ADD CONSTRAINT "house_link_rules_houseSlug_fkey" FOREIGN KEY ("houseSlug") REFERENCES "betting_houses"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "house_link_rule_change_logs" ADD CONSTRAINT "house_link_rule_change_logs_houseRuleId_fkey" FOREIGN KEY ("houseRuleId") REFERENCES "house_link_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Índices únicos PARCIAIS (proteção no banco contra corrida — §2/§3 do plano).
-- Pré-requisito: nenhum duplicado ativo (ver diagnósticos no topo). Em prod com
-- tabela grande, criar via CONCURRENTLY fora de transação (MANUAL_INDEXES.md).
-- 1 link real ativo por usuário+casa:
CREATE UNIQUE INDEX "uniq_real_active_affiliate_link_user_house"
  ON "affiliate_links" ("userId", "bettingHouse")
  WHERE "deletedAt" IS NULL AND "source" IN ('POOL', 'MANUAL');
-- 1 solicitação PENDING por usuário+casa:
CREATE UNIQUE INDEX "uniq_pending_link_request_user_house"
  ON "link_requests" ("userId", "bettingHouseSlug")
  WHERE "status" = 'PENDING';

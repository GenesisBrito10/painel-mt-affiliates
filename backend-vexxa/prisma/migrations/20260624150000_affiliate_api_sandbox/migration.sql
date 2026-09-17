-- AlterTable: token environment (live | test)
ALTER TABLE "affiliate_api_tokens" ADD COLUMN "environment" TEXT NOT NULL DEFAULT 'live';

-- CreateIndex
CREATE INDEX "affiliate_api_tokens_userId_environment_revokedAt_idx" ON "affiliate_api_tokens"("userId", "environment", "revokedAt");

-- CreateTable: isolated sandbox storage (production code never reads this)
CREATE TABLE "affiliate_api_sandbox_records" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "externalId" TEXT,
    "refId" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_api_sandbox_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "affiliate_api_sandbox_records_ownerUserId_kind_idx" ON "affiliate_api_sandbox_records"("ownerUserId", "kind");

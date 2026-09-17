-- CreateTable: raw payload log of affiliate-API link-requests (never lose received e-mail)
CREATE TABLE "affiliate_api_link_request_logs" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "bettingHouseSlug" TEXT NOT NULL,
    "dealId" TEXT,
    "message" TEXT,
    "requesterId" TEXT,
    "emailSynthetic" BOOLEAN NOT NULL DEFAULT false,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_api_link_request_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "affiliate_api_link_request_logs_ownerUserId_createdAt_idx" ON "affiliate_api_link_request_logs"("ownerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "affiliate_api_link_request_logs_externalId_idx" ON "affiliate_api_link_request_logs"("externalId");

-- CreateIndex
CREATE INDEX "affiliate_api_link_request_logs_userEmail_idx" ON "affiliate_api_link_request_logs"("userEmail");

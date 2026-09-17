-- CreateEnum
CREATE TYPE "LinkWebhookDeliveryStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "link_webhook_settings" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "webhookUrl" TEXT NOT NULL DEFAULT '',
    "webhookSecret" TEXT NOT NULL DEFAULT '',
    "notifyOnApproved" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnRejected" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "link_webhook_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "link_webhook_deliveries" (
    "id" TEXT NOT NULL,
    "linkRequestId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "LinkWebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "httpStatus" INTEGER,
    "responseBody" TEXT,
    "errorMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "link_webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "link_webhook_deliveries_idempotencyKey_key" ON "link_webhook_deliveries"("idempotencyKey");

-- CreateIndex
CREATE INDEX "link_webhook_deliveries_linkRequestId_idx" ON "link_webhook_deliveries"("linkRequestId");

-- CreateIndex
CREATE INDEX "link_webhook_deliveries_status_createdAt_idx" ON "link_webhook_deliveries"("status", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "link_webhook_deliveries" ADD CONSTRAINT "link_webhook_deliveries_linkRequestId_fkey" FOREIGN KEY ("linkRequestId") REFERENCES "link_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

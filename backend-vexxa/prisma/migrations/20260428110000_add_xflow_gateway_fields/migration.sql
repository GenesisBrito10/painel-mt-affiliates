-- XFlow payment-gateway integration: enum extensions, gateway tracking columns,
-- webhook event log. Backward-compatible: every new column is nullable or has
-- a default; new enum values are additive.

-- Extend WithdrawalStatus enum
ALTER TYPE "WithdrawalStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "WithdrawalStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';
ALTER TYPE "WithdrawalStatus" ADD VALUE IF NOT EXISTS 'FAILED';

-- Extend NotificationType enum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WITHDRAWAL_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WITHDRAWAL_FAILED';

-- WithdrawalRequest: gateway tracking columns
ALTER TABLE "withdrawal_requests"
  ADD COLUMN "gatewayProvider"      TEXT,
  ADD COLUMN "gatewayId"            TEXT,
  ADD COLUMN "gatewayStatus"        TEXT,
  ADD COLUMN "gatewayRequest"       JSONB,
  ADD COLUMN "gatewayResponse"      JSONB,
  ADD COLUMN "gatewaySentAt"        TIMESTAMP(3),
  ADD COLUMN "gatewayCompletedAt"   TIMESTAMP(3),
  ADD COLUMN "gatewayFailureReason" TEXT,
  ADD COLUMN "gatewayEndToEnd"      TEXT,
  ADD COLUMN "gatewayReceiver"      JSONB,
  ADD COLUMN "gatewayAttempts"      INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "withdrawal_requests_gatewayId_key"
  ON "withdrawal_requests" ("gatewayId");

-- GatewayWebhookEvent: idempotent webhook log
CREATE TABLE "gateway_webhook_events" (
  "id"           TEXT         NOT NULL,
  "provider"     TEXT         NOT NULL DEFAULT 'xflow',
  "eventKey"     TEXT         NOT NULL,
  "event"        TEXT         NOT NULL,
  "gatewayId"    TEXT         NOT NULL,
  "withdrawalId" TEXT,
  "rawPayload"   JSONB        NOT NULL,
  "status"       TEXT         NOT NULL DEFAULT 'processed',
  "error"        TEXT,
  "receivedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gateway_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gateway_webhook_events_eventKey_key"
  ON "gateway_webhook_events" ("eventKey");

CREATE INDEX "gateway_webhook_events_gatewayId_idx"
  ON "gateway_webhook_events" ("gatewayId");

CREATE INDEX "gateway_webhook_events_withdrawalId_idx"
  ON "gateway_webhook_events" ("withdrawalId");

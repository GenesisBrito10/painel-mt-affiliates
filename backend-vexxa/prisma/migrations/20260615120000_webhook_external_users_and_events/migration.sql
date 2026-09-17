-- External panel users (third-party API shadow users) ------------------------
ALTER TABLE "users" ADD COLUMN "isExternal" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "externalId" TEXT;

-- Unique external id within an owner (referredById) scope. NULL externalId
-- (real affiliates) never collide because Postgres treats NULLs as distinct.
CREATE UNIQUE INDEX "uq_owner_external" ON "users"("referredById", "externalId");

-- Webhook subscription: booleans -> events String[] -------------------------
ALTER TABLE "link_webhook_settings"
  ADD COLUMN "events" TEXT[] NOT NULL DEFAULT ARRAY['link_request.approved', 'link_request.rejected']::TEXT[];

-- Backfill events from the old boolean flags before dropping them.
UPDATE "link_webhook_settings"
SET "events" = (
  ARRAY[]::TEXT[]
  || CASE WHEN "notifyOnApproved" THEN ARRAY['link_request.approved'] ELSE ARRAY[]::TEXT[] END
  || CASE WHEN "notifyOnRejected" THEN ARRAY['link_request.rejected'] ELSE ARRAY[]::TEXT[] END
);

ALTER TABLE "link_webhook_settings" DROP COLUMN "notifyOnApproved";
ALTER TABLE "link_webhook_settings" DROP COLUMN "notifyOnRejected";

-- Deliveries: linkRequestId nullable (non-link events) + SET NULL on delete --
ALTER TABLE "link_webhook_deliveries" DROP CONSTRAINT "link_webhook_deliveries_linkRequestId_fkey";
ALTER TABLE "link_webhook_deliveries" ALTER COLUMN "linkRequestId" DROP NOT NULL;
ALTER TABLE "link_webhook_deliveries"
  ADD CONSTRAINT "link_webhook_deliveries_linkRequestId_fkey"
  FOREIGN KEY ("linkRequestId") REFERENCES "link_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "link_webhook_deliveries_event_createdAt_idx" ON "link_webhook_deliveries"("event", "createdAt" DESC);

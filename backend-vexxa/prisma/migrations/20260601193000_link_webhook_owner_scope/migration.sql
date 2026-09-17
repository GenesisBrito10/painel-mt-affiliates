-- Escopo por rede: config e entregas por lead (ownerUserId) + global (null = admin)

ALTER TABLE "link_webhook_settings" ADD COLUMN "ownerUserId" TEXT;

ALTER TABLE "link_webhook_deliveries" ADD COLUMN "ownerUserId" TEXT;

CREATE UNIQUE INDEX "link_webhook_settings_ownerUserId_key" ON "link_webhook_settings"("ownerUserId");

CREATE INDEX "link_webhook_deliveries_ownerUserId_createdAt_idx" ON "link_webhook_deliveries"("ownerUserId", "createdAt" DESC);

ALTER TABLE "link_webhook_settings" ADD CONSTRAINT "link_webhook_settings_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "link_webhook_deliveries" ADD CONSTRAINT "link_webhook_deliveries_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

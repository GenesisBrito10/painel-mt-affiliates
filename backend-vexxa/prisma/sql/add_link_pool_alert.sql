-- Additive, non-destructive: campos de alerta de planilha cheia + enum value.
-- Idempotente (IF NOT EXISTS / guard) para ser seguro em prod com drift.
ALTER TABLE "whatsapp_settings"
  ADD COLUMN IF NOT EXISTS "linkPoolAlertNumber" TEXT;
ALTER TABLE "whatsapp_settings"
  ADD COLUMN IF NOT EXISTS "linkPoolAlertThreshold" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "whatsapp_settings"
  ADD COLUMN IF NOT EXISTS "linkPoolAlertEnabled" BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'NotificationType' AND e.enumlabel = 'LINK_POOL_FULL'
  ) THEN
    ALTER TYPE "NotificationType" ADD VALUE 'LINK_POOL_FULL';
  END IF;
END
$$;

-- Lower WhatsApp circuit-breaker default cooldown from 1800s (30min) to 300s (5min).
-- Affects only new rows; existing whatsapp_settings rows keep their stored value.
ALTER TABLE "whatsapp_settings" ALTER COLUMN "failureCooldownSeconds" SET DEFAULT 300;

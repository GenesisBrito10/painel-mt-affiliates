UPDATE "login_modals"
SET "payload" = jsonb_set(COALESCE("payload", '{}'::jsonb), '{actionIcon}', '"i-lucide-check-circle"', true)
WHERE "key" = 'cpa_provider_instability';

UPDATE "login_modals"
SET "payload" = jsonb_set(COALESCE("payload", '{}'::jsonb), '{actionIcon}', '"i-simple-icons-whatsapp"', true)
WHERE "key" = 'social_whatsapp_invite';

UPDATE "login_modals"
SET "payload" = jsonb_set(COALESCE("payload", '{}'::jsonb), '{actionIcon}', '"i-lucide-instagram"', true)
WHERE "key" = 'social_instagram_invite';

UPDATE "login_modals"
SET "payload" = jsonb_set(COALESCE("payload", '{}'::jsonb), '{actionIcon}', '"i-lucide-check-circle"', true)
WHERE "key" = 'superbet_inactivity_notice';

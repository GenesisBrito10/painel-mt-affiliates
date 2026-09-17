-- Admin-granted permission gating the API + Webhook features.
ALTER TABLE "users" ADD COLUMN "apiAccessEnabled" BOOLEAN NOT NULL DEFAULT false;

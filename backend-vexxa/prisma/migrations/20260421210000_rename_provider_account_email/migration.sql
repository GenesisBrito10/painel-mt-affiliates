-- Migration: rename encryptedEmail → email (plaintext) in provider_accounts
-- Email is not a secret — only the password needs encryption.

-- Step 1: Add new plaintext email column with a temporary default so existing rows are satisfied
ALTER TABLE "provider_accounts" ADD COLUMN "email" TEXT NOT NULL DEFAULT '';

-- Step 2: Backfill existing rows from the old encryptedEmail column.
-- We can't decrypt here (no key access in SQL), but since we have the data in the seed script
-- we'll overwrite with the correct values via seed-provider-accounts.ts after migration.
-- For now, just set a sentinel so the NOT NULL constraint is satisfied.
UPDATE "provider_accounts" SET "email" = name || '@placeholder.invalid';

-- Step 3: Remove the temporary DEFAULT so future inserts must supply the value
ALTER TABLE "provider_accounts" ALTER COLUMN "email" DROP DEFAULT;

-- Step 4: Drop the old encryptedEmail column
ALTER TABLE "provider_accounts" DROP COLUMN "encryptedEmail";

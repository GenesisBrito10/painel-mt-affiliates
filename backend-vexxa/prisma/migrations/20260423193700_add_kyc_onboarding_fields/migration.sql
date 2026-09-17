-- AddKycOnboardingFields (F-KYC-01)
-- cpf and birthDate are IMMUTABLE after first submission
-- profileCompleted is a computed boolean flag (set by application layer)

ALTER TABLE "users"
  ADD COLUMN "cpf"               TEXT,
  ADD COLUMN "birthDate"         TIMESTAMP(3),
  ADD COLUMN "whatsapp"          TEXT,
  ADD COLUMN "profileCompleted"  BOOLEAN NOT NULL DEFAULT false;

-- Unique constraint on cpf (one CPF per account)
CREATE UNIQUE INDEX "users_cpf_key" ON "users"("cpf");

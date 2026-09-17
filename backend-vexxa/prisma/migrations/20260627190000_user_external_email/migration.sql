-- AddColumn: real e-mail of external sub-users (non-unique) — used for display + search.
ALTER TABLE "users" ADD COLUMN "externalEmail" TEXT;

-- CreateIndex
CREATE INDEX "users_externalEmail_idx" ON "users"("externalEmail");

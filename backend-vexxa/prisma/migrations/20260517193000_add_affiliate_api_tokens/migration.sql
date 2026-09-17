CREATE TABLE "affiliate_api_tokens" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "tokenHint" TEXT NOT NULL,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "affiliate_api_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "affiliate_api_tokens_tokenHash_key" ON "affiliate_api_tokens"("tokenHash");
CREATE INDEX "affiliate_api_tokens_userId_revokedAt_idx" ON "affiliate_api_tokens"("userId", "revokedAt");

ALTER TABLE "affiliate_api_tokens"
  ADD CONSTRAINT "affiliate_api_tokens_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

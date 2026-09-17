-- AffiliateLink ⇄ ProviderAccount (nullable FK)
-- Permite filtrar saques/comissões por painel (conta de provedor) de origem.

ALTER TABLE "affiliate_links"
  ADD COLUMN "providerAccountId" TEXT;

CREATE INDEX "affiliate_links_providerAccountId_idx"
  ON "affiliate_links"("providerAccountId");

ALTER TABLE "affiliate_links"
  ADD CONSTRAINT "affiliate_links_providerAccountId_fkey"
  FOREIGN KEY ("providerAccountId")
  REFERENCES "provider_accounts"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

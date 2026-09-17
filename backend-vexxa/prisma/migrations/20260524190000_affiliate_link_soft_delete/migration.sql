-- AffiliateLink: soft-delete + índice único PARCIAL + FK Restrict.
-- Objetivo: NUNCA perder campaignId/link/cpa. Hard-delete é bloqueado na app
-- (prisma-audit.extension); aqui garantimos a estrutura no banco.
--
-- PRÉ-REQUISITO (rodar ANTES de aplicar em prod):
--   SELECT "campaignId","bettingHouse", count(*)
--     FROM "affiliate_links" GROUP BY 1,2 HAVING count(*) > 1;
--   Deve retornar 0 linhas. Se houver duplicata ativa, a criação do índice
--   único parcial falha. Resolver duplicatas antes.

-- 1) Coluna soft-delete + índice de filtro
ALTER TABLE "affiliate_links" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "affiliate_links_deletedAt_idx" ON "affiliate_links"("deletedAt");

-- 2) Unique total -> unique PARCIAL (só linhas ativas). Soft-deletado libera o
--    par (campaignId,bettingHouse) para reatribuição futura.
ALTER TABLE "affiliate_links" DROP CONSTRAINT IF EXISTS "uq_campaign_house";
DROP INDEX IF EXISTS "uq_campaign_house";
CREATE UNIQUE INDEX "uq_campaign_house_active"
  ON "affiliate_links" ("campaignId", "bettingHouse")
  WHERE "deletedAt" IS NULL;

-- 3) FK userId: Cascade -> Restrict. Apagar User não cascateia (apaga) os links.
ALTER TABLE "affiliate_links" DROP CONSTRAINT IF EXISTS "affiliate_links_userId_fkey";
ALTER TABLE "affiliate_links" ADD CONSTRAINT "affiliate_links_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4) CommissionLog.source: origem da mudança de cpa/revshare (provenance).
ALTER TABLE "commission_logs" ADD COLUMN "source" TEXT;

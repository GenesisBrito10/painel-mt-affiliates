-- AffiliateLink: URL de afiliado que o usuário compartilha.
ALTER TABLE "affiliate_links" ADD COLUMN "userLink" TEXT;

-- BettingHouse: mínimo de saque por casa (null = usa mínimo global).
ALTER TABLE "betting_houses" ADD COLUMN "minWithdrawalAmount" DECIMAL(14,2);

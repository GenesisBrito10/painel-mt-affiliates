-- Per-house withdrawal kill-switch. false = saques desativados para esta casa.
ALTER TABLE "betting_houses" ADD COLUMN "withdrawalEnabled" BOOLEAN NOT NULL DEFAULT true;

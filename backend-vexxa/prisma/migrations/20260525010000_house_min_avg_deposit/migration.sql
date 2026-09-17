-- Per-house minimum average deposit per CPA required to withdraw.
-- Replaces the single global threshold (setting min_avg_deposit_per_cpa, which
-- stays as the default/fallback). Default 70 keeps existing behavior.
ALTER TABLE "betting_houses" ADD COLUMN "minAvgDepositPerCpa" DECIMAL(14,2) NOT NULL DEFAULT 70;

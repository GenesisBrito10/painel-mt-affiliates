-- Manual per-affiliate balance credit/debit added to baseGross.
-- Used to forgive overpaid (negative) balances so future earnings count fresh.
ALTER TABLE "users" ADD COLUMN "balanceAdjustment" DECIMAL(14,2) NOT NULL DEFAULT 0;

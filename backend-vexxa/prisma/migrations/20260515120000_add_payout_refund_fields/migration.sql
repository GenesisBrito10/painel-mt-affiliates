-- PayOutRefunded — store refunded portion so DashboardBalanceService can
-- credit the affiliate's balance back proportionally without flipping the
-- withdrawal status on partial refunds.
ALTER TABLE "withdrawal_requests"
  ADD COLUMN IF NOT EXISTS "gatewayRefundedAmount" NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS "gatewayRefundedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "gatewayRefundEndToEnd" TEXT;

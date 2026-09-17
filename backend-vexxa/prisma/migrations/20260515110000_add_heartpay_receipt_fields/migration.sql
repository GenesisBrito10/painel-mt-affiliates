-- Persisted HeartPay PIX OUT receipt (PNG base64) after PayOutCompleted webhook.
ALTER TABLE "withdrawal_requests"
  ADD COLUMN IF NOT EXISTS "gatewayReceiptBase64" TEXT,
  ADD COLUMN IF NOT EXISTS "gatewayReceiptFormat" TEXT,
  ADD COLUMN IF NOT EXISTS "gatewayReceiptFetchedAt" TIMESTAMP(3);

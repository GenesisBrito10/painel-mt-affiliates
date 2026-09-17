-- Alinha migrations com produção (objetos aplicados via db push, sem migration):
-- financial_ledger, colunas linkPool* em whatsapp_settings e o valor
-- NotificationType.LINK_POOL_FULL. As tabelas link_webhook_* têm migration própria.

-- CreateEnum
CREATE TYPE "LedgerEventType" AS ENUM ('COMMISSION_CPA', 'COMMISSION_REVSHARE', 'NETWORK_CPA', 'NETWORK_REVSHARE', 'FRAUD_DEDUCTION_DIRECT', 'FRAUD_DEDUCTION_NETWORK', 'WITHDRAWAL_APPROVED', 'BONUS_CREDIT', 'MANUAL_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "LedgerEventStatus" AS ENUM ('CONFIRMED', 'PENDING', 'REVERSED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'LINK_POOL_FULL';

-- AlterTable
ALTER TABLE "whatsapp_settings" ADD COLUMN     "linkPoolAlertEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "linkPoolAlertNumber" TEXT,
ADD COLUMN     "linkPoolAlertThreshold" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "financial_ledger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" "LedgerEventType" NOT NULL,
    "status" "LedgerEventStatus" NOT NULL DEFAULT 'CONFIRMED',
    "amount" DECIMAL(14,2) NOT NULL,
    "bettingHouse" TEXT,
    "campaignId" TEXT,
    "sourceUserId" TEXT,
    "referenceId" TEXT,
    "referenceType" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "eventDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "financial_ledger_userId_eventDate_idx" ON "financial_ledger"("userId", "eventDate" DESC);

-- CreateIndex
CREATE INDEX "financial_ledger_userId_eventType_idx" ON "financial_ledger"("userId", "eventType");

-- CreateIndex
CREATE INDEX "financial_ledger_userId_bettingHouse_idx" ON "financial_ledger"("userId", "bettingHouse");

-- AddForeignKey
ALTER TABLE "financial_ledger" ADD CONSTRAINT "financial_ledger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

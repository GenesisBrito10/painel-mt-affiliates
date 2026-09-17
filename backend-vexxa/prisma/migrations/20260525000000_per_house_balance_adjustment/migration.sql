-- Per-house balance adjustment (replaces the global users.balanceAdjustment).
-- The old global column held 0 non-zero rows at migration time, so dropping it
-- loses no data. Manual credit/debit is now isolated per betting house.

-- CreateTable
CREATE TABLE "balance_adjustments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bettingHouse" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "reason" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "balance_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "balance_adjustments_userId_bettingHouse_key" ON "balance_adjustments"("userId", "bettingHouse");

-- AddForeignKey
ALTER TABLE "balance_adjustments" ADD CONSTRAINT "balance_adjustments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_adjustments" ADD CONSTRAINT "balance_adjustments_bettingHouse_fkey" FOREIGN KEY ("bettingHouse") REFERENCES "betting_houses"("slug") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_adjustments" ADD CONSTRAINT "balance_adjustments_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DropColumn (global adjustment superseded by per-house table)
ALTER TABLE "users" DROP COLUMN "balanceAdjustment";

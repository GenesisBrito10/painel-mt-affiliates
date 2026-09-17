-- Prize house-scoping + win mode.
-- Additive only: existing prizes keep win_mode = RANKING and betting_house = NULL (todas as casas).

-- CreateEnum
CREATE TYPE "PrizeWinMode" AS ENUM ('RANKING', 'TARGET');

-- AlterTable
ALTER TABLE "ranking_prizes"
  ADD COLUMN "bettingHouse" TEXT,
  ADD COLUMN "winMode" "PrizeWinMode" NOT NULL DEFAULT 'RANKING';

-- AddForeignKey
ALTER TABLE "ranking_prizes"
  ADD CONSTRAINT "ranking_prizes_bettingHouse_fkey"
  FOREIGN KEY ("bettingHouse") REFERENCES "betting_houses"("slug")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: limite de vitórias por usuário no modo TARGET (Meta de CPA).
-- NULL = ilimitado.
ALTER TABLE "ranking_prizes" ADD COLUMN "maxWinsPerUser" INTEGER;

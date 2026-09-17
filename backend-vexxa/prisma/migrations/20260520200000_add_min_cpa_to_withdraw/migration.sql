-- Minimum qualified CPAs an affiliate must have in a house to withdraw from it.
-- Default 0 (no requirement). Hiperbet requires 10.
ALTER TABLE "betting_houses"
  ADD COLUMN "minCpaToWithdraw" INTEGER NOT NULL DEFAULT 0;

UPDATE "betting_houses" SET "minCpaToWithdraw" = 10 WHERE "slug" = 'hiperbet';

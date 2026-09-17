ALTER TABLE "affiliate_data"
  ADD COLUMN "netPl" DECIMAL(14,2),
  ADD COLUMN "withdrawalTotal" DECIMAL(14,2),
  ADD COLUMN "volume" DECIMAL(14,2);

ALTER TABLE "affiliate_data_change_logs"
  ADD COLUMN "prevNetPl" DECIMAL(14,2),
  ADD COLUMN "prevWithdrawalTotal" DECIMAL(14,2),
  ADD COLUMN "prevVolume" DECIMAL(14,2),
  ADD COLUMN "newNetPl" DECIMAL(14,2),
  ADD COLUMN "newWithdrawalTotal" DECIMAL(14,2),
  ADD COLUMN "newVolume" DECIMAL(14,2);

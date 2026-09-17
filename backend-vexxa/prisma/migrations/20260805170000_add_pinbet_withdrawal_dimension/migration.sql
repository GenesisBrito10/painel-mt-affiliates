CREATE TYPE "PinbetTrackingDimension" AS ENUM ('AFP1', 'AFP2', 'COMBINED');

ALTER TABLE "withdrawal_requests"
ADD COLUMN "pinbetDimension" "PinbetTrackingDimension";

ALTER TABLE "balance_adjustments"
ADD COLUMN "pinbetDimension" "PinbetTrackingDimension";

CREATE INDEX "withdrawal_requests_bettingHouse_pinbetDimension_idx"
ON "withdrawal_requests"("bettingHouse", "pinbetDimension");

CREATE INDEX "balance_adjustments_bettingHouse_pinbetDimension_idx"
ON "balance_adjustments"("bettingHouse", "pinbetDimension");

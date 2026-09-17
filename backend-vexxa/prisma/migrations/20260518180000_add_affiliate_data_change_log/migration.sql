-- Append-only history of meaningful changes to affiliate_data rows.
-- Persisted by the sync upsert path only when a balance-relevant field
-- (cpaQualified, cpaValue, totalCommission, qftd, ftds, deposit, revShare)
-- changes, so the table stays bounded.

CREATE TYPE "AffiliateDataChangeType" AS ENUM ('INSERT', 'UPDATE');

CREATE TABLE "affiliate_data_change_logs" (
  "id"                    TEXT NOT NULL,
  "affiliateDataId"       TEXT,
  "campaignId"            TEXT NOT NULL,
  "bettingHouse"          TEXT NOT NULL,
  "campaignName"          TEXT NOT NULL,
  "utmCampaign"           TEXT NOT NULL,
  "date"                  DATE NOT NULL,
  "changeType"            "AffiliateDataChangeType" NOT NULL,
  "source"                TEXT NOT NULL,
  "syncLogId"             TEXT,
  "changedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  "prevClicks"            INTEGER,
  "prevRegistrations"     INTEGER,
  "prevFtds"              INTEGER,
  "prevQftd"              INTEGER,
  "prevDeposit"           DECIMAL(14, 2),
  "prevRevShare"          DECIMAL(14, 2),
  "prevCpaQualified"      INTEGER,
  "prevCpaValue"          DECIMAL(14, 2),
  "prevTotalCommission"   DECIMAL(14, 2),

  "newClicks"             INTEGER NOT NULL,
  "newRegistrations"      INTEGER NOT NULL,
  "newFtds"               INTEGER NOT NULL,
  "newQftd"               INTEGER NOT NULL,
  "newDeposit"            DECIMAL(14, 2) NOT NULL,
  "newRevShare"           DECIMAL(14, 2) NOT NULL,
  "newCpaQualified"       INTEGER NOT NULL,
  "newCpaValue"           DECIMAL(14, 2) NOT NULL,
  "newTotalCommission"    DECIMAL(14, 2) NOT NULL,

  CONSTRAINT "affiliate_data_change_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "affiliate_data_change_logs_campaign_house_date_changedAt_idx"
  ON "affiliate_data_change_logs" ("campaignId", "bettingHouse", "date", "changedAt");

CREATE INDEX "affiliate_data_change_logs_bettingHouse_changedAt_idx"
  ON "affiliate_data_change_logs" ("bettingHouse", "changedAt");

CREATE INDEX "affiliate_data_change_logs_syncLogId_idx"
  ON "affiliate_data_change_logs" ("syncLogId");

-- DropIndex
DROP INDEX "affiliate_links_campaignId_bettingHouse_key";

-- AlterTable
ALTER TABLE "login_modals" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "support_messages" ADD COLUMN     "editedAt" TIMESTAMP(3);

-- RenameIndex
ALTER INDEX "affiliate_data_change_logs_campaign_house_date_changedAt_idx" RENAME TO "affiliate_data_change_logs_campaignId_bettingHouse_date_cha_idx";

-- RenameIndex
ALTER INDEX "uq_owner_external" RENAME TO "users_referredById_externalId_key";

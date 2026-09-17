import { Prisma } from '@prisma/client';

/**
 * Snapshot of the balance-relevant fields on an affiliate_data row.
 * Used to detect material change before writing to affiliate_data_change_logs.
 */
export interface AffiliateDataValues {
  clicks: number;
  registrations: number;
  ftds: number;
  qftd: number;
  deposit: Prisma.Decimal | number;
  netPl: Prisma.Decimal | number | null;
  withdrawalTotal: Prisma.Decimal | number | null;
  volume: Prisma.Decimal | number | null;
  revShare: Prisma.Decimal | number;
  cpaQualified: number;
  cpaValue: Prisma.Decimal | number;
  totalCommission: Prisma.Decimal | number;
}

export interface AffiliateDataKey {
  campaignId: string;
  bettingHouse: string;
  campaignName: string;
  utmCampaign: string;
  date: Date;
}

const toNumber = (v: Prisma.Decimal | number): number =>
  typeof v === 'number' ? v : v.toNumber();

const toDecimal = (v: Prisma.Decimal | number): Prisma.Decimal =>
  v instanceof Prisma.Decimal ? v : new Prisma.Decimal(v);

const nullableToNumber = (v: Prisma.Decimal | number | null): number | null =>
  v === null ? null : toNumber(v);

const nullableToDecimal = (
  v: Prisma.Decimal | number | null,
): Prisma.Decimal | null => (v === null ? null : toDecimal(v));

/**
 * Material = affects DashboardBalanceService.getBalance().
 * Pure clicks/registrations updates are skipped to keep the log bounded
 * (sync churns thousands of those per day with no balance impact).
 */
export function isMaterialChange(
  prev: AffiliateDataValues | null,
  next: AffiliateDataValues,
): boolean {
  if (!prev) return true;
  return (
    prev.cpaQualified !== next.cpaQualified ||
    prev.qftd !== next.qftd ||
    prev.ftds !== next.ftds ||
    toNumber(prev.cpaValue) !== toNumber(next.cpaValue) ||
    toNumber(prev.totalCommission) !== toNumber(next.totalCommission) ||
    toNumber(prev.deposit) !== toNumber(next.deposit) ||
    toNumber(prev.revShare) !== toNumber(next.revShare) ||
    nullableToNumber(prev.netPl) !== nullableToNumber(next.netPl) ||
    nullableToNumber(prev.withdrawalTotal) !==
      nullableToNumber(next.withdrawalTotal) ||
    nullableToNumber(prev.volume) !== nullableToNumber(next.volume)
  );
}

/**
 * Build the data payload for affiliate_data_change_logs.create().
 * `affiliateDataId` is the current row id (post-upsert) so the log can be
 * joined back if the row still exists. `prev=null` means INSERT.
 */
export function buildChangeLogData(args: {
  key: AffiliateDataKey;
  affiliateDataId: string | null;
  prev: AffiliateDataValues | null;
  next: AffiliateDataValues;
  source: string;
  syncLogId?: string | null;
}): Prisma.AffiliateDataChangeLogUncheckedCreateInput {
  const { key, affiliateDataId, prev, next, source, syncLogId } = args;
  return {
    affiliateDataId,
    campaignId: key.campaignId,
    bettingHouse: key.bettingHouse,
    campaignName: key.campaignName,
    utmCampaign: key.utmCampaign,
    date: key.date,
    changeType: prev ? 'UPDATE' : 'INSERT',
    source,
    syncLogId: syncLogId ?? null,
    prevClicks: prev?.clicks ?? null,
    prevRegistrations: prev?.registrations ?? null,
    prevFtds: prev?.ftds ?? null,
    prevQftd: prev?.qftd ?? null,
    prevDeposit: prev ? toDecimal(prev.deposit) : null,
    prevNetPl: prev ? nullableToDecimal(prev.netPl) : null,
    prevWithdrawalTotal: prev ? nullableToDecimal(prev.withdrawalTotal) : null,
    prevVolume: prev ? nullableToDecimal(prev.volume) : null,
    prevRevShare: prev ? toDecimal(prev.revShare) : null,
    prevCpaQualified: prev?.cpaQualified ?? null,
    prevCpaValue: prev ? toDecimal(prev.cpaValue) : null,
    prevTotalCommission: prev ? toDecimal(prev.totalCommission) : null,
    newClicks: next.clicks,
    newRegistrations: next.registrations,
    newFtds: next.ftds,
    newQftd: next.qftd,
    newDeposit: toDecimal(next.deposit),
    newNetPl: nullableToDecimal(next.netPl),
    newWithdrawalTotal: nullableToDecimal(next.withdrawalTotal),
    newVolume: nullableToDecimal(next.volume),
    newRevShare: toDecimal(next.revShare),
    newCpaQualified: next.cpaQualified,
    newCpaValue: toDecimal(next.cpaValue),
    newTotalCommission: toDecimal(next.totalCommission),
  };
}

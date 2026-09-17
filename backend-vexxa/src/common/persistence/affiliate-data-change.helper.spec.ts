import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  buildChangeLogData,
  isMaterialChange,
  type AffiliateDataValues,
} from './affiliate-data-change.helper.js';

const values = (
  overrides: Partial<AffiliateDataValues> = {},
): AffiliateDataValues => ({
  clicks: 1,
  registrations: 1,
  ftds: 1,
  qftd: 1,
  deposit: new Prisma.Decimal(10),
  revShare: new Prisma.Decimal(2),
  cpaQualified: 1,
  cpaValue: new Prisma.Decimal(40),
  totalCommission: new Prisma.Decimal(42),
  netPl: new Prisma.Decimal('100.00'),
  withdrawalTotal: new Prisma.Decimal('30.00'),
  volume: new Prisma.Decimal('500.00'),
  ...overrides,
});

describe('affiliate data Pinbet change history', () => {
  it('treats a Net P&L change as material', () => {
    expect(
      isMaterialChange(
        values(),
        values({ netPl: new Prisma.Decimal('100.01') }),
      ),
    ).toBe(true);
  });

  it('writes previous and new Pinbet metrics to the change payload', () => {
    const data = buildChangeLogData({
      key: {
        campaignId: 'VALLEX0001',
        bettingHouse: 'pinbet-diario',
        campaignName: 'VALLEX0001',
        utmCampaign: 'Pinbet',
        date: new Date('2026-07-23T00:00:00.000Z'),
      },
      affiliateDataId: 'row-1',
      prev: values(),
      next: values({ netPl: new Prisma.Decimal('-68.26') }),
      source: 'smartico-api',
    });

    expect(data.prevNetPl?.toString()).toBe('100');
    expect(data.newNetPl?.toString()).toBe('-68.26');
    expect(data.newWithdrawalTotal?.toString()).toBe('30');
    expect(data.newVolume?.toString()).toBe('500');
  });
});

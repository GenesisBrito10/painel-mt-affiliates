import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../../prisma/prisma.service.js';
import { ZERO_METRICS } from '../../domain/types/dashboard.types.js';
import { DashboardPrismaRepository } from './dashboard.prisma-repository.js';

const filters = {
  campaignIds: ['Campaign::Telegram'],
  startDate: new Date('2026-07-28T00:00:00.000Z'),
  endDate: new Date('2026-07-28T23:59:59.999Z'),
};

const metricSums = {
  clicks: 1,
  registrations: 2,
  ftds: 3,
  qftd: 4,
  deposit: new Prisma.Decimal('99.97'),
  volume: new Prisma.Decimal('88.80'),
  revShare: new Prisma.Decimal(0),
  cpaValue: new Prisma.Decimal(60),
  cpaQualified: 4,
  totalCommission: new Prisma.Decimal(60),
};

describe('DashboardPrismaRepository operational metrics', () => {
  it('includes volume in zero and summary metrics', async () => {
    const prisma = {
      affiliateData: {
        aggregate: vi.fn().mockResolvedValue({ _sum: metricSums }),
      },
    };
    const repository = new DashboardPrismaRepository(
      prisma as unknown as PrismaService,
    );

    const result = await repository.aggregateSummary(filters);

    expect(ZERO_METRICS.volume).toBe(0);
    expect(result).toMatchObject({ deposit: 99.97, volume: 88.8 });
    expect(prisma.affiliateData.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        _sum: expect.objectContaining({ volume: true }),
      }),
    );
  });

  it('maps volume in daily metrics', async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          day: '2026-07-28',
          clicks: 1n,
          registrations: 2n,
          ftds: 3n,
          qftd: 4n,
          deposit: '99.97',
          volume: '88.8',
          rev_share: '0',
          cpa_value: '60',
          cpa_qualified: 4n,
          total_commission: '60',
        },
      ]),
    };
    const repository = new DashboardPrismaRepository(
      prisma as unknown as PrismaService,
    );

    await expect(repository.aggregateDaily(filters)).resolves.toEqual([
      expect.objectContaining({ deposit: 99.97, volume: 88.8 }),
    ]);
  });

  it('maps volume by campaign', async () => {
    const prisma = {
      affiliateData: {
        groupBy: vi.fn().mockResolvedValue([
          {
            campaignId: 'Campaign::Telegram',
            bettingHouse: 'sportingbet-diario',
            campaignName: 'Campaign::Telegram',
            _sum: metricSums,
          },
        ]),
      },
    };
    const repository = new DashboardPrismaRepository(
      prisma as unknown as PrismaService,
    );

    const result = await repository.aggregateByCampaign(filters);

    expect(result[0]).toMatchObject({ volume: 88.8 });
    expect(prisma.affiliateData.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        _sum: expect.objectContaining({ volume: true }),
      }),
    );
  });

  it('maps volume by day and house', async () => {
    const prisma = {
      affiliateData: {
        groupBy: vi.fn().mockResolvedValue([
          {
            date: new Date('2026-07-28T00:00:00.000Z'),
            bettingHouse: 'sportingbet-diario',
            _sum: metricSums,
          },
        ]),
      },
    };
    const repository = new DashboardPrismaRepository(
      prisma as unknown as PrismaService,
    );

    const result = await repository.aggregateDailyPerHouse(filters);

    expect(result[0]).toMatchObject({ volume: 88.8 });
    expect(prisma.affiliateData.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        _sum: expect.objectContaining({ volume: true }),
      }),
    );
  });

  it('maps volume in campaign ranking', async () => {
    const prisma = {
      affiliateData: {
        groupBy: vi.fn().mockResolvedValue([
          {
            campaignId: 'Campaign::Telegram',
            _sum: metricSums,
          },
        ]),
      },
    };
    const repository = new DashboardPrismaRepository(
      prisma as unknown as PrismaService,
    );

    const result = await repository.aggregateRanking(
      filters.campaignIds,
      filters.startDate,
      filters.endDate,
    );

    expect(result[0]?.metrics).toMatchObject({ volume: 88.8 });
    expect(prisma.affiliateData.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        _sum: expect.objectContaining({ volume: true }),
      }),
    );
  });

  it('includes volume in admin link performance', () => {
    const userControllerSource = readFileSync(
      join(process.cwd(), 'src/modules/user/infrastructure/user.controller.ts'),
      'utf8',
    );

    expect(userControllerSource).toContain('volume: true');
    expect(userControllerSource).toContain(
      'volume: row?._sum.volume?.toNumber() ?? 0',
    );
  });
});

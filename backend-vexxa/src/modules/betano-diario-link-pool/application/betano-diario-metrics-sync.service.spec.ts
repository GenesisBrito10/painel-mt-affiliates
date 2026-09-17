import { Prisma, SyncMode } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { BetanoDiarioMetricsSyncService } from './betano-diario-metrics-sync.service.js';

const metricRow = {
  tab: '03/09/2026',
  rowIndex: 3,
  date: new Date('2026-09-03T00:00:00.000Z'),
  link: 'https://kg-br.com/C.ashx?siteid=52769&c=VALLEX101',
  campaignId: '52769-VALLEX101',
  affiliateId: '52769',
  clicks: 3,
  registrations: 2,
  ftds: 1,
  deposit: 20,
  cpaQualified: 2,
};

function makeService(
  overrides: { paused?: boolean; links?: unknown[]; previous?: unknown } = {},
) {
  const affiliateDataUpsert = vi.fn().mockResolvedValue({
    id: 'data-1',
    createdAt: new Date('2026-09-03T12:00:00.000Z'),
    updatedAt: new Date('2026-09-03T12:00:00.000Z'),
  });
  const syncLogUpdate = vi.fn().mockResolvedValue({});
  const prisma = {
    bettingHouse: {
      findUnique: vi.fn().mockResolvedValue({
        active: true,
        syncMode: SyncMode.AUTO,
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    affiliateLink: {
      findMany: vi.fn().mockResolvedValue(
        overrides.links ?? [
          {
            campaignId: metricRow.campaignId,
            cpa: new Prisma.Decimal(60),
          },
        ],
      ),
    },
    affiliateData: {
      findUnique: vi.fn().mockResolvedValue(overrides.previous ?? null),
      upsert: affiliateDataUpsert,
    },
    affiliateDataChangeLog: { create: vi.fn().mockResolvedValue({}) },
    syncLog: {
      create: vi.fn().mockResolvedValue({ id: 'sync-1' }),
      update: syncLogUpdate,
    },
  };
  const sheet = {
    readMetrics: vi.fn().mockResolvedValue({
      tabs: ['03/09/2026'],
      rows: [metricRow],
      issues: [],
    }),
  };
  const settings = {
    get: vi.fn().mockResolvedValue(overrides.paused ? 'true' : 'false'),
  };
  const redis = {
    set: vi.fn().mockResolvedValue('OK'),
    eval: vi.fn().mockResolvedValue(1),
  };
  const webhook = {
    emitAffiliateDataSynced: vi.fn().mockResolvedValue(undefined),
  };
  const service = new BetanoDiarioMetricsSyncService(
    prisma as never,
    sheet as never,
    settings as never,
    webhook as never,
    redis as never,
  );
  return {
    service,
    prisma,
    sheet,
    redis,
    webhook,
    affiliateDataUpsert,
    syncLogUpdate,
  };
}

describe('BetanoDiarioMetricsSyncService', () => {
  it('persists qualified CPA using the contracted active-link rate', async () => {
    const { service, affiliateDataUpsert, prisma, webhook, syncLogUpdate } =
      makeService();

    await service.sync('test');

    const upsertCall: unknown = affiliateDataUpsert.mock.calls[0]?.[0];
    const data = (upsertCall as { create?: unknown } | undefined)?.create;
    expect(data).toMatchObject({
      affiliateId: '52769',
      campaignId: '52769-VALLEX101',
      bettingHouse: 'betano-diario',
      campaignName: '52769-VALLEX101',
      utmCampaign: 'sheet',
      clicks: 3,
      registrations: 2,
      ftds: 1,
      qftd: 2,
      deposit: 20,
      cpaQualified: 2,
      cpaValue: 120,
      revShare: 0,
      totalCommission: 120,
      source: 'betano-diario-sheet',
    });
    expect(prisma.affiliateDataChangeLog.create).toHaveBeenCalledOnce();
    const syncLogCall: unknown = syncLogUpdate.mock.calls[0]?.[0];
    expect(syncLogCall).toMatchObject({
      data: {
        status: 'SUCCESS',
        inserted: 1,
        updated: 0,
        errors: 0,
      },
    });
    const webhookCall: unknown =
      webhook.emitAffiliateDataSynced.mock.calls[0]?.[0];
    expect(webhookCall).toMatchObject({
      houseSlug: 'betano-diario',
      dates: ['2026-09-03'],
      rowsUpserted: 1,
    });
  });

  it('skips metric rows that do not map to a real active link', async () => {
    const { service, affiliateDataUpsert, syncLogUpdate } = makeService({
      links: [],
    });

    await service.sync('test');

    expect(affiliateDataUpsert).not.toHaveBeenCalled();
    const syncLogCall: unknown = syncLogUpdate.mock.calls[0]?.[0];
    expect(syncLogCall).toMatchObject({
      data: { errors: 1, totalRecords: 0 },
    });
  });

  it('does nothing while the global sync switch is paused', async () => {
    const { service, sheet, redis } = makeService({ paused: true });

    await service.sync('test');

    expect(redis.set).not.toHaveBeenCalled();
    expect(sheet.readMetrics).not.toHaveBeenCalled();
  });

  it('does not report or emit an unchanged idempotent upsert', async () => {
    const previous = {
      clicks: 3,
      registrations: 2,
      ftds: 1,
      qftd: 2,
      deposit: new Prisma.Decimal(20),
      netPl: null,
      withdrawalTotal: null,
      volume: null,
      revShare: new Prisma.Decimal(0),
      cpaQualified: 2,
      cpaValue: new Prisma.Decimal(120),
      totalCommission: new Prisma.Decimal(120),
    };
    const { service, prisma, webhook, syncLogUpdate } = makeService({
      previous,
    });

    await service.sync('test');

    expect(prisma.affiliateDataChangeLog.create).not.toHaveBeenCalled();
    const syncLogCall: unknown = syncLogUpdate.mock.calls[0]?.[0];
    expect(syncLogCall).toMatchObject({
      data: {
        inserted: 0,
        updated: 0,
        totalRecords: 1,
      },
    });
    expect(webhook.emitAffiliateDataSynced).not.toHaveBeenCalled();
  });
});

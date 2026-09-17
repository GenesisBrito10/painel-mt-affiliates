import { describe, it, expect, vi } from 'vitest';
import { DashboardService } from './dashboard.service.js';
import { UserRole } from '@prisma/client';

const JWT = { sub: 'user-1', email: '', role: UserRole.AFFILIATE };

function makeRepo() {
  return {
    aggregateSummary: vi.fn().mockResolvedValue({}),
    aggregateDaily: vi.fn().mockResolvedValue([]),
    aggregateByCampaign: vi.fn().mockResolvedValue([]),
    aggregateDailyPerHouse: vi.fn().mockResolvedValue([]),
    getDistinctAffiliates: vi.fn(),
    getDistinctCampaigns: vi.fn(),
    getDistinctPanels: vi.fn(),
    getSyncedDays: vi.fn(),
    aggregateRanking: vi.fn(),
  };
}
function makeAccess(all: string[]) {
  return {
    resolveAccessContext: vi.fn().mockResolvedValue({
      ownCampaignIds: all,
      networkCampaignIds: [],
      allCampaignIds: all,
      isAdmin: false,
    }),
    resolveCampaignIdsForScope: vi.fn().mockReturnValue(all),
    collectNetworkCampaignIds: vi.fn().mockResolvedValue([]),
  };
}
const settings = {
  getMany: vi
    .fn()
    .mockResolvedValue(new Map([['withdrawal_block_active', 'false']])),
};
function makePrisma(diarioCamps: string[]) {
  return {
    // Sem settings de balance_cutover_date_* → buildCampaignCutover é no-op e não
    // consulta affiliateLink, preservando as asserções de remapeamento abaixo.
    setting: { findMany: vi.fn().mockResolvedValue([]) },
    affiliateLink: {
      findMany: vi
        .fn()
        .mockResolvedValue(diarioCamps.map((campaignId) => ({ campaignId }))),
    },
  };
}

describe('DashboardService — shared-account house alias', () => {
  it('remaps esportiva-diario -> esportivabet and scopes to diario campaigns (getSummary)', async () => {
    const repo = makeRepo();
    const prisma = makePrisma(['diario-camp']);
    const svc = new DashboardService(
      repo as any,
      makeAccess(['diario-camp', 'espbet-camp']) as any,
      settings as any,
      prisma as any,
    );

    await svc.getSummary(JWT, { bettingHouse: 'esportiva-diario' } as any);

    // buscou as campanhas do LINK esportiva-diario
    expect(prisma.affiliateLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          bettingHouse: 'esportiva-diario',
          deletedAt: null,
        }),
      }),
    );
    // agregou lendo a casa-FONTE, escopado so a campanha do diario
    expect(repo.aggregateSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        bettingHouse: 'esportivabet',
        campaignIds: ['diario-camp'],
      }),
    );
  });

  it('remaps sportingbet-diario to the shared sportingbet data source', async () => {
    const repo = makeRepo();
    const prisma = makePrisma(['daily-campaign']);
    const svc = new DashboardService(
      repo as any,
      makeAccess(['daily-campaign', 'monthly-campaign']) as any,
      settings as any,
      prisma as any,
    );

    await svc.getSummary(JWT, { bettingHouse: 'sportingbet-diario' } as any);

    expect(repo.aggregateSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        bettingHouse: 'sportingbet',
        campaignIds: ['daily-campaign'],
      }),
    );
  });

  it('leaves a non-aliased house untouched (superbet)', async () => {
    const repo = makeRepo();
    const prisma = makePrisma([]);
    const svc = new DashboardService(
      repo as any,
      makeAccess(['a', 'b']) as any,
      settings as any,
      prisma as any,
    );

    await svc.getSummary(JWT, { bettingHouse: 'superbet' } as any);

    // casa nao-aliased: nao consulta links de remapeamento
    expect(prisma.affiliateLink.findMany).not.toHaveBeenCalled();
    expect(repo.aggregateSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        bettingHouse: 'superbet',
        campaignIds: ['a', 'b'],
      }),
    );
  });

  it('reads Betano Diario from its own isolated metrics bucket', async () => {
    const repo = makeRepo();
    const prisma = makePrisma([]);
    const svc = new DashboardService(
      repo as any,
      makeAccess(['betano-diario-camp']) as any,
      settings as any,
      prisma as any,
    );

    await svc.getSummary(JWT, { bettingHouse: 'betano-diario' } as any);

    expect(prisma.affiliateLink.findMany).not.toHaveBeenCalled();
    expect(repo.aggregateSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        bettingHouse: 'betano-diario',
        campaignIds: ['betano-diario-camp'],
      }),
    );
  });

  it('injeta campaignCutover quando a casa tem balance_cutover_date (esconde dados pre-cutover no dashboard)', async () => {
    const repo = makeRepo();
    const prisma = {
      setting: {
        findMany: vi.fn().mockResolvedValue([
          {
            key: 'balance_cutover_date_esportiva-diario',
            value: '2026-07-14',
          },
        ]),
      },
      affiliateLink: {
        findMany: vi
          .fn()
          // 1a chamada: resolveHouseFilter (remap). 2a: buildCampaignCutover.
          .mockResolvedValueOnce([{ campaignId: 'diario-camp' }])
          .mockResolvedValueOnce([
            { campaignId: 'diario-camp', bettingHouse: 'esportiva-diario' },
          ]),
      },
    };
    const svc = new DashboardService(
      repo as any,
      makeAccess(['diario-camp']) as any,
      settings as any,
      prisma as any,
    );

    await svc.getSummary(JWT, { bettingHouse: 'esportiva-diario' } as any);

    const filters = repo.aggregateSummary.mock.calls[0][0];
    expect(filters.campaignCutover).toBeInstanceOf(Map);
    expect(filters.campaignCutover.get('diario-camp')).toEqual(
      new Date('2026-07-14T00:00:00.000Z'),
    );
  });
});

describe('DashboardService — operational metrics', () => {
  it('subtracts own betting volume from network daily metrics', async () => {
    const repo = makeRepo();
    repo.aggregateDaily
      .mockResolvedValueOnce([
        {
          date: '2026-07-28',
          clicks: 10,
          registrations: 8,
          ftds: 6,
          qftd: 4,
          deposit: 100,
          volume: 250,
          revShare: 0,
          cpaValue: 240,
          cpaQualified: 4,
          totalCommission: 240,
        },
      ])
      .mockResolvedValueOnce([
        {
          date: '2026-07-28',
          clicks: 2,
          registrations: 1,
          ftds: 1,
          qftd: 1,
          deposit: 25,
          volume: 70,
          revShare: 0,
          cpaValue: 60,
          cpaQualified: 1,
          totalCommission: 60,
        },
      ]);
    const access = {
      resolveAccessContext: vi.fn().mockResolvedValue({
        ownCampaignIds: ['mine'],
        networkCampaignIds: ['network'],
        allCampaignIds: ['mine', 'network'],
        isAdmin: false,
      }),
      resolveCampaignIdsForScope: vi.fn((_context: unknown, scope: string) =>
        scope === 'mine' ? ['mine'] : ['mine', 'network'],
      ),
      collectNetworkCampaignIds: vi.fn().mockResolvedValue([]),
    };
    const svc = new DashboardService(
      repo as any,
      access as any,
      settings as any,
      makePrisma([]) as any,
    );

    const result = await svc.getDaily(JWT, { scope: 'network' } as any);

    expect(result.networkData[0]).toMatchObject({
      deposit: 75,
      volume: 180,
    });
  });
});

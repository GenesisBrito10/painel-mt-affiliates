import { Prisma, UserRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { LinkRequestService } from './link-request.service.js';

const snapshot = {
  from: new Date('2026-08-05T00:00:00Z'),
  to: new Date('2026-09-03T23:59:59.999Z'),
  windowDays: 30,
  missingSuperbetLink: false,
  sumQualifiedFtd: 20,
  sumCpaQualified: 20,
  sumDeposit: 2_000,
  sumFtds: 20,
  avgDepositPerFtd: 100,
};

function deal(id: string, name: string) {
  return {
    id,
    name,
    bettingHouseSlug: 'superbet',
    cpa: new Prisma.Decimal(0),
    revshare: new Prisma.Decimal(0),
    baseline: new Prisma.Decimal(70),
    minAvgDepositPerFtd: new Prisma.Decimal(80),
    minQualifiedFtd: 15,
    exclusive: false,
    featured: true,
    newArrival: true,
    sortOrder: 7,
    logoUrl: '',
    conditionsText: '',
    paymentNotes: '',
    trafficSources: [],
    revenueType: '',
    kind: 'LINK',
    formSchema: null,
    createdAt:
      id === 'deal-antiga'
        ? new Date('2026-04-25T00:00:00Z')
        : new Date('2026-08-24T00:00:00Z'),
    bettingHouse: { name: 'Superbet' },
  };
}

function makeService(
  requests = [
    {
      dealId: 'deal-antiga' as string | null,
      bettingHouseSlug: 'superbet',
      status: 'FULFILLED',
    },
  ],
) {
  const linkRequestFindMany = vi.fn().mockResolvedValue(requests);
  const eligibility = {
    getSnapshot: vi.fn().mockResolvedValue(snapshot),
    evaluate: vi.fn().mockReturnValue({
      ...snapshot,
      eligible: true,
      required: false,
      reasons: [],
      metricsHouseSlug: 'superbet',
      minAvgDepositPerFtd: 80,
      minQualifiedFtd: 15,
    }),
  };
  const service = Object.create(
    LinkRequestService.prototype,
  ) as LinkRequestService;

  Object.assign(service as any, {
    prisma: {
      user: {
        findUnique: vi.fn().mockResolvedValue({
          role: UserRole.AFFILIATE,
          exclusiveDealsAccess: false,
        }),
      },
      deal: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            deal('deal-antiga', 'Superbet'),
            deal('deal-nova', 'Superbet Nova'),
          ]),
      },
      linkRequest: { findMany: linkRequestFindMany },
      affiliateLink: { findMany: vi.fn().mockResolvedValue([]) },
    },
    eligibility,
  });

  return { service, linkRequestFindMany, eligibility };
}

describe('LinkRequestService.listDeals', () => {
  it('keeps request status isolated by deal when one house has multiple deals', async () => {
    const { service, linkRequestFindMany } = makeService();

    const result = await service.listDeals('user-1');

    expect(linkRequestFindMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      select: { dealId: true, bettingHouseSlug: true, status: true },
    });
    expect(result.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'deal-antiga', userStatus: 'FULFILLED' }),
        expect.objectContaining({ id: 'deal-nova', userStatus: null }),
      ]),
    );
  });

  it('associates a legacy request without dealId only with the oldest house deal', async () => {
    const { service } = makeService([
      {
        dealId: null,
        bettingHouseSlug: 'superbet',
        status: 'FULFILLED',
      },
    ]);

    const result = await service.listDeals('user-1');

    expect(result.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'deal-antiga', userStatus: 'FULFILLED' }),
        expect.objectContaining({ id: 'deal-nova', userStatus: null }),
      ]),
    );
  });

  it('shows Betano Diario eligibility as 10 Superbet CPAs without a Superbet average-deposit gate', async () => {
    const { service, eligibility } = makeService([]);
    const prisma = (service as any).prisma;
    prisma.deal.findMany.mockResolvedValue([
      {
        ...deal('betano-diario-deal', 'Betano Diário'),
        bettingHouseSlug: 'betano-diario',
        minAvgDepositPerFtd: new Prisma.Decimal(20),
        minQualifiedFtd: 10,
        bettingHouse: { name: 'Betano Diário' },
      },
    ]);
    eligibility.evaluate.mockReturnValue({
      ...snapshot,
      eligible: true,
      required: true,
      reasons: [],
      metricsHouseSlug: 'superbet',
      minAvgDepositPerFtd: 0,
      minQualifiedFtd: 10,
    });

    const result = await service.listDeals('user-1');

    expect(eligibility.evaluate).toHaveBeenCalledWith(snapshot, 0, 10);
    expect(result.data[0]?.eligibility).toMatchObject({
      required: true,
      minQualifiedFtd: 10,
      minAvgDepositPerFtd: 0,
      windowDays: 30,
    });
  });
});

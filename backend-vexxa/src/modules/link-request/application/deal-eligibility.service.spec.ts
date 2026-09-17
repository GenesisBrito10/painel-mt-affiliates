import { LinkSource } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DealEligibilityService } from './deal-eligibility.service.js';
import { isDealEligibilityRequired } from '../domain/types/link-request.types.js';

function makeService(options: {
  campaigns?: Array<{ campaignId: string; affiliateId: string }>;
  cpaQualified?: number;
}) {
  const prisma = {
    affiliateLink: {
      findMany: vi.fn().mockResolvedValue(options.campaigns ?? []),
    },
    affiliateData: {
      aggregate: vi.fn().mockResolvedValue({
        _sum: {
          cpaQualified: options.cpaQualified ?? 0,
          deposit: 0,
          ftds: 0,
        },
      }),
    },
  };
  const settings = { getMany: vi.fn().mockResolvedValue(new Map()) };
  return {
    service: new DealEligibilityService(prisma as never, settings as never),
    prisma,
  };
}

describe('DealEligibilityService — Betano Diario Superbet gate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T15:00:00.000Z'));
  });

  afterEach(() => vi.useRealTimers());

  it('enables eligibility only for a new Betano Diario link request', () => {
    expect(isDealEligibilityRequired('betano-diario', false)).toBe(true);
    expect(isDealEligibilityRequired('betano-diario', true)).toBe(false);
    expect(isDealEligibilityRequired('betano', false)).toBe(false);
    expect(isDealEligibilityRequired('superbet', false)).toBe(false);
  });

  it('sums qualified CPA from every real active Superbet campaign over 30 Sao Paulo days', async () => {
    const { service, prisma } = makeService({
      campaigns: [
        { campaignId: 'super-1', affiliateId: 'a1' },
        { campaignId: 'super-2', affiliateId: 'a2' },
      ],
      cpaQualified: 10,
    });

    const snapshot = await service.getSnapshot('user-1');
    const result = service.evaluate(snapshot, 0, 10);

    expect(prisma.affiliateLink.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        bettingHouse: 'superbet',
        deletedAt: null,
        source: { in: [LinkSource.POOL, LinkSource.MANUAL] },
      },
      select: { campaignId: true, affiliateId: true },
    });
    expect(prisma.affiliateData.aggregate).toHaveBeenCalledWith({
      where: {
        bettingHouse: 'superbet',
        date: {
          gte: new Date('2026-08-05T00:00:00.000Z'),
          lte: new Date('2026-09-03T23:59:59.999Z'),
        },
        campaignId: { in: ['super-1', 'super-2'] },
      },
      _sum: { cpaQualified: true, deposit: true, ftds: true },
    });
    expect(result).toMatchObject({
      eligible: true,
      windowDays: 30,
      sumCpaQualified: 10,
      minQualifiedFtd: 10,
      minAvgDepositPerFtd: 0,
    });
  });

  it('fails below 10 and treats no real Superbet link as missing', async () => {
    const withNine = makeService({
      campaigns: [{ campaignId: 'super-1', affiliateId: 'a1' }],
      cpaQualified: 9,
    }).service;
    const noLinks = makeService({ campaigns: [] }).service;

    const below = withNine.evaluate(await withNine.getSnapshot('u'), 0, 10);
    const missing = noLinks.evaluate(await noLinks.getSnapshot('u'), 0, 10);

    expect(below.eligible).toBe(false);
    expect(below.reasons[0]).toContain('9');
    expect(missing).toMatchObject({ eligible: false, sumCpaQualified: 0 });
    expect(missing.reasons[0]).toContain('Superbet');
  });
});

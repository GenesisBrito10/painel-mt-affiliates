import { LinkRequestStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { BetanoDiarioAssignmentService } from './betano-diario-assignment.service.js';

function makeService(link: string) {
  const affiliateLinkCreate = vi.fn().mockResolvedValue({ id: 'link-1' });
  const affiliateLinkFindFirst = vi
    .fn()
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(null);
  const tx = {
    affiliateLink: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: affiliateLinkCreate,
      update: vi.fn(),
    },
    linkRequest: { update: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    linkRequest: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'request-1',
        status: LinkRequestStatus.PENDING,
        userId: 'user-1',
      }),
    },
    affiliateLink: { findFirst: affiliateLinkFindFirst },
    user: {
      findUnique: vi.fn().mockResolvedValue({ email: 'user@example.com' }),
    },
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) =>
      Promise.resolve(callback(tx)),
    ),
  };
  const sheet = {
    readPool: vi
      .fn()
      .mockResolvedValue([{ rowIndex: 2, link, status: '', email: '' }]),
    markRowUsed: vi.fn().mockResolvedValue(undefined),
  };
  const service = new BetanoDiarioAssignmentService(
    { notifyApproved: vi.fn().mockResolvedValue(undefined) } as never,
    prisma as never,
    sheet as never,
    { create: vi.fn().mockResolvedValue(undefined) } as never,
    {
      set: vi.fn().mockResolvedValue('OK'),
      eval: vi.fn().mockResolvedValue(1),
    } as never,
  );
  return { service, affiliateLinkCreate, prisma };
}

describe('BetanoDiarioAssignmentService', () => {
  it('persists the original pool URL with the extracted campaign identity', async () => {
    const link = 'https://kg-br.com/C.ashx?siteid=52769&c=VALLEX101';
    const { service, affiliateLinkCreate } = makeService(link);

    const result = await service.tryAssign('user-1', 'request-1', {
      defaultCommission: { cpa: 60, revshare: 0 },
    });

    expect(result).toMatchObject({
      assigned: true,
      campaignId: '52769-VALLEX101',
    });
    expect(affiliateLinkCreate).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        affiliateId: '52769',
        campaignId: '52769-VALLEX101',
        bettingHouse: 'betano-diario',
        userLink: link,
        cpa: 60,
        revshare: 0,
      },
    });
  });

  it('does not consume a malformed link', async () => {
    const { service, affiliateLinkCreate } = makeService(
      'https://example.com/no-id',
    );
    const result = await service.tryAssign('user-1', 'request-1', {
      defaultCommission: { cpa: 60, revshare: 0 },
    });
    expect(result).toEqual({ assigned: false, reason: 'all_conflicts' });
    expect(affiliateLinkCreate).not.toHaveBeenCalled();
  });
});

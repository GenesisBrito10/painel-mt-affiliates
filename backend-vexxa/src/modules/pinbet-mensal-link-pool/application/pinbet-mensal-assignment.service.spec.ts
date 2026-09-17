import { describe, expect, it, vi } from 'vitest';
import { LinkRequestStatus } from '@prisma/client';
import { PinbetMensalAssignmentService } from './pinbet-mensal-assignment.service.js';

describe('PinbetMensalAssignmentService', () => {
  it('creates an afp2 link instead of overwriting the migrated afp1 link', async () => {
    const tx = {
      affiliateLink: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'new-afp2' }),
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
      affiliateLink: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ email: 'user@example.com' }),
      },
      $transaction: vi.fn(async (callback) => callback(tx)),
    };
    const service = new PinbetMensalAssignmentService(
      { notifyApproved: vi.fn() } as never,
      prisma as never,
      {} as never,
      { create: vi.fn() } as never,
      {
        set: vi.fn().mockResolvedValue('OK'),
        eval: vi.fn().mockResolvedValue(1),
      } as never,
    );

    const result = await service.tryAssign('user-1', 'request-1', {
      prefetchedRows: [
        {
          rowIndex: 2,
          identificacao: 'Mensal',
          code: 'MJM0999',
          link: 'https://pin.test/?afp2=MJM0999',
          status: '',
          email: '',
        },
      ],
      deferSheetWrite: true,
      defaultCommission: { cpa: 55, revshare: 10 },
    });

    expect(result.assigned).toBe(true);
    expect(tx.affiliateLink.update).not.toHaveBeenCalled();
    expect(tx.affiliateLink.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        bettingHouse: 'pinbet-mensal',
        campaignId: 'MJM0999',
        linkType: 'afp2',
        cpa: 55,
        revshare: 10,
      }),
    });
  });
});

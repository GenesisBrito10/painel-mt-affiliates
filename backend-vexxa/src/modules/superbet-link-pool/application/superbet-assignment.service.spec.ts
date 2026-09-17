import { LinkRequestStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { SuperbetAssignmentService } from './superbet-assignment.service.js';
import type { SheetRow } from '../domain/superbet.types.js';

describe('SuperbetAssignmentService — deal snapshot commission', () => {
  it('sobrescreve o CPA antigo do vínculo com o snapshot do pedido', async () => {
    const rows: SheetRow[] = [
      {
        rowIndex: 2,
        link: 'https://wlsuperbet.adsrv.eacdn.com/C.ashx?btag=a_5565b_431c_&affid=662&siteid=5565&adid=431&c=MJM12',
        status: '',
        email: '',
      },
    ];
    const tx = {
      affiliateLink: {
        findFirst: vi.fn().mockResolvedValue({ id: 'existing-link' }),
        update: vi.fn().mockResolvedValue({ id: 'existing-link' }),
        create: vi.fn(),
      },
      linkRequest: {
        update: vi.fn().mockResolvedValue({}),
      },
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
          .mockResolvedValueOnce({ id: 'existing-link' })
          .mockResolvedValueOnce({ id: 'existing-link' })
          .mockResolvedValueOnce(null),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ email: 'user@example.com' }),
      },
      $transaction: vi
        .fn()
        .mockImplementation(
          async (callback: (client: typeof tx) => Promise<void>) =>
            callback(tx),
        ),
    };
    const service = new SuperbetAssignmentService(
      { notifyApproved: vi.fn().mockResolvedValue(undefined) } as never,
      prisma as never,
      {
        readPool: vi.fn(),
        markRowUsed: vi.fn().mockResolvedValue(undefined),
      } as never,
      { create: vi.fn().mockResolvedValue(undefined) } as never,
      {
        set: vi.fn().mockResolvedValue('OK'),
        eval: vi.fn().mockResolvedValue(1),
      } as never,
    );

    const result = await service.tryAssign('user-1', 'request-1', {
      prefetchedRows: rows,
      defaultCommission: { cpa: 100, revshare: 0 },
    });

    expect(result.assigned).toBe(true);
    const updateArg: unknown = tx.affiliateLink.update.mock.calls.at(-1)?.[0];
    expect(updateArg).toMatchObject({
      where: { id: 'existing-link' },
      data: {
        campaignId: '5565-MJM12',
        userLink: rows[0].link,
        cpa: 100,
        revshare: 0,
      },
    });
  });
});

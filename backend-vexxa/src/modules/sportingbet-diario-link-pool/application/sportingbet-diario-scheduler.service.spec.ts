import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { SportingbetDiarioSchedulerService } from './sportingbet-diario-scheduler.service.js';

describe('SportingbetDiarioSchedulerService', () => {
  it('does not read requests or sheet while the house is inactive', async () => {
    const prisma = {
      bettingHouse: {
        findUnique: vi.fn().mockResolvedValue({
          active: false,
          linkRule: { autoAssignEnabled: false },
        }),
      },
      linkRequest: { findMany: vi.fn() },
    };
    const sheetService = {
      readPool: vi.fn(),
      markRowsUsed: vi.fn(),
    };
    const service = new SportingbetDiarioSchedulerService(
      prisma as never,
      { tryAssign: vi.fn() } as never,
      sheetService as never,
      { checkPool: vi.fn() } as never,
      { set: vi.fn(), eval: vi.fn() } as never,
    );

    await service.backfillPending();

    expect(prisma.linkRequest.findMany).not.toHaveBeenCalled();
    expect(sheetService.readPool).not.toHaveBeenCalled();
  });

  it('processes oldest snapshotted requests when house and rule are active', async () => {
    const prisma = {
      bettingHouse: {
        findUnique: vi.fn().mockResolvedValue({
          active: true,
          linkRule: { autoAssignEnabled: true },
        }),
      },
      linkRequest: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'request-1',
            userId: 'user-1',
            resolvedCpa: new Prisma.Decimal(60),
            resolvedRevshare: new Prisma.Decimal(0),
          },
        ]),
      },
    };
    const rows = [
      {
        rowIndex: 2,
        affiliate: 'Bianca Rocha Lima',
        linkType: 'Telegram',
        link: 'https://daily/1',
        status: '',
        email: '',
      },
    ];
    const assignment = {
      tryAssign: vi.fn().mockResolvedValue({
        assigned: true,
        campaignId: 'BiancaRochaLima::Telegram',
        link: 'https://daily/1',
        rowIndex: 2,
        email: 'user@example.com',
      }),
    };
    const sheetService = {
      readPool: vi.fn().mockResolvedValue(rows),
      markRowsUsed: vi.fn().mockResolvedValue(undefined),
    };
    const service = new SportingbetDiarioSchedulerService(
      prisma as never,
      assignment as never,
      sheetService as never,
      { checkPool: vi.fn().mockResolvedValue(undefined) } as never,
      {
        set: vi.fn().mockResolvedValue('OK'),
        eval: vi.fn().mockResolvedValue(1),
      } as never,
    );

    await service.backfillPending();

    expect(prisma.linkRequest.findMany).toHaveBeenCalledWith({
      where: {
        bettingHouseSlug: 'sportingbet-diario',
        status: 'PENDING',
        resolvedCpa: { not: null },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
      select: {
        id: true,
        userId: true,
        resolvedCpa: true,
        resolvedRevshare: true,
      },
    });
    expect(assignment.tryAssign).toHaveBeenCalledWith('user-1', 'request-1', {
      prefetchedRows: rows,
      deferSheetWrite: true,
      defaultCommission: { cpa: 60, revshare: 0 },
    });
    expect(sheetService.markRowsUsed).toHaveBeenCalledWith([
      { rowIndex: 2, email: 'user@example.com' },
    ]);
  });
});

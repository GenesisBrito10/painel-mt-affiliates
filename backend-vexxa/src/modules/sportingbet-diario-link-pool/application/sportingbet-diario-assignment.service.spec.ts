import { LinkRequestStatus, LinkSource } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { SheetRow } from '../../sportingbet-link-pool/domain/sportingbet.types.js';
import { SportingbetDiarioAssignmentService } from './sportingbet-diario-assignment.service.js';

describe('SportingbetDiarioAssignmentService', () => {
  it('assigns the first daily row with typed identity and snapshot commission', async () => {
    const rows: SheetRow[] = [
      {
        rowIndex: 2,
        affiliate: 'Bianca Rocha Lima',
        linkType: 'Telegram',
        link: 'https://brsportingbet.net/registro17631',
        status: '',
        email: '',
      },
      {
        rowIndex: 3,
        affiliate: 'Vinícius Mendes Souza',
        linkType: 'Cadastro',
        link: 'https://brsportingbet.net/registro17626',
        status: '',
        email: '',
      },
    ];
    const tx = {
      linkRequest: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ status: LinkRequestStatus.PENDING }),
        update: vi.fn().mockResolvedValue({}),
      },
      affiliateLink: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'daily-link-1' }),
        update: vi.fn(),
      },
    };
    const prisma = {
      linkRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'daily-request-1',
          status: LinkRequestStatus.PENDING,
        }),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ email: 'daily@example.com' }),
      },
      affiliateLink: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
      },
      $transaction: vi
        .fn()
        .mockImplementation(
          async (callback: (client: typeof tx) => Promise<void>) =>
            callback(tx),
        ),
    };
    const sheetService = {
      readPool: vi.fn(),
      markRowUsed: vi.fn().mockResolvedValue(undefined),
    };
    const service = new SportingbetDiarioAssignmentService(
      { notifyApproved: vi.fn().mockResolvedValue(undefined) } as never,
      prisma as never,
      sheetService as never,
      { create: vi.fn().mockResolvedValue(undefined) } as never,
      {
        set: vi.fn().mockResolvedValue('OK'),
        eval: vi.fn().mockResolvedValue(1),
      } as never,
    );

    const result = await service.tryAssign('daily-user-1', 'daily-request-1', {
      prefetchedRows: rows,
      defaultCommission: { cpa: 60, revshare: 0 },
    });

    expect(result).toEqual({
      assigned: true,
      campaignId: 'BiancaRochaLima::Telegram',
      link: 'https://brsportingbet.net/registro17631',
      rowIndex: 2,
      email: 'daily@example.com',
    });
    expect(tx.affiliateLink.create).toHaveBeenCalledWith({
      data: {
        userId: 'daily-user-1',
        bettingHouse: 'sportingbet-diario',
        campaignId: 'BiancaRochaLima::Telegram',
        affiliateId: 'BiancaRochaLima',
        linkType: 'Telegram',
        userLink: 'https://brsportingbet.net/registro17631',
        source: LinkSource.POOL,
        cpa: 60,
        revshare: 0,
      },
    });
    expect(sheetService.markRowUsed).toHaveBeenCalledWith(
      2,
      'daily@example.com',
    );
    expect(rows[0]).toMatchObject({
      status: 'marcado',
      email: 'daily@example.com',
    });
    expect(rows[1]).toMatchObject({ status: '', email: '' });
  });

  it('does not mark a row when the request stops being pending inside the transaction', async () => {
    const rows: SheetRow[] = [
      {
        rowIndex: 2,
        affiliate: 'Bianca Rocha Lima',
        linkType: 'Telegram',
        link: 'https://brsportingbet.net/registro17631',
        status: '',
        email: '',
      },
    ];
    const tx = {
      linkRequest: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ status: LinkRequestStatus.FULFILLED }),
        update: vi.fn(),
      },
      affiliateLink: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    };
    const prisma = {
      linkRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'daily-request-race',
          status: LinkRequestStatus.PENDING,
        }),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ email: 'daily@example.com' }),
      },
      affiliateLink: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(null),
      },
      $transaction: vi
        .fn()
        .mockImplementation(
          async (callback: (client: typeof tx) => Promise<boolean>) =>
            callback(tx),
        ),
    };
    const sheetService = {
      markRowUsed: vi.fn(),
    };
    const service = new SportingbetDiarioAssignmentService(
      { notifyApproved: vi.fn() } as never,
      prisma as never,
      sheetService as never,
      { create: vi.fn() } as never,
      {
        set: vi.fn().mockResolvedValue('OK'),
        eval: vi.fn().mockResolvedValue(1),
      } as never,
    );

    const result = await service.tryAssign(
      'daily-user-race',
      'daily-request-race',
      { prefetchedRows: rows },
    );

    expect(result).toEqual({
      assigned: false,
      reason: 'already_fulfilled',
    });
    expect(sheetService.markRowUsed).not.toHaveBeenCalled();
    expect(tx.affiliateLink.create).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ status: '', email: '' });
  });
});

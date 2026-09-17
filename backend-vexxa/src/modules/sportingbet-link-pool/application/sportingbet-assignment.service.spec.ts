import { LinkRequestStatus, LinkSource } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { SportingbetAssignmentService } from './sportingbet-assignment.service.js';
import type { SheetRow } from '../domain/sportingbet.types.js';

describe('SportingbetAssignmentService', () => {
  it('assigns and persists exactly one typed row', async () => {
    const rows: SheetRow[] = [
      {
        rowIndex: 2,
        affiliate: 'Caio Fernandes Rocha Souza',
        linkType: 'Telegram',
        link: 'https://example.com/telegram',
        status: '',
        email: '',
      },
      {
        rowIndex: 3,
        affiliate: 'Caio Fernandes Rocha Souza',
        linkType: 'Instagram',
        link: 'https://example.com/instagram',
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
        create: vi.fn().mockResolvedValue({ id: 'link-1' }),
        update: vi.fn(),
      },
    };
    const prisma = {
      linkRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'request-1',
          status: LinkRequestStatus.PENDING,
        }),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ email: 'user@example.com' }),
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
    const notificationService = {
      create: vi.fn().mockResolvedValue(undefined),
    };
    const linkWebhook = {
      notifyApproved: vi.fn().mockResolvedValue(undefined),
    };
    const redis = {
      set: vi.fn().mockResolvedValue('OK'),
      eval: vi.fn().mockResolvedValue(1),
    };
    const service = new SportingbetAssignmentService(
      linkWebhook as never,
      prisma as never,
      sheetService as never,
      notificationService as never,
      redis as never,
    );

    const result = await service.tryAssign('user-1', 'request-1', {
      prefetchedRows: rows,
    });

    expect(result).toEqual({
      assigned: true,
      campaignId: 'CaioFernandesRochaSouza::Telegram',
      link: 'https://example.com/telegram',
      rowIndex: 2,
      email: 'user@example.com',
    });
    expect(tx.affiliateLink.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        bettingHouse: 'sportingbet',
        campaignId: 'CaioFernandesRochaSouza::Telegram',
        affiliateId: 'CaioFernandesRochaSouza',
        linkType: 'Telegram',
        userLink: 'https://example.com/telegram',
        source: LinkSource.POOL,
      },
    });
    const fulfilledAt = (
      tx.linkRequest.update.mock.calls[0]?.[0] as unknown as {
        data: { fulfilledAt: unknown };
      }
    ).data.fulfilledAt;
    expect(fulfilledAt).toBeInstanceOf(Date);
    expect(tx.linkRequest.update).toHaveBeenCalledWith({
      where: { id: 'request-1' },
      data: {
        status: LinkRequestStatus.FULFILLED,
        fulfilledAt,
        fulfilledByName: 'Sistema',
        adminNote: '',
        links: [{ label: 'Telegram', url: 'https://example.com/telegram' }],
      },
    });
    expect(rows[0]).toMatchObject({
      status: 'marcado',
      email: 'user@example.com',
    });
    expect(rows[1]).toMatchObject({ status: '', email: '' });
    expect(sheetService.markRowUsed).toHaveBeenCalledWith(
      2,
      'user@example.com',
    );
  });

  it('continues after the highest controlled row without filling old gaps', async () => {
    const rows: SheetRow[] = [
      {
        rowIndex: 2,
        affiliate: 'Lacuna Antiga',
        linkType: 'Cadastro',
        link: 'https://example.com/2',
        status: '',
        email: '',
      },
      {
        rowIndex: 12,
        affiliate: 'Já Usado',
        linkType: 'Instagram',
        link: 'https://example.com/12',
        status: 'marcado',
        email: 'old@example.com',
      },
      {
        rowIndex: 13,
        affiliate: 'Próximo Afiliado',
        linkType: 'Telegram',
        link: 'https://example.com/13',
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
        create: vi.fn().mockResolvedValue({ id: 'link-13' }),
        update: vi.fn(),
      },
    };
    const prisma = {
      linkRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'request-13',
          status: LinkRequestStatus.PENDING,
        }),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ email: 'user@example.com' }),
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
    const service = new SportingbetAssignmentService(
      { notifyApproved: vi.fn() } as never,
      prisma as never,
      sheetService as never,
      { create: vi.fn() } as never,
      {
        set: vi.fn().mockResolvedValue('OK'),
        eval: vi.fn().mockResolvedValue(1),
      } as never,
    );

    const result = await service.tryAssign('user-13', 'request-13', {
      prefetchedRows: rows,
    });

    expect(result).toMatchObject({ assigned: true, rowIndex: 13 });
    expect(sheetService.markRowUsed).toHaveBeenCalledWith(
      13,
      'user@example.com',
    );
    const created = tx.affiliateLink.create.mock.calls[0]?.[0] as unknown as {
      data: { campaignId: string };
    };
    expect(created.data.campaignId).toBe('PróximoAfiliado::Telegram');
  });

  it('reconciles the next conflicting row before assigning the following row', async () => {
    const rows: SheetRow[] = [
      {
        rowIndex: 12,
        affiliate: 'Anterior',
        linkType: 'Cadastro',
        link: 'https://example.com/12',
        status: 'marcado',
        email: 'old@example.com',
      },
      {
        rowIndex: 13,
        affiliate: 'Conflito',
        linkType: 'Instagram',
        link: 'https://example.com/13',
        status: '',
        email: '',
      },
      {
        rowIndex: 14,
        affiliate: 'Livre',
        linkType: 'Telegram',
        link: 'https://example.com/14',
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
        create: vi.fn().mockResolvedValue({ id: 'link-14' }),
        update: vi.fn(),
      },
    };
    const prisma = {
      linkRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'request-14',
          status: LinkRequestStatus.PENDING,
        }),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ email: 'new@example.com' }),
      },
      affiliateLink: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            userId: 'owner-13',
            user: { email: 'owner@example.com' },
          })
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
    const service = new SportingbetAssignmentService(
      { notifyApproved: vi.fn() } as never,
      prisma as never,
      sheetService as never,
      { create: vi.fn() } as never,
      {
        set: vi.fn().mockResolvedValue('OK'),
        eval: vi.fn().mockResolvedValue(1),
      } as never,
    );

    const result = await service.tryAssign('new-user', 'request-14', {
      prefetchedRows: rows,
    });

    expect(result).toMatchObject({ assigned: true, rowIndex: 14 });
    expect(sheetService.markRowUsed).toHaveBeenNthCalledWith(
      1,
      13,
      'owner@example.com',
    );
    expect(sheetService.markRowUsed).toHaveBeenNthCalledWith(
      2,
      14,
      'new@example.com',
    );
  });

  it('does not skip a conflicting row when sheet reconciliation fails', async () => {
    const rows: SheetRow[] = [
      {
        rowIndex: 13,
        affiliate: 'Conflito',
        linkType: 'Instagram',
        link: 'https://example.com/13',
        status: '',
        email: '',
      },
      {
        rowIndex: 14,
        affiliate: 'Não Pode Pular',
        linkType: 'Telegram',
        link: 'https://example.com/14',
        status: '',
        email: '',
      },
    ];
    const prisma = {
      linkRequest: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'request-fail',
          status: LinkRequestStatus.PENDING,
        }),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue({ email: 'new@example.com' }),
      },
      affiliateLink: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            userId: 'owner-13',
            user: { email: 'owner@example.com' },
          }),
      },
      $transaction: vi.fn(),
    };
    const sheetService = {
      readPool: vi.fn(),
      markRowUsed: vi.fn().mockRejectedValue(new Error('write failed')),
    };
    const service = new SportingbetAssignmentService(
      { notifyApproved: vi.fn() } as never,
      prisma as never,
      sheetService as never,
      { create: vi.fn() } as never,
      {
        set: vi.fn().mockResolvedValue('OK'),
        eval: vi.fn().mockResolvedValue(1),
      } as never,
    );

    const result = await service.tryAssign('new-user', 'request-fail', {
      prefetchedRows: rows,
    });

    expect(result).toEqual({
      assigned: false,
      reason: 'sheet_write_failed',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(rows[1]).toMatchObject({ status: '', email: '' });
  });
});

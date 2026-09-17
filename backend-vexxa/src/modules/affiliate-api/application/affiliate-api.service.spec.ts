import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AffiliateApiService } from './affiliate-api.service.js';

const decimal = (value: number) => ({ toNumber: () => value });

const makePrisma = () => ({
  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  affiliateApiToken: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  affiliateLink: {
    findMany: vi.fn(),
  },
  bettingHouse: {
    findMany: vi.fn(),
  },
  affiliateData: {
    groupBy: vi.fn(),
  },
  affiliateApiLinkRequestLog: {
    create: vi.fn().mockResolvedValue({ id: 'log-1' }),
  },
  $transaction: vi.fn(),
});

describe('AffiliateApiService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let linkRequest: { create: ReturnType<typeof vi.fn> };
  let withdrawal: {
    createForExternal: ReturnType<typeof vi.fn>;
    listForExternal: ReturnType<typeof vi.fn>;
    getForExternal: ReturnType<typeof vi.fn>;
    setStatusForExternal: ReturnType<typeof vi.fn>;
  };
  let balance: { getBalance: ReturnType<typeof vi.fn> };
  let service: AffiliateApiService;

  beforeEach(() => {
    prisma = makePrisma();
    linkRequest = { create: vi.fn() };
    withdrawal = {
      createForExternal: vi.fn(),
      listForExternal: vi.fn(),
      getForExternal: vi.fn(),
      setStatusForExternal: vi.fn(),
    };
    balance = { getBalance: vi.fn() };
    service = new AffiliateApiService(
      prisma as any,
      linkRequest as any,
      withdrawal as any,
      balance as any,
    );

    prisma.user.findUnique.mockResolvedValue({
      id: 'owner-id',
      name: 'Owner',
      email: 'owner@example.com',
      role: UserRole.AFFILIATE,
      active: true,
      deletedAt: null,
    });
    prisma.user.findMany
      .mockResolvedValueOnce([
        { id: 'child-id', name: 'Child', email: 'child@example.com' },
      ])
      .mockResolvedValueOnce([]);
  });

  it('rejects metrics for an affiliate outside the owner network', async () => {
    await expect(
      service.getMetrics('owner-id', {
        startDate: '2026-05-01',
        endDate: '2026-05-17',
        affiliateId: 'outsider-id',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.affiliateLink.findMany).not.toHaveBeenCalled();
  });

  it('returns only owner and network affiliate records', async () => {
    prisma.affiliateLink.findMany.mockResolvedValue([
      {
        userId: 'owner-id',
        campaignId: 'owner-campaign',
        bettingHouse: 'superbet',
      },
      {
        userId: 'child-id',
        campaignId: 'child-campaign',
        bettingHouse: 'hiperbet',
      },
    ]);
    prisma.bettingHouse.findMany.mockResolvedValue([
      { slug: 'superbet', name: 'Superbet' },
      { slug: 'hiperbet', name: 'Hiperbet' },
    ]);
    prisma.affiliateData.groupBy.mockResolvedValue([
      {
        campaignId: 'owner-campaign',
        bettingHouse: 'superbet',
        date: new Date('2026-05-10T00:00:00.000Z'),
        _sum: {
          clicks: 10,
          registrations: 3,
          ftds: 1,
          qftd: 1,
          deposit: decimal(100),
          revShare: decimal(20),
          cpaQualified: 1,
          cpaValue: decimal(50),
          totalCommission: decimal(70),
        },
      },
      {
        campaignId: 'child-campaign',
        bettingHouse: 'hiperbet',
        date: new Date('2026-05-10T00:00:00.000Z'),
        _sum: {
          clicks: 7,
          registrations: 2,
          ftds: 1,
          qftd: 1,
          deposit: decimal(80),
          revShare: decimal(10),
          cpaQualified: 1,
          cpaValue: decimal(40),
          totalCommission: decimal(50),
        },
      },
      {
        campaignId: 'outsider-campaign',
        bettingHouse: 'betnacional',
        date: new Date('2026-05-10T00:00:00.000Z'),
        _sum: {
          clicks: 999,
          registrations: 999,
          ftds: 999,
          qftd: 999,
          deposit: decimal(999),
          revShare: decimal(999),
          cpaQualified: 999,
          cpaValue: decimal(999),
          totalCommission: decimal(999),
        },
      },
    ]);

    const response = await service.getMetrics('owner-id', {
      startDate: '2026-05-01',
      endDate: '2026-05-17',
    });

    expect(prisma.affiliateLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: { in: ['owner-id', 'child-id'] },
        }),
      }),
    );
    expect(response.scope.includedAffiliateIds).toEqual([
      'owner-id',
      'child-id',
    ]);
    expect(response.records.map((record) => record.affiliateId).sort()).toEqual(
      ['child-id', 'owner-id'],
    );
    expect(response.byAffiliate.map((row) => row.affiliateId).sort()).toEqual([
      'child-id',
      'owner-id',
    ]);
    expect(response.summary.clicks).toBe(17);
  });

  it('creates an external requester user (by externalId) and skips deal eligibility', async () => {
    prisma.user.findUnique.mockReset();
    // assertAffiliate(owner) → owner; email-clash check → null
    prisma.user.findUnique
      .mockResolvedValueOnce({
        id: 'owner-id',
        role: UserRole.AFFILIATE,
        active: true,
        deletedAt: null,
      })
      .mockResolvedValueOnce(null);
    // ensureExternalRequester: no existing shadow user for (owner, externalId)
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'requester-id',
      email: 'cliente@example.com',
      name: 'Cliente Externo',
      referredById: 'owner-id',
    });
    linkRequest.create.mockResolvedValue({
      id: 'request-id',
      userId: 'requester-id',
      dealId: '8e67a3dd-07c5-4d91-98af-ac2dbef31960',
      bettingHouseSlug: 'superbet',
      message: 'Solicitacao externa',
      status: 'PENDING',
      createdAt: new Date('2026-06-10T00:00:00.000Z'),
    });

    const response = await service.createLinkRequestFromApi('owner-id', {
      externalUserId: 'panel-user-42',
      userEmail: ' Cliente@Example.com ',
      userName: ' Cliente Externo ',
      dealId: '8e67a3dd-07c5-4d91-98af-ac2dbef31960',
      bettingHouseSlug: 'SUPERBET',
      message: 'Solicitacao externa',
    });

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'cliente@example.com',
          name: 'Cliente Externo',
          role: UserRole.AFFILIATE,
          status: 'APPROVED',
          active: true,
          ageVerified: true,
          isExternal: true,
          externalId: 'panel-user-42',
          referredById: 'owner-id',
        }),
      }),
    );
    expect(linkRequest.create).toHaveBeenCalledWith(
      'requester-id',
      {
        dealId: '8e67a3dd-07c5-4d91-98af-ac2dbef31960',
        bettingHouseSlug: 'superbet',
        message: 'Solicitacao externa',
      },
      { skipEligibility: true },
    );
    expect(response.requester).toEqual({
      id: 'requester-id',
      email: 'cliente@example.com',
      name: 'Cliente Externo',
      referredById: 'owner-id',
    });
  });

  it('reuses an existing external user for the same (owner, externalId)', async () => {
    prisma.user.findUnique.mockReset();
    prisma.user.findUnique.mockResolvedValueOnce({
      id: 'owner-id',
      role: UserRole.AFFILIATE,
      active: true,
      deletedAt: null,
    });
    prisma.user.findFirst.mockResolvedValue({
      id: 'existing-ext',
      email: 'ext@external.vallex.local',
      name: 'External panel-user-42',
      referredById: 'owner-id',
    });
    linkRequest.create.mockResolvedValue({
      id: 'request-id-2',
      userId: 'existing-ext',
      dealId: null,
      bettingHouseSlug: 'betano',
      message: '',
      status: 'PENDING',
      createdAt: new Date('2026-06-10T00:00:00.000Z'),
    });

    const response = await service.createLinkRequestFromApi('owner-id', {
      externalUserId: 'panel-user-42',
      userEmail: 'cliente@example.com',
      userName: 'Cliente Externo',
      bettingHouseSlug: 'betano',
    });

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(response.requester.id).toBe('existing-ext');
    // grava o payload bruto da requisição no banco (email recebido = synthetic
    // pois o shadow user reusado tem e-mail @external.vallex.local)
    expect(prisma.affiliateApiLinkRequestLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          externalId: 'panel-user-42',
          userEmail: 'cliente@example.com',
          emailSynthetic: true,
        }),
      }),
    );
  });

  // ── Withdrawals ───────────────────────────────────────────────────────────

  it('getExternalUser returns the sub-user profile + balance', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'sub-id',
      name: 'Panel User',
      email: 'panel@example.com',
      externalId: 'panel-user-42',
      status: 'APPROVED',
      createdAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    balance.getBalance.mockResolvedValue({ total: 250, perHouse: [] });

    const res = await service.getExternalUser('owner-id', 'panel-user-42', {});

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          referredById: 'owner-id',
          externalId: 'panel-user-42',
          isExternal: true,
        }),
      }),
    );
    expect(res.user.externalUserId).toBe('panel-user-42');
    expect(res.balance).toEqual({ total: 250, perHouse: [] });
  });

  it('getExternalUser 404s for a sub-user outside the partner network', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(
      service.getExternalUser('owner-id', 'foreign-user', {}),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('createWithdrawalFromApi resolves the sub-user and delegates to createForExternal', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'sub-id',
      email: 'panel@example.com',
      name: 'Panel User',
      referredById: 'owner-id',
    });
    withdrawal.createForExternal.mockResolvedValue({
      id: 'wd-1',
      bettingHouse: 'superbet',
      status: 'PENDING',
    });
    balance.getBalance.mockResolvedValue({ total: 0, perHouse: [] });

    const res = await service.createWithdrawalFromApi('owner-id', {
      externalUserId: 'panel-user-42',
      bettingHouse: 'superbet',
    });

    expect(withdrawal.createForExternal).toHaveBeenCalledWith(
      { id: 'sub-id', name: 'Panel User', externalId: 'panel-user-42' },
      { bettingHouse: 'superbet', requestNote: undefined },
    );
    expect(res.withdrawal.id).toBe('wd-1');
    expect(res.balance).toEqual({ total: 0, perHouse: [] });
  });

  it('scopes status updates to the partner own external sub-users', async () => {
    prisma.user.findMany.mockReset();
    prisma.user.findMany.mockResolvedValue([{ id: 'sub-a' }, { id: 'sub-b' }]);
    withdrawal.setStatusForExternal.mockResolvedValue({
      id: 'wd-1',
      status: 'COMPLETED',
    });

    await service.setWithdrawalStatusFromApi('owner-id', 'wd-1', {
      status: 'completed',
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { referredById: 'owner-id', isExternal: true },
      }),
    );
    expect(withdrawal.setStatusForExternal).toHaveBeenCalledWith(
      'wd-1',
      ['sub-a', 'sub-b'],
      { status: 'completed', note: undefined },
    );
  });

  // ── Token environments (live / test) ────────────────────────────────────

  it('generateToken(test) issues a vex_test_ token and stores environment', async () => {
    prisma.$transaction.mockResolvedValue([]);
    prisma.affiliateApiToken.create.mockResolvedValue({});
    prisma.affiliateApiToken.updateMany.mockResolvedValue({ count: 0 });

    const res = await service.generateToken('owner-id', 'test');

    expect(res.token.startsWith('vex_test_')).toBe(true);
    expect(res.environment).toBe('test');
  });

  it('generateToken defaults to a vex_live_ token', async () => {
    prisma.$transaction.mockResolvedValue([]);
    const res = await service.generateToken('owner-id');
    expect(res.token.startsWith('vex_live_')).toBe(true);
    expect(res.environment).toBe('live');
  });

  it('validateApiToken rejects a token whose stored environment mismatches the prefix', async () => {
    // vex_test_ prefix but the stored row says environment 'live' → reject.
    prisma.affiliateApiToken.findUnique.mockResolvedValue({
      id: 'tok-1',
      userId: 'owner-id',
      tokenHash: 'irrelevant',
      revokedAt: null,
      environment: 'live',
      user: {
        id: 'owner-id',
        email: 'owner@example.com',
        role: UserRole.AFFILIATE,
        active: true,
        deletedAt: null,
      },
    });
    await expect(service.validateApiToken('vex_test_whatever')).rejects.toThrow(
      'Token da API inválido',
    );
  });

  it('getTokenStatus returns both live and test status', async () => {
    prisma.affiliateApiToken.findMany.mockResolvedValue([
      {
        id: 'live-tok',
        tokenHint: 'aaaaaa',
        createdAt: new Date(),
        lastUsedAt: null,
        environment: 'live',
      },
    ]);
    const res = await service.getTokenStatus('owner-id');
    expect(res.live.active).toBe(true);
    expect(res.test.active).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { NotificationType, UserRole, WithdrawalStatus } from '@prisma/client';
import { WithdrawalService } from './withdrawal.service.js';

const decimal = (value: number) => ({ toNumber: () => value });

const jwtUser = {
  sub: 'affiliate-1',
  email: 'a@vexxa.com',
  role: UserRole.AFFILIATE,
};

function makePrisma(overrides: Record<string, unknown> = {}) {
  const prisma = {
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({
        id: 'affiliate-1',
        name: 'Affiliate',
        email: 'a@vexxa.com',
        pixKey: '123',
        pixKeyType: 'cpf',
        bankName: '',
        bankAgency: '',
        bankAccount: '',
        accountHolder: 'Affiliate',
        withdrawalBlocked: false,
      }),
    },
    bettingHouse: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    withdrawalRequest: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: 'withdrawal-1',
        amount: decimal(940),
        originalAmount: decimal(1000),
        withdrawalFee: decimal(60),
        bettingHouse: 'esportivabet',
        requestNote: 'Pagar hoje',
        status: WithdrawalStatus.PENDING,
        createdAt: new Date('2026-04-24T10:00:00.000Z'),
      }),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({
        _sum: { originalAmount: null, gatewayRefundedAmount: null },
      }),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue(undefined),
    },
    withdrawalDayRelease: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(undefined),
    },
    affiliateLink: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    affiliateData: {
      groupBy: vi.fn().mockResolvedValue([]),
    },
    $executeRaw: vi.fn(),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    ...overrides,
  };
  return prisma;
}

describe('WithdrawalService', () => {
  let prisma: ReturnType<typeof makePrisma>;
  let settings: { getMany: ReturnType<typeof vi.fn> };
  let balance: {
    getBalance: ReturnType<typeof vi.fn>;
    loadNetworkMembers: ReturnType<typeof vi.fn>;
  };
  let notifications: { create: ReturnType<typeof vi.fn> };
  let paymentGateway: {
    createTransfer: ReturnType<typeof vi.fn>;
    getPayoutStatus: ReturnType<typeof vi.fn>;
    getReceipt: ReturnType<typeof vi.fn>;
    getBalance: ReturnType<typeof vi.fn>;
    checkSufficientBalance: ReturnType<typeof vi.fn>;
    getWebhookSecret: ReturnType<typeof vi.fn>;
  };
  let service: WithdrawalService;
  let linkWebhook: {
    emitWithdrawalCreated: ReturnType<typeof vi.fn>;
    emitWithdrawalStatusChanged: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    prisma = makePrisma();
    settings = {
      getMany: vi
        .fn()
        .mockResolvedValue(new Map([['withdrawal_fee_rate', '0.06']])),
    };
    balance = {
      getBalance: vi.fn().mockResolvedValue({
        balance: 1000,
        minWithdrawalAmount: 100,
        bonusBalance: 0,
        perHouse: [{ house: 'esportivabet', total: 1000 }],
        depositInfo: { exemptByNetworkHead: false, belowMinimum: false },
      }),
      loadNetworkMembers: vi.fn().mockResolvedValue([]),
    };
    notifications = { create: vi.fn().mockResolvedValue(undefined) };
    paymentGateway = {
      createTransfer: vi.fn().mockResolvedValue({
        ok: true,
        response: {
          id: 'gw-1',
          status: 'processing',
          amount: 0,
          net_amount: 0,
          fee: 0,
        },
        requestPayload: {},
      }),
      getPayoutStatus: vi.fn().mockResolvedValue({
        ok: false,
        reason: 'not used in tests',
      }),
      getReceipt: vi.fn().mockResolvedValue({
        ok: false,
        reason: 'not used in tests',
      }),
      getBalance: vi.fn().mockResolvedValue({
        ok: true,
        balance: {
          availableBalance: 100_000_000,
          withdrawalsBlocked: false,
          withdrawalsBlockedReason: null,
        },
      }),
      checkSufficientBalance: vi.fn().mockResolvedValue({ ok: true }),
      getWebhookSecret: vi.fn().mockReturnValue(''),
    };
    service = new WithdrawalService(
      prisma as never,
      settings as never,
      balance as never,
      notifications as never,
      paymentGateway as never,
      { enqueueProof: vi.fn().mockResolvedValue(undefined) } as never,
      {
        renderPng: vi.fn().mockResolvedValue(Buffer.from('')),
        generateAndUpload: vi.fn().mockResolvedValue(null),
      } as never,
      (linkWebhook = {
        emitWithdrawalCreated: vi.fn().mockResolvedValue(undefined),
        emitWithdrawalStatusChanged: vi.fn().mockResolvedValue(undefined),
      }) as never,
    );
  });

  it('emits withdrawal.created webhook after creating a withdrawal', async () => {
    await service.create(jwtUser, { bettingHouse: 'esportivabet' });
    expect(linkWebhook.emitWithdrawalCreated).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: jwtUser.sub,
        bettingHouse: 'esportivabet',
        status: WithdrawalStatus.PENDING,
      }),
    );
  });

  it('creates a full-balance withdrawal and stores affiliate request note', async () => {
    const result = await service.create(jwtUser, {
      bettingHouse: 'esportivabet',
      requestNote: 'Pagar hoje',
    });

    expect(result.originalAmount).toBe(1000);
    expect(result.amount).toBe(940);
    expect(result.requestNote).toBe('Pagar hoje');
    expect(prisma.withdrawalRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          originalAmount: 1000,
          amount: 940,
          requestNote: 'Pagar hoje',
        }),
      }),
    );
  });

  it('creates a Pinbet withdrawal using the 80% Net P&L gross limit', async () => {
    balance.getBalance.mockResolvedValue({
      balance: 1000,
      minWithdrawalAmount: 50,
      bonusBalance: 0,
      perHouse: [
        {
          house: 'pinbet-diario',
          total: 1000,
          netPl: 100,
          withdrawable: 80,
          withdrawalRestriction: 'NET_PL_CAP',
        },
      ],
      depositInfo: { exemptByNetworkHead: false, belowMinimum: false },
    });
    prisma.withdrawalRequest.create.mockResolvedValueOnce({
      id: 'withdrawal-pinbet',
      amount: decimal(75.2),
      originalAmount: decimal(80),
      withdrawalFee: decimal(4.8),
      bettingHouse: 'pinbet-diario',
      requestNote: '',
      status: WithdrawalStatus.PENDING,
      createdAt: new Date('2026-07-25T10:00:00.000Z'),
    });

    await service.create(jwtUser, { bettingHouse: 'pinbet-diario' });

    expect(prisma.withdrawalRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          originalAmount: 80,
          withdrawalFee: 4.8,
          amount: 75.2,
        }),
      }),
    );
  });

  it('tags a new monthly Pinbet withdrawal as combined', async () => {
    balance.getBalance.mockResolvedValue({
      balance: 80,
      minWithdrawalAmount: 50,
      bonusBalance: 0,
      perHouse: [
        {
          house: 'pinbet-mensal',
          total: 80,
          netPl: 100,
          withdrawable: 80,
          withdrawalRestriction: null,
        },
      ],
      depositInfo: { exemptByNetworkHead: false, belowMinimum: false },
    });

    await service.create(jwtUser, { bettingHouse: 'pinbet-mensal' });

    expect(prisma.withdrawalRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pinbetDimension: 'COMBINED' }),
      }),
    );
  });

  it('rejects withdrawal when affiliate balance is blocked', async () => {
    prisma.user.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'affiliate-1',
      name: 'Affiliate',
      email: 'a@vexxa.com',
      pixKey: '123',
      pixKeyType: 'cpf',
      bankName: '',
      bankAgency: '',
      bankAccount: '',
      accountHolder: 'Affiliate',
      withdrawalBlocked: true,
    });

    await expect(
      service.create(jwtUser, { bettingHouse: 'esportivabet' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects when full available balance is below minimum', async () => {
    // Both the per-casa (filtered) and global (unfiltered) getBalance calls
    // must report the low balance for the proportional available to fall below
    // the minimum.
    balance.getBalance.mockResolvedValue({
      balance: 50,
      minWithdrawalAmount: 100,
      bonusBalance: 0,
      perHouse: [{ house: 'esportivabet', total: 50 }],
      depositInfo: { exemptByNetworkHead: false, belowMinimum: false },
    });

    await expect(
      service.create(jwtUser, { bettingHouse: 'esportivabet' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects 2nd withdrawal same day/house when no release exists', async () => {
    // Já existe saque ativo hoje na casa → rate-limit; sem liberação → 429.
    prisma.withdrawalRequest.findFirst.mockResolvedValueOnce({
      id: 'wd-today',
    });
    prisma.withdrawalDayRelease.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.create(jwtUser, { bettingHouse: 'esportivabet' }),
    ).rejects.toThrow('Limite de 1 saque por dia');
    expect(prisma.withdrawalRequest.create).not.toHaveBeenCalled();
  });

  it('allows extra withdrawal same day/house and consumes the release', async () => {
    prisma.withdrawalRequest.findFirst.mockResolvedValueOnce({
      id: 'wd-today',
    });
    prisma.withdrawalDayRelease.findFirst.mockResolvedValueOnce({
      id: 'rel-1',
    });

    const result = await service.create(jwtUser, {
      bettingHouse: 'esportivabet',
    });

    expect(result.originalAmount).toBe(1000);
    expect(prisma.withdrawalDayRelease.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'rel-1' },
        data: expect.objectContaining({ consumedAt: expect.any(Date) }),
      }),
    );
    expect(prisma.withdrawalRequest.create).toHaveBeenCalled();
  });

  it('updates status with admin note and notifies affiliate on rejection', async () => {
    // Atomic compare-and-set transitions PENDING → REJECTED.
    prisma.withdrawalRequest.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.withdrawalRequest.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'withdrawal-1',
      userId: 'affiliate-1',
      amount: decimal(940),
      originalAmount: decimal(1000),
      withdrawalFee: decimal(60),
      bettingHouse: 'esportivabet',
      pixKeyType: 'cpf',
      pixKey: '123',
      accountHolder: 'Affiliate',
      status: WithdrawalStatus.REJECTED,
      requestNote: 'Pagar hoje',
      adminNote: 'Dados divergentes',
      approvedAt: new Date('2026-04-24T11:00:00.000Z'),
      approvedBy: { name: 'Admin', email: 'admin@vexxa.com' },
      user: { id: 'affiliate-1', name: 'Affiliate', email: 'a@vexxa.com' },
      createdAt: new Date('2026-04-24T10:00:00.000Z'),
    });

    const result = await service.updateStatus('withdrawal-1', 'admin-1', {
      status: 'rejected',
      adminNote: 'Dados divergentes',
    });

    expect(prisma.withdrawalRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'withdrawal-1', status: WithdrawalStatus.PENDING },
      data: expect.objectContaining({
        status: WithdrawalStatus.REJECTED,
        adminNote: 'Dados divergentes',
        approvedById: 'admin-1',
      }),
    });
    expect(result.status).toBe(WithdrawalStatus.REJECTED);
    expect(result.adminNote).toBe('Dados divergentes');
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'affiliate-1',
        type: NotificationType.GENERAL,
        message: expect.stringContaining('Dados divergentes'),
      }),
    );
  });

  it('rejects updateStatus when withdrawal already processed (concurrent admin race)', async () => {
    // Compare-and-set matched 0 rows because status moved away from PENDING.
    prisma.withdrawalRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    // 1st findUnique: external-row guard (not external → proceed).
    prisma.withdrawalRequest.findUnique.mockResolvedValueOnce({
      user: { isExternal: false },
    });
    // 2nd findUnique: post-CAS status re-read.
    prisma.withdrawalRequest.findUnique.mockResolvedValueOnce({
      status: WithdrawalStatus.APPROVED,
    });

    await expect(
      service.updateStatus('withdrawal-1', 'admin-2', { status: 'rejected' }),
    ).rejects.toThrow(BadRequestException);

    // findUniqueOrThrow must NOT run when the transition failed.
    expect(prisma.withdrawalRequest.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(notifications.create).not.toHaveBeenCalled();
  });

  it('returns 404 when updateStatus targets a withdrawal that does not exist', async () => {
    prisma.withdrawalRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    prisma.withdrawalRequest.findUnique.mockResolvedValueOnce(null);

    await expect(
      service.updateStatus('missing-id', 'admin-1', { status: 'rejected' }),
    ).rejects.toThrow('Solicitação de saque não encontrada.');
  });

  it('rejects updateStatus when called with approved status (must use POST /approve)', async () => {
    await expect(
      service.updateStatus('withdrawal-1', 'admin-1', { status: 'approved' }),
    ).rejects.toThrow(/POST .*\/approve/);
    expect(prisma.withdrawalRequest.updateMany).not.toHaveBeenCalled();
  });

  describe('external (affiliate-API) withdrawals', () => {
    const subUser = { id: 'sub-1', name: 'Panel User', externalId: 'ext-42' };

    it('createForExternal saca o saldo total da casa, sem taxa e com PIX sentinel', async () => {
      await service.createForExternal(subUser, {
        bettingHouse: 'esportivabet',
      });

      expect(prisma.withdrawalRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'sub-1',
            amount: 1000,
            originalAmount: 1000,
            withdrawalFee: 0,
            bettingHouse: 'esportivabet',
            pixKeyType: 'API',
            pixKey: 'ext:ext-42',
            accountHolder: 'Panel User',
            status: WithdrawalStatus.PENDING,
          }),
        }),
      );
    });

    it('createForExternal marca saque mensal Pinbet como combinado', async () => {
      balance.getBalance.mockResolvedValueOnce({
        perHouse: [{ house: 'pinbet-mensal', withdrawable: 1000 }],
      });
      await service.createForExternal(subUser, {
        bettingHouse: 'pinbet-mensal',
      });

      expect(prisma.withdrawalRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            bettingHouse: 'pinbet-mensal',
            pinbetDimension: 'COMBINED',
          }),
        }),
      );
    });

    it('createForExternal rejeita casa bonus', async () => {
      await expect(
        service.createForExternal(subUser, { bettingHouse: 'bonus' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('createForExternal rejeita 2º saque no MESMO dia/casa (429) e filtra por hoje', async () => {
      prisma.withdrawalRequest.findFirst.mockResolvedValueOnce({
        id: 'today',
      });
      await expect(
        service.createForExternal(subUser, { bettingHouse: 'esportivabet' }),
      ).rejects.toMatchObject({ status: 429 });
      // a trava é por DIA: o findFirst filtra createdAt >= início do dia
      expect(prisma.withdrawalRequest.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: { gte: expect.any(Date) },
          }),
        }),
      );
      expect(prisma.withdrawalRequest.create).not.toHaveBeenCalled();
    });

    it('createForExternal PERMITE novo saque hoje se o de ontem já fechou (sem ativo hoje)', async () => {
      // Nenhum saque ativo HOJE → findFirst null → cria normalmente.
      prisma.withdrawalRequest.findFirst.mockResolvedValueOnce(null);
      const res = await service.createForExternal(subUser, {
        bettingHouse: 'esportivabet',
      });
      expect(res.id).toBeDefined();
      expect(prisma.withdrawalRequest.create).toHaveBeenCalled();
    });

    it('createForExternal rejeita quando não há saldo', async () => {
      balance.getBalance.mockResolvedValueOnce({ perHouse: [] });
      await expect(
        service.createForExternal(subUser, { bettingHouse: 'esportivabet' }),
      ).rejects.toThrow('Sem saldo disponível');
    });

    it('setStatusForExternal aplica CAS escopado e rejeita transição inválida', async () => {
      prisma.withdrawalRequest.updateMany.mockResolvedValueOnce({ count: 0 });
      prisma.withdrawalRequest.findFirst.mockResolvedValueOnce({
        status: WithdrawalStatus.COMPLETED,
      });
      await expect(
        service.setStatusForExternal('wd-1', ['sub-1'], {
          status: 'completed',
        }),
      ).rejects.toThrow(/Transição inválida/);

      expect(prisma.withdrawalRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'wd-1',
            userId: { in: ['sub-1'] },
            status: {
              in: [WithdrawalStatus.PENDING, WithdrawalStatus.PROCESSING],
            },
          }),
        }),
      );
    });

    it('setStatusForExternal 404 quando o parceiro não tem sub-usuários', async () => {
      await expect(
        service.setStatusForExternal('wd-1', [], { status: 'completed' }),
      ).rejects.toThrow('não encontrada');
      expect(prisma.withdrawalRequest.updateMany).not.toHaveBeenCalled();
    });

    it('listForExternal retorna vazio sem sub-usuários (sem consultar o banco)', async () => {
      const res = await service.listForExternal([], {});
      expect(res).toEqual({ data: [], total: 0, page: 1, limit: 20 });
      expect(prisma.withdrawalRequest.findMany).not.toHaveBeenCalled();
    });

    it('admin list() exclui linhas de usuários externos', async () => {
      await service.list(
        { sub: 'admin-1', email: 'a@x.com', role: UserRole.ADMIN },
        {},
      );
      const call = prisma.withdrawalRequest.findMany.mock.calls.at(-1)?.[0] as {
        where: { user?: { isExternal?: boolean } };
      };
      expect(call.where.user?.isExternal).toBe(false);
    });

    it('admin list() com includeExternal NÃO exclui externos', async () => {
      await service.list(
        { sub: 'admin-1', email: 'a@x.com', role: UserRole.ADMIN },
        { includeExternal: true } as never,
      );
      const call = prisma.withdrawalRequest.findMany.mock.calls.at(-1)?.[0] as {
        where: { user?: { isExternal?: boolean } };
      };
      expect(call.where.user?.isExternal).toBeUndefined();
    });

    it('mapeia isExternal + aprovador externo (referrer) na linha', async () => {
      prisma.withdrawalRequest.findMany.mockResolvedValueOnce([
        {
          id: 'wd-ext',
          userId: 'ext-1',
          amount: decimal(800),
          originalAmount: decimal(800),
          withdrawalFee: decimal(0),
          bettingHouse: 'superbet',
          pixKeyType: 'API',
          pixKey: 'ext:abc',
          accountHolder: 'Andre',
          status: WithdrawalStatus.COMPLETED,
          requestNote: '',
          adminNote: '',
          gatewayFailureReason: null,
          approvedAt: null,
          createdAt: new Date('2026-06-26T19:14:00.000Z'),
          gatewayReceiptFormat: null,
          gatewayRefundedAmount: null,
          user: {
            name: 'Andre Bastos',
            email: 'andre@example.com',
            isExternal: true,
            referredBy: { name: 'Pedro', email: 'pedro@example.com' },
          },
          approvedBy: null,
        },
      ]);
      prisma.withdrawalRequest.count.mockResolvedValueOnce(1);

      const res = await service.list(
        { sub: 'admin-1', email: 'a@x.com', role: UserRole.ADMIN },
        { includeExternal: true } as never,
      );
      const row = res.data[0]!;
      expect(row.isExternal).toBe(true);
      expect(row.externalApprovedByName).toBe('Pedro');
      expect(row.externalApprovedByEmail).toBe('pedro@example.com');
    });
  });

  describe('minCpaToWithdraw gate (own + network CPA)', () => {
    const hiperbet = {
      name: 'Hiperbet',
      withdrawalDay: null,
      withdrawalDayEnd: null,
      withdrawalDay2: null,
      withdrawalDay2End: null,
      withdrawalWeekday: null,
      minCpaToWithdraw: 10,
      withdrawalEnabled: true,
    };

    // Wire own production (campaign 'c1') and network downline (campaign
    // 'net-c1') qualified-CPA counts for house 'hiperbet'.
    function wireCpa(ownCount: number, networkCount: number) {
      prisma.affiliateLink.findMany.mockResolvedValue([{ campaignId: 'c1' }]);
      balance.loadNetworkMembers.mockResolvedValue([
        {
          id: 'm1',
          level: 1,
          referredById: 'affiliate-1',
          links: [{ campaignId: 'net-c1', bettingHouse: 'hiperbet' }],
          fraudCounts: [],
          l1CpaByHouse: new Map(),
          l1RevByHouse: new Map(),
        },
      ]);
      prisma.affiliateData.groupBy.mockImplementation(
        ({ where }: { where: { campaignId: { in: string[] } } }) => {
          const isNetwork = where.campaignId.in.includes('net-c1');
          return Promise.resolve([
            {
              bettingHouse: 'hiperbet',
              _sum: { cpaQualified: isNetwork ? networkCount : ownCount },
            },
          ]);
        },
      );
    }

    it('blocks when own + network CPA is below the house minimum', async () => {
      prisma.bettingHouse.findUnique.mockResolvedValueOnce(hiperbet);
      wireCpa(4, 2); // total 6 < 10

      await expect(
        service.create(jwtUser, { bettingHouse: 'hiperbet' }),
      ).rejects.toThrow(/seus \+ rede/);
      expect(prisma.withdrawalRequest.create).not.toHaveBeenCalled();
    });

    it('allows when network CPA pushes the total to the minimum (own alone is below)', async () => {
      prisma.bettingHouse.findUnique.mockResolvedValueOnce(hiperbet);
      wireCpa(4, 8); // own 4 < 10, but own + network = 12 >= 10
      balance.getBalance.mockResolvedValue({
        balance: 1000,
        minWithdrawalAmount: 100,
        bonusBalance: 0,
        perHouse: [{ house: 'hiperbet', total: 1000 }],
        depositInfo: { exemptByNetworkHead: false, belowMinimum: false },
      });

      await service.create(jwtUser, { bettingHouse: 'hiperbet' });

      expect(prisma.withdrawalRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ bettingHouse: 'hiperbet' }),
        }),
      );
    });
  });

  describe('bonus withdrawal', () => {
    const bonusUser = {
      id: 'affiliate-1',
      name: 'Affiliate',
      email: 'a@vexxa.com',
      pixKey: '123',
      pixKeyType: 'cpf',
      bankName: '',
      bankAgency: '',
      bankAccount: '',
      accountHolder: 'Affiliate',
      withdrawalBlocked: false,
      bonusBalance: decimal(565),
    };

    it('computes bonus available from User.bonusBalance, not the house-scoped balance', async () => {
      // getBalance é chamado house-scoped ({bettingHouse:'bonus'}) e devolve
      // bonusBalance=0; o fix deve ler a coluna real User.bonusBalance.
      prisma.user.findUniqueOrThrow.mockResolvedValue(bonusUser);
      // Saque de bônus anterior: 465 já sacado (líquido de estorno).
      prisma.withdrawalRequest.aggregate.mockResolvedValueOnce({
        _sum: { originalAmount: decimal(465), gatewayRefundedAmount: null },
      });

      await service.create(jwtUser, { bettingHouse: 'bonus' });

      // disponível = 565 - 465 = 100 → cria saque (taxa 6% → líquido 94).
      expect(prisma.withdrawalRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            bettingHouse: 'bonus',
            originalAmount: 100,
            withdrawalFee: 6,
            amount: 94,
          }),
        }),
      );
    });

    it('blocks bonus withdrawal only when the real bonus pool is exhausted', async () => {
      prisma.user.findUniqueOrThrow.mockResolvedValue({
        ...bonusUser,
        bonusBalance: decimal(465),
      });
      prisma.withdrawalRequest.aggregate.mockResolvedValueOnce({
        _sum: { originalAmount: decimal(465), gatewayRefundedAmount: null },
      });

      // disponível = 465 - 465 = 0 → bloqueia.
      await expect(
        service.create(jwtUser, { bettingHouse: 'bonus' }),
      ).rejects.toThrow('Sem saldo de bônus');
      expect(prisma.withdrawalRequest.create).not.toHaveBeenCalled();
    });
  });

  describe('reconcileStuckProcessing', () => {
    const stuckRow = { id: 'w-1', gatewayId: 'gw-1' };

    it('reconciles a gateway-completed payout via PayOutCompleted', async () => {
      prisma.withdrawalRequest.findMany.mockResolvedValueOnce([stuckRow]);
      paymentGateway.getPayoutStatus.mockResolvedValueOnce({
        ok: true,
        data: {
          reference_code: 'gw-1',
          status: 'completed',
          completed_at: '2026-05-26T12:20:07.022Z',
        },
      });
      const spy = vi
        .spyOn(service, 'handleGatewayWebhookEvent')
        .mockResolvedValue({ processed: true });

      const result = await service.reconcileStuckProcessing();

      expect(result).toEqual({ checked: 1, completed: 1, failed: 0 });
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'PayOutCompleted',
          data: {
            data: expect.objectContaining({
              referenceCode: 'gw-1',
              correlationID: 'w-1',
              status: 'completed',
              source: 'reconcile',
            }),
          },
        }),
      );
    });

    it('reconciles a gateway-failed payout via PayOutFailed', async () => {
      prisma.withdrawalRequest.findMany.mockResolvedValueOnce([stuckRow]);
      paymentGateway.getPayoutStatus.mockResolvedValueOnce({
        ok: true,
        data: {
          reference_code: 'gw-1',
          status: 'failed',
          error_message: 'Invalid Pix Entry',
        },
      });
      const spy = vi
        .spyOn(service, 'handleGatewayWebhookEvent')
        .mockResolvedValue({ processed: true });

      const result = await service.reconcileStuckProcessing();

      expect(result).toEqual({ checked: 1, completed: 0, failed: 1 });
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'PayOutFailed',
          data: {
            data: expect.objectContaining({
              errorMessage: 'Invalid Pix Entry',
              source: 'reconcile',
            }),
          },
        }),
      );
    });

    it('leaves still-processing payouts untouched', async () => {
      prisma.withdrawalRequest.findMany.mockResolvedValueOnce([stuckRow]);
      paymentGateway.getPayoutStatus.mockResolvedValueOnce({
        ok: true,
        data: { reference_code: 'gw-1', status: 'processing' },
      });
      const spy = vi.spyOn(service, 'handleGatewayWebhookEvent');

      const result = await service.reconcileStuckProcessing();

      expect(result).toEqual({ checked: 1, completed: 0, failed: 0 });
      expect(spy).not.toHaveBeenCalled();
    });

    it('skips when the gateway status query fails', async () => {
      prisma.withdrawalRequest.findMany.mockResolvedValueOnce([stuckRow]);
      paymentGateway.getPayoutStatus.mockResolvedValueOnce({
        ok: false,
        reason: 'HTTP 500',
      });
      const spy = vi.spyOn(service, 'handleGatewayWebhookEvent');

      const result = await service.reconcileStuckProcessing();

      expect(result).toEqual({ checked: 1, completed: 0, failed: 0 });
      expect(spy).not.toHaveBeenCalled();
    });
  });
});

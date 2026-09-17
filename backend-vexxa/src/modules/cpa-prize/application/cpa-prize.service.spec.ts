import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { CpaPrizeService } from './cpa-prize.service.js';
import { ConflictException, ForbiddenException } from '@nestjs/common';

const decimal = (n: number) => new Prisma.Decimal(n);
const notification = {
  create: vi.fn().mockResolvedValue(undefined),
  createMany: vi.fn().mockResolvedValue(0),
};

function svc(prisma: unknown) {
  return new CpaPrizeService(prisma as never, notification as never);
}

function version(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ver-1',
    countMode: 'INDIVIDUAL',
    bettingHouse: 'superbet',
    cpaPerPrize: 10,
    prizeType: 'BALANCE',
    prizeValue: decimal(100),
    prizeLabel: 'R$100',
    icon: '🎯',
    startDate: new Date('2026-05-01T00:00:00.000Z'),
    endDate: null,
    effectiveFromDate: new Date('2026-05-01T00:00:00.000Z'),
    supersededAt: null,
    ...overrides,
  };
}

describe('CpaPrizeService.getProgress', () => {
  beforeEach(() => vi.clearAllMocks());

  it('individual: total 15, meta 10 → remainder 5, faltam 5 (nunca negativo)', async () => {
    const prisma = {
      cpaPrizeRule: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            { id: 'r1', name: 'Regra', description: '', versions: [version()] },
          ]),
      },
      affiliateLink: {
        findMany: vi.fn().mockResolvedValue([{ campaignId: 'c1' }]),
      },
      affiliateData: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { cpaQualified: 15 } }),
      },
      cpaPrizeAward: { count: vi.fn().mockResolvedValue(1) },
    };
    const { data } = await svc(prisma).getProgress('u1');

    expect(data).toHaveLength(1);
    expect(data[0].totalCpa).toBe(15);
    expect(data[0].remainder).toBe(5);
    expect(data[0].faltam).toBe(5);
    expect(data[0].remainder).toBeGreaterThanOrEqual(0);
  });

  it('rede: mensagem deixa claro que conta só downline', async () => {
    const prisma = {
      cpaPrizeRule: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            {
              id: 'r1',
              name: 'Rede',
              description: '',
              versions: [version({ countMode: 'NETWORK' })],
            },
          ]),
      },
      affiliateLink: { findMany: vi.fn().mockResolvedValue([]) },
      affiliateData: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { cpaQualified: 0 } }),
      },
      cpaPrizeAward: { count: vi.fn().mockResolvedValue(0) },
      user: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const { data } = await svc(prisma).getProgress('u1');
    expect(data[0].countMode).toBe('NETWORK');
    expect(data[0].message).toContain('downline');
    expect(data[0].message.toLowerCase()).toContain('não entram');
  });
});

describe('CpaPrizeService.requestRedemption', () => {
  beforeEach(() => vi.clearAllMocks());

  function prismaWithAward(award: Record<string, unknown> | null) {
    return {
      cpaPrizeAward: { findUnique: vi.fn().mockResolvedValue(award) },
      $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) =>
        fn({
          cpaPrizeAward: { update: vi.fn().mockResolvedValue(undefined) },
          cpaPrizeLog: { create: vi.fn().mockResolvedValue(undefined) },
        }),
      ),
      user: { findMany: vi.fn().mockResolvedValue([]) },
    };
  }

  it('award AVAILABLE do próprio user → solicita resgate', async () => {
    const prisma = prismaWithAward({
      id: 'a1',
      userId: 'u1',
      userName: 'U',
      status: 'AVAILABLE',
      ruleId: 'r1',
      ruleVersionId: 'v1',
      prizeLabel: 'X',
    });
    const res = await svc(prisma).requestRedemption('u1', 'a1');
    expect(res.success).toBe(true);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('award de outro user → Forbidden', async () => {
    const prisma = prismaWithAward({
      id: 'a1',
      userId: 'other',
      status: 'AVAILABLE',
    });
    await expect(
      svc(prisma).requestRedemption('u1', 'a1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('award não-AVAILABLE → Conflict', async () => {
    const prisma = prismaWithAward({ id: 'a1', userId: 'u1', status: 'PAID' });
    await expect(
      svc(prisma).requestRedemption('u1', 'a1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

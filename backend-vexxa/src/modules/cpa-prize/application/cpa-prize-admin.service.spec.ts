import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { CpaPrizeAdminService } from './cpa-prize-admin.service.js';

const decimal = (n: number) => new Prisma.Decimal(n);
const notification = {
  create: vi.fn().mockResolvedValue(undefined),
  createMany: vi.fn(),
};
const engine = { evaluateRuleVersion: vi.fn() };

function svc(prisma: unknown) {
  return new CpaPrizeAdminService(
    prisma as never,
    notification as never,
    engine as never,
  );
}

describe('CpaPrizeAdminService.approveRedemption', () => {
  beforeEach(() => vi.clearAllMocks());

  it('prêmio BALANCE → credita bonusBalance e marca PAID', async () => {
    const txUser = { update: vi.fn().mockResolvedValue(undefined) };
    const txAward = { update: vi.fn().mockResolvedValue(undefined) };
    const prisma = {
      cpaPrizeAward: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'a1',
          userId: 'u1',
          status: 'REDEMPTION_REQUESTED',
          prizeType: 'BALANCE',
          prizeValue: decimal(100),
          prizeLabel: 'R$100',
          ruleId: 'r1',
          ruleVersionId: 'v1',
        }),
      },
      $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) =>
        fn({
          user: txUser,
          cpaPrizeAward: txAward,
          cpaPrizeLog: { create: vi.fn() },
        }),
      ),
      user: { findUnique: vi.fn().mockResolvedValue({ name: 'Admin' }) },
      auditLog: { create: vi.fn().mockResolvedValue(undefined) },
    };

    const res = await svc(prisma).approveRedemption(
      'admin',
      'a@x.com',
      'a1',
      '',
      '',
    );
    expect(res.success).toBe(true);
    expect(txUser.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { bonusBalance: { increment: 100 } } }),
    );
    expect(txAward.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'PAID',
          balanceCredited: true,
        }),
      }),
    );
  });
});

describe('CpaPrizeAdminService.updateRule (versionamento)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('mudança estrutural cria nova versão e supersede a atual (corte amanhã)', async () => {
    const current = {
      id: 'v1',
      version: 1,
      bettingHouse: 'superbet',
      cpaPerPrize: 10,
      countMode: 'INDIVIDUAL',
      prizeType: 'BALANCE',
      prizeValue: decimal(100),
      prizeLabel: '',
      icon: '🎯',
      startDate: new Date('2026-05-01T00:00:00.000Z'),
      endDate: null,
    };
    const versionCreate = vi
      .fn()
      .mockResolvedValue({ id: 'v2', version: 2, bettingHouse: 'superbet' });
    const versionUpdate = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      cpaPrizeRule: {
        findUnique: vi
          .fn()
          // first call: updateRule loads rule + current version
          .mockResolvedValueOnce({ id: 'r1', versions: [current] })
          // getRule() at the end
          .mockResolvedValue({
            id: 'r1',
            createdBy: { name: 'A', email: 'a' },
            versions: [{ ...current, prizeValue: decimal(100) }],
            _count: { awards: 0 },
          }),
      },
      $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) =>
        fn({
          cpaPrizeRule: { update: vi.fn().mockResolvedValue(undefined) },
          cpaPrizeRuleVersion: { update: versionUpdate, create: versionCreate },
          cpaPrizeLog: { create: vi.fn().mockResolvedValue(undefined) },
        }),
      ),
      user: { findUnique: vi.fn().mockResolvedValue({ name: 'Admin' }) },
      auditLog: { create: vi.fn().mockResolvedValue(undefined) },
    };

    await svc(prisma).updateRule(
      'admin',
      'a@x.com',
      'r1',
      { cpaPerPrize: 15 },
      '',
      '',
    );

    expect(versionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ supersededAt: expect.any(Date) }),
      }),
    );
    const createArg = versionCreate.mock.calls[0][0] as {
      data: { version: number; cpaPerPrize: number; effectiveFromDate: Date };
    };
    expect(createArg.data.version).toBe(2);
    expect(createArg.data.cpaPerPrize).toBe(15);
    // default: starts tomorrow (cutoff strictly after today)
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    expect(createArg.data.effectiveFromDate.getTime()).toBeGreaterThan(
      today.getTime(),
    );
  });
});

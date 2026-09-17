import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RankingAdminService } from './ranking-admin.service.js';
import { PrizeStatus, PrizeType, NotificationType } from '@prisma/client';
import {
  PrizeNotFoundException,
  PrizeAlreadyFinalizedException,
  PrizeNotActiveException,
  PrizeRevertBlockedException,
  PrizeValidationException,
} from '../domain/exceptions/ranking.exceptions.js';
import type { IRankingRepository } from '../domain/ports/ranking.repository.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

const decimal = (n: number) => ({ toNumber: () => n });

function makeRepo(
  overrides: Partial<IRankingRepository> = {},
): IRankingRepository {
  return {
    calculateWinners: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    rankingPrize: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: 'prize-new',
        prizeValue: decimal(500),
        prizes: [],
      }),
      update: vi.fn().mockResolvedValue({
        id: 'prize-001',
        prizeValue: decimal(500),
        prizes: [],
      }),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    rankPrize: {
      deleteMany: vi.fn().mockResolvedValue(undefined),
      createMany: vi.fn().mockResolvedValue(undefined),
    },
    prizeWinner: {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue(undefined),
      deleteMany: vi.fn().mockResolvedValue(undefined),
    },
    notification: {
      createMany: vi.fn().mockResolvedValue(undefined),
      deleteMany: vi.fn().mockResolvedValue(undefined),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({ name: 'Admin User' }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue(undefined),
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      // Create a tx proxy that delegates to the same prisma mocks
      const self = makePrisma();
      return fn(self);
    }),
    ...overrides,
  };
}

const ACTIVE_PRIZE = {
  id: 'prize-001',
  title: 'Campanha Maio',
  description: 'Top afiliados',
  prizeType: PrizeType.BALANCE,
  prizeValue: decimal(500),
  prizeLabel: 'R$ 500',
  icon: '🏆',
  startDate: new Date('2026-05-01'),
  endDate: new Date('2026-05-31'),
  winnersCount: 3,
  targetCpa: 10,
  status: PrizeStatus.ACTIVE,
  createdAt: new Date(),
  prizes: [
    {
      rank: 1,
      prizeType: PrizeType.BALANCE,
      prizeValue: decimal(500),
      prizeLabel: 'R$ 500',
      icon: '🥇',
    },
  ],
  winners: [] as { id: string; userId: string; redeemed: boolean }[],
};

const FINALIZED_PRIZE = {
  ...ACTIVE_PRIZE,
  id: 'prize-002',
  status: PrizeStatus.FINALIZED,
  finalizedById: 'admin-001',
  finalizedAt: new Date(),
};

const AUDIT_CONTEXT = {
  adminId: 'admin-001',
  adminEmail: 'admin@vexxa.com',
  ip: '127.0.0.1',
  userAgent: 'test-agent',
};

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('RankingAdminService', () => {
  let svc: RankingAdminService;
  let prisma: ReturnType<typeof makePrisma>;
  let repo: IRankingRepository;

  const mockNotificationService = {
    create: vi.fn().mockResolvedValue({}),
    createMany: vi.fn().mockResolvedValue(0),
    deleteByPrizeId: vi.fn().mockResolvedValue(0),
  };

  beforeEach(() => {
    prisma = makePrisma();
    repo = makeRepo();
    svc = new RankingAdminService(
      prisma as any,
      repo,
      mockNotificationService as any,
    );
  });

  // ─── createPrize ─────────────────────────────────────────────────────────

  describe('createPrize()', () => {
    it('throws PrizeValidationException when no prizes[] and no prizeType', async () => {
      const dto = {
        title: 'Test',
        startDate: '2026-05-01',
        endDate: '2026-05-31',
        // no prizes, no prizeType
      };

      await expect(
        svc.createPrize(
          AUDIT_CONTEXT.adminId,
          AUDIT_CONTEXT.adminEmail,
          dto as any,
          AUDIT_CONTEXT.ip,
          AUDIT_CONTEXT.userAgent,
        ),
      ).rejects.toThrow(PrizeValidationException);
    });

    it('creates prize with audit log and serialized Decimal', async () => {
      const dto = {
        title: 'Campanha Junho',
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        prizeType: PrizeType.BALANCE,
        prizeValue: 500,
        prizeLabel: 'R$ 500',
      };

      prisma.rankingPrize.create.mockResolvedValue({
        id: 'prize-new',
        ...dto,
        prizeValue: decimal(500),
        prizes: [],
      });

      const result = await svc.createPrize(
        AUDIT_CONTEXT.adminId,
        AUDIT_CONTEXT.adminEmail,
        dto as any,
        AUDIT_CONTEXT.ip,
        AUDIT_CONTEXT.userAgent,
      );

      expect(result.prizeValue).toBe(500);
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'prize_created',
            resource: 'RankingPrize',
          }),
        }),
      );
    });
  });

  // ─── previewWinners: maxWinsPerUser cap (TARGET) ──────────────────────────

  describe('previewWinners() — maxWinsPerUser cap', () => {
    function targetPrize(maxWinsPerUser: number | null) {
      return {
        id: 'p1',
        status: 'ACTIVE',
        title: 'Meta',
        startDate: new Date('2026-05-01'),
        endDate: new Date('2026-05-31'),
        winnersCount: 1,
        targetCpa: 10,
        bettingHouse: null,
        winMode: 'TARGET',
        cpaFromNetwork: false,
        maxWinsPerUser,
        prizeType: PrizeType.BALANCE,
        prizeValue: decimal(100),
        prizeLabel: 'R$ 100',
        prizes: [],
      };
    }

    it('caps wins per user for TARGET when maxWinsPerUser is set', async () => {
      prisma.rankingPrize.findUnique.mockResolvedValue(targetPrize(1));
      (repo.calculateWinners as any).mockResolvedValue([
        { userId: 'u1', userName: 'U1', campaignId: 'c1', cpaQualified: 30 },
        { userId: 'u1', userName: 'U1', campaignId: 'c2', cpaQualified: 20 },
        { userId: 'u2', userName: 'U2', campaignId: 'c3', cpaQualified: 15 },
      ]);

      const res = await svc.previewWinners('p1');

      expect(res.winners).toHaveLength(2);
      expect(
        res.winners.filter((w: { userId: string }) => w.userId === 'u1'),
      ).toHaveLength(1);
    });

    it('keeps every win when maxWinsPerUser is null (unlimited)', async () => {
      prisma.rankingPrize.findUnique.mockResolvedValue(targetPrize(null));
      (repo.calculateWinners as any).mockResolvedValue([
        { userId: 'u1', userName: 'U1', campaignId: 'c1', cpaQualified: 30 },
        { userId: 'u1', userName: 'U1', campaignId: 'c2', cpaQualified: 20 },
      ]);

      const res = await svc.previewWinners('p1');

      expect(res.winners).toHaveLength(2);
    });
  });

  // ─── awardTargetWinners (premiação incremental TARGET) ────────────────────

  describe('awardTargetWinners()', () => {
    const targetPrize = {
      ...ACTIVE_PRIZE,
      winMode: 'TARGET',
      cpaFromNetwork: false,
      maxWinsPerUser: 1,
      bettingHouse: null,
      endDate: new Date('2099-12-31'),
      prizes: [],
    };

    it('awards only new winners: dedupes by campaignId and respects maxWinsPerUser incl. existing', async () => {
      prisma.rankingPrize.findUnique.mockResolvedValue(targetPrize);
      // u1 já ganhou via c1.
      prisma.prizeWinner.findMany.mockResolvedValue([
        { userId: 'u1', campaignId: 'c1' },
      ]);
      (repo.calculateWinners as any).mockResolvedValue([
        { userId: 'u1', userName: 'U1', campaignId: 'c1', cpaQualified: 30 },
        { userId: 'u1', userName: 'U1', campaignId: 'c2', cpaQualified: 20 },
        { userId: 'u2', userName: 'U2', campaignId: 'c3', cpaQualified: 15 },
      ]);

      const res = await svc.awardTargetWinners('prize-001');

      // c1 já premiado; u1 já no cap (1) → c2 pulado; só u2/c3 entra.
      expect(res.awarded).toBe(1);
      expect(prisma.prizeWinner.createMany).toHaveBeenCalledTimes(1);
      const arg = (prisma.prizeWinner.createMany as any).mock.calls[0][0];
      expect(arg.data).toHaveLength(1);
      expect(arg.data[0]).toMatchObject({ userId: 'u2', campaignId: 'c3' });
    });

    it('does nothing for non-TARGET prizes', async () => {
      prisma.rankingPrize.findUnique.mockResolvedValue({
        ...targetPrize,
        winMode: 'RANKING',
      });
      const res = await svc.awardTargetWinners('prize-001');
      expect(res.awarded).toBe(0);
      expect(prisma.prizeWinner.createMany).not.toHaveBeenCalled();
    });

    it('does nothing when prize is not ACTIVE', async () => {
      prisma.rankingPrize.findUnique.mockResolvedValue({
        ...targetPrize,
        status: PrizeStatus.FINALIZED,
      });
      const res = await svc.awardTargetWinners('prize-001');
      expect(res.awarded).toBe(0);
      expect(prisma.prizeWinner.createMany).not.toHaveBeenCalled();
    });
  });

  // ─── updatePrize ─────────────────────────────────────────────────────────

  describe('updatePrize()', () => {
    it('throws PrizeNotFoundException when prize does not exist', async () => {
      await expect(svc.updatePrize('non-existent', {} as any)).rejects.toThrow(
        PrizeNotFoundException,
      );
    });

    it('throws PrizeNotActiveException when prize is finalized', async () => {
      prisma.rankingPrize.findUnique.mockResolvedValue(FINALIZED_PRIZE);

      await expect(
        svc.updatePrize('prize-002', { title: 'Updated' } as any),
      ).rejects.toThrow(PrizeNotActiveException);
    });

    it('updates prize inside a transaction when prizes[] is provided', async () => {
      prisma.rankingPrize.findUnique.mockResolvedValue(ACTIVE_PRIZE);

      await svc.updatePrize('prize-001', {
        title: 'Updated',
        prizes: [{ rank: 1, prizeType: PrizeType.BALANCE, prizeValue: 500 }],
      } as any);

      // Verify $transaction was called (F4 fix)
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  // ─── deletePrize ─────────────────────────────────────────────────────────

  describe('deletePrize()', () => {
    it('throws PrizeNotFoundException when prize does not exist', async () => {
      await expect(svc.deletePrize('non-existent')).rejects.toThrow(
        PrizeNotFoundException,
      );
    });

    it('blocks deletion of finalized prize with redeemed winners', async () => {
      prisma.rankingPrize.findUnique.mockResolvedValue({
        ...FINALIZED_PRIZE,
        winners: [{ redeemed: true }],
      });

      await expect(svc.deletePrize('prize-002')).rejects.toThrow(
        /prêmios já resgatados/i,
      );
    });

    it('deletes active prize successfully', async () => {
      prisma.rankingPrize.findUnique.mockResolvedValue(ACTIVE_PRIZE);

      const result = await svc.deletePrize('prize-001');

      expect(result.success).toBe(true);
      expect(prisma.rankingPrize.delete).toHaveBeenCalledWith({
        where: { id: 'prize-001' },
      });
    });
  });

  // ─── previewWinners ──────────────────────────────────────────────────────

  describe('previewWinners()', () => {
    it('throws PrizeNotFoundException when prize does not exist', async () => {
      await expect(svc.previewWinners('non-existent')).rejects.toThrow(
        PrizeNotFoundException,
      );
    });

    it('throws PrizeAlreadyFinalizedException for finalized prize', async () => {
      prisma.rankingPrize.findUnique.mockResolvedValue(FINALIZED_PRIZE);

      await expect(svc.previewWinners('prize-002')).rejects.toThrow(
        PrizeAlreadyFinalizedException,
      );
    });

    it('returns empty winners array when no candidates found', async () => {
      prisma.rankingPrize.findUnique.mockResolvedValue(ACTIVE_PRIZE);
      (repo.calculateWinners as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const result = await svc.previewWinners('prize-001');

      expect(result.winners).toEqual([]);
      expect(result.message).toBeDefined();
    });
  });

  // ─── finalizePrize ───────────────────────────────────────────────────────

  describe('finalizePrize()', () => {
    it('throws PrizeValidationException when not confirmed', async () => {
      await expect(
        svc.finalizePrize(
          AUDIT_CONTEXT.adminId,
          AUDIT_CONTEXT.adminEmail,
          'prize-001',
          { confirmed: false } as any,
          AUDIT_CONTEXT.ip,
          AUDIT_CONTEXT.userAgent,
        ),
      ).rejects.toThrow(PrizeValidationException);
    });

    it('throws PrizeAlreadyFinalizedException when already finalized', async () => {
      prisma.rankingPrize.findUnique.mockResolvedValue(FINALIZED_PRIZE);

      await expect(
        svc.finalizePrize(
          AUDIT_CONTEXT.adminId,
          AUDIT_CONTEXT.adminEmail,
          'prize-002',
          { confirmed: true } as any,
          AUDIT_CONTEXT.ip,
          AUDIT_CONTEXT.userAgent,
        ),
      ).rejects.toThrow(PrizeAlreadyFinalizedException);
    });
  });

  // ─── revertPrize ─────────────────────────────────────────────────────────

  describe('revertPrize()', () => {
    it('throws PrizeRevertBlockedException when winners have redeemed', async () => {
      prisma.rankingPrize.findUnique.mockResolvedValue({
        ...FINALIZED_PRIZE,
        winners: [{ id: 'w1', userId: 'u1', redeemed: true }],
      });

      await expect(
        svc.revertPrize(
          AUDIT_CONTEXT.adminId,
          AUDIT_CONTEXT.adminEmail,
          'prize-002',
          AUDIT_CONTEXT.ip,
          AUDIT_CONTEXT.userAgent,
        ),
      ).rejects.toThrow(PrizeRevertBlockedException);
    });
  });

  // ─── endPrize ────────────────────────────────────────────────────────────

  describe('endPrize()', () => {
    it('throws PrizeNotFoundException when prize does not exist', async () => {
      await expect(svc.endPrize('non-existent')).rejects.toThrow(
        PrizeNotFoundException,
      );
    });

    it('throws PrizeNotActiveException when prize is not active', async () => {
      prisma.rankingPrize.findUnique.mockResolvedValue(FINALIZED_PRIZE);

      await expect(svc.endPrize('prize-002')).rejects.toThrow(
        PrizeNotActiveException,
      );
    });

    it('ends active prize and returns success', async () => {
      prisma.rankingPrize.findUnique.mockResolvedValue(ACTIVE_PRIZE);

      const result = await svc.endPrize('prize-001');

      expect(result.success).toBe(true);
      expect(prisma.rankingPrize.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: PrizeStatus.ENDED },
        }),
      );
    });
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RankingService } from './ranking.service.js';
import { PrizeStatus, PrizeType } from '@prisma/client';
import {
  PrizeNotFoundException,
  PrizeRedemptionBlockedException,
  WinnerNotAuthorizedException,
} from '../domain/exceptions/ranking.exceptions.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

const decimal = (n: number) => ({ toNumber: () => n });

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    rankingPrize: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    prizeWinner: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(undefined),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({ name: 'Test User' }),
      update: vi.fn().mockResolvedValue(undefined),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue(undefined),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        prizeWinner: {
          update: vi.fn().mockResolvedValue(undefined),
        },
        user: {
          update: vi.fn().mockResolvedValue(undefined),
        },
      };
      return fn(tx);
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
    {
      rank: 2,
      prizeType: PrizeType.BALANCE,
      prizeValue: decimal(300),
      prizeLabel: 'R$ 300',
      icon: '🥈',
    },
  ],
};

const FINALIZED_PRIZE = {
  id: 'prize-002',
  title: 'Campanha Abril',
  status: PrizeStatus.FINALIZED,
};

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('RankingService', () => {
  let svc: RankingService;
  let prisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    prisma = makePrisma();
    const repo = { calculateWinners: vi.fn().mockResolvedValue([]) };
    svc = new RankingService(prisma as any, repo as any);
  });

  // ─── getActivePrizes ─────────────────────────────────────────────────────

  describe('getActivePrizes()', () => {
    it('returns serialized active prizes with Decimal converted', async () => {
      prisma.rankingPrize.findMany.mockResolvedValue([ACTIVE_PRIZE]);

      const result = await svc.getActivePrizes();

      expect(result.data).toHaveLength(1);
      expect(result.data[0].prizeValue).toBe(500);
      expect(result.data[0].prizes[0].prizeValue).toBe(500);
      expect(result.data[0].prizes[1].prizeValue).toBe(300);
      expect(prisma.rankingPrize.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: PrizeStatus.ACTIVE },
        }),
      );
    });

    it('returns empty array when no active prizes exist', async () => {
      prisma.rankingPrize.findMany.mockResolvedValue([]);

      const result = await svc.getActivePrizes();

      expect(result.data).toEqual([]);
    });
  });

  // ─── getMyRewards ─────────────────────────────────────────────────────────

  describe('getMyRewards()', () => {
    it('returns only rewards from finalized prizes', async () => {
      const winners = [
        {
          rank: 1,
          prizeType: PrizeType.BALANCE,
          prizeValue: decimal(500),
          prizeLabel: 'R$ 500',
          cpaAchieved: 15,
          redeemed: false,
          redeemedAt: null,
          createdAt: new Date(),
          rankingPrize: {
            id: 'prize-002',
            title: 'Campanha Abril',
            icon: '🏆',
            prizeType: PrizeType.BALANCE,
            prizeValue: decimal(500),
            prizeLabel: 'R$ 500',
            finalizedAt: new Date(),
            status: PrizeStatus.FINALIZED,
            prizes: [
              {
                rank: 1,
                prizeType: PrizeType.BALANCE,
                prizeValue: decimal(500),
                prizeLabel: 'R$ 500',
                icon: '🥇',
              },
            ],
          },
        },
        {
          rank: 1,
          prizeType: PrizeType.BALANCE,
          prizeValue: decimal(100),
          prizeLabel: 'R$ 100',
          cpaAchieved: 5,
          redeemed: false,
          redeemedAt: null,
          createdAt: new Date(),
          rankingPrize: {
            id: 'prize-003',
            title: 'Campanha Ativa',
            icon: '🏆',
            prizeType: PrizeType.BALANCE,
            prizeValue: decimal(100),
            prizeLabel: 'R$ 100',
            finalizedAt: null,
            status: PrizeStatus.ACTIVE, // not finalized — should be excluded
            prizes: [],
          },
        },
      ];

      prisma.prizeWinner.findMany.mockResolvedValue(winners);

      const result = await svc.getMyRewards('user-001');

      expect(result.data).toHaveLength(1);
      expect(result.data[0].prizeId).toBe('prize-002');
    });

    it('includes rewards from ACTIVE TARGET prizes (auto-awarded by hourly cron)', async () => {
      prisma.prizeWinner.findMany.mockResolvedValue([
        {
          rank: 1,
          prizeType: PrizeType.BALANCE,
          prizeValue: decimal(100),
          prizeLabel: 'R$ 100',
          cpaAchieved: 12,
          redeemed: false,
          redeemedAt: null,
          createdAt: new Date(),
          rankingPrize: {
            id: 'prize-target',
            title: 'Meta de CPA',
            icon: '🏆',
            prizeType: PrizeType.BALANCE,
            prizeValue: decimal(100),
            prizeLabel: 'R$ 100',
            finalizedAt: null,
            status: PrizeStatus.ACTIVE,
            winMode: 'TARGET',
            prizes: [],
          },
        },
      ]);

      const result = await svc.getMyRewards('user-001');

      expect(result.data).toHaveLength(1);
      expect(result.data[0].prizeId).toBe('prize-target');
    });
  });

  // ─── redeemPrize ──────────────────────────────────────────────────────────

  describe('redeemPrize()', () => {
    it('throws PrizeNotFoundException when prize does not exist', async () => {
      prisma.rankingPrize.findUnique.mockResolvedValue(null);

      await expect(
        svc.redeemPrize(
          'user-001',
          'u@vexxa.com',
          'non-existent',
          {},
          '127.0.0.1',
          'test-agent',
        ),
      ).rejects.toThrow(PrizeNotFoundException);
    });

    it('throws PrizeRedemptionBlockedException when prize is not finalized', async () => {
      prisma.rankingPrize.findUnique.mockResolvedValue({
        ...ACTIVE_PRIZE,
        status: PrizeStatus.ACTIVE,
      });

      await expect(
        svc.redeemPrize(
          'user-001',
          'u@vexxa.com',
          'prize-001',
          {},
          '127.0.0.1',
          'test-agent',
        ),
      ).rejects.toThrow(PrizeRedemptionBlockedException);
    });

    it('throws WinnerNotAuthorizedException when user is not a winner', async () => {
      prisma.rankingPrize.findUnique.mockResolvedValue(FINALIZED_PRIZE);
      prisma.prizeWinner.findFirst.mockResolvedValue(null);

      await expect(
        svc.redeemPrize(
          'user-001',
          'u@vexxa.com',
          'prize-002',
          {},
          '127.0.0.1',
          'test-agent',
        ),
      ).rejects.toThrow(WinnerNotAuthorizedException);
    });

    it('throws PrizeRedemptionBlockedException when already redeemed', async () => {
      prisma.rankingPrize.findUnique.mockResolvedValue(FINALIZED_PRIZE);
      prisma.prizeWinner.findFirst.mockResolvedValue({
        id: 'winner-001',
        prizeType: PrizeType.BALANCE,
        prizeValue: decimal(500),
        rank: 1,
        redeemed: true,
      });

      await expect(
        svc.redeemPrize(
          'user-001',
          'u@vexxa.com',
          'prize-002',
          { rank: 1 },
          '127.0.0.1',
          'test-agent',
        ),
      ).rejects.toThrow(PrizeRedemptionBlockedException);
    });

    it('redeems prize successfully and credits bonusBalance for BALANCE type', async () => {
      const winnerRecord = {
        id: 'winner-001',
        prizeType: PrizeType.BALANCE,
        prizeValue: decimal(500),
        rank: 1,
        redeemed: false,
      };

      prisma.rankingPrize.findUnique.mockResolvedValue(FINALIZED_PRIZE);
      prisma.prizeWinner.findFirst.mockResolvedValue(winnerRecord);

      const result = await svc.redeemPrize(
        'user-001',
        'u@vexxa.com',
        'prize-002',
        { rank: 1 },
        '127.0.0.1',
        'test-agent',
      );

      expect(result.success).toBe(true);
      // Verify transaction was called
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // Verify audit log was created
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'prize_redeemed',
            resource: 'RankingPrize',
          }),
        }),
      );
    });

    it('allows redeem for an ACTIVE TARGET prize without finalize', async () => {
      prisma.rankingPrize.findUnique.mockResolvedValue({
        ...ACTIVE_PRIZE,
        status: PrizeStatus.ACTIVE,
        winMode: 'TARGET',
      });
      prisma.prizeWinner.findFirst.mockResolvedValue({
        id: 'winner-t',
        prizeType: PrizeType.BALANCE,
        prizeValue: decimal(100),
        rank: 1,
        redeemed: false,
      });

      const result = await svc.redeemPrize(
        'user-001',
        'u@vexxa.com',
        'prize-001',
        { rank: 1 },
        '127.0.0.1',
        'test-agent',
      );

      expect(result.success).toBe(true);
    });
  });
});

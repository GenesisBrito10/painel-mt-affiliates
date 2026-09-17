import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrizeStatus, PrizeType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  PrizeNotFoundException,
  PrizeRedemptionBlockedException,
  WinnerNotAuthorizedException,
} from '../domain/exceptions/ranking.exceptions.js';
import {
  RANKING_REPOSITORY,
  type IRankingRepository,
} from '../domain/ports/ranking.repository.js';
import type {
  MyReward,
  ActivePrize,
  RankPrizeInfo,
  LeaderboardEntry,
  LeaderboardContext,
  PrizeShowcase,
  PrizeWinnerEntry,
  RankingCandidate,
} from '../domain/types/ranking.types.js';
import type { RedeemPrizeDto } from './dto/ranking.dto.js';

@Injectable()
export class RankingService {
  private readonly logger = new Logger(RankingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(RANKING_REPOSITORY)
    private readonly repo: IRankingRepository,
  ) {}

  // ─── GET /v1/prizes/active ────────────────────────────────────────────────

  async getActivePrizes(): Promise<{ data: ActivePrize[] }> {
    const prizes = await this.prisma.rankingPrize.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        title: true,
        description: true,
        prizeType: true,
        prizeValue: true,
        prizeLabel: true,
        icon: true,
        startDate: true,
        endDate: true,
        winnersCount: true,
        targetCpa: true,
        bettingHouse: true,
        winMode: true,
        status: true,
        createdAt: true,
        prizes: {
          select: {
            rank: true,
            prizeType: true,
            prizeValue: true,
            prizeLabel: true,
            icon: true,
          },
          orderBy: { rank: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const data: ActivePrize[] = prizes.map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      prizeType: p.prizeType,
      prizeValue: p.prizeValue.toNumber(),
      prizeLabel: p.prizeLabel,
      icon: p.icon,
      startDate: p.startDate,
      endDate: p.endDate,
      winnersCount: p.winnersCount,
      targetCpa: p.targetCpa,
      bettingHouse: p.bettingHouse ?? null,
      winMode: p.winMode,
      status: p.status,
      createdAt: p.createdAt,
      prizes: p.prizes.map(
        (rp): RankPrizeInfo => ({
          rank: rp.rank,
          prizeType: rp.prizeType,
          prizeValue: rp.prizeValue.toNumber(),
          prizeLabel: rp.prizeLabel,
          icon: rp.icon,
        }),
      ),
    }));

    return { data };
  }

  // ─── GET /v1/prizes/my-rewards ────────────────────────────────────────────

  async getMyRewards(userId: string): Promise<{ data: MyReward[] }> {
    const winners = await this.prisma.prizeWinner.findMany({
      where: { userId },
      include: {
        rankingPrize: {
          select: {
            id: true,
            title: true,
            icon: true,
            prizeType: true,
            prizeValue: true,
            prizeLabel: true,
            finalizedAt: true,
            status: true,
            winMode: true,
            prizes: {
              select: {
                rank: true,
                prizeType: true,
                prizeValue: true,
                prizeLabel: true,
                icon: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Inclui vencedores de prêmios FINALIZED e, no modo TARGET (Meta de CPA),
    // também os de prêmios ainda ATIVOS — esses são premiados de hora em hora
    // pelo cron e podem ser resgatados antes do fim.
    const rewards: MyReward[] = winners
      .filter(
        (w) =>
          w.rankingPrize.status === PrizeStatus.FINALIZED ||
          w.rankingPrize.winMode === 'TARGET',
      )
      .map((w) => {
        const rp = w.rankingPrize;
        const rankPrize = rp.prizes.find((p) => p.rank === w.rank);

        return {
          prizeId: rp.id,
          title: rp.title,
          prizeType: w.prizeType || rankPrize?.prizeType || rp.prizeType,
          prizeValue:
            w.prizeValue?.toNumber() ??
            rankPrize?.prizeValue?.toNumber() ??
            rp.prizeValue.toNumber(),
          prizeLabel: w.prizeLabel || rankPrize?.prizeLabel || rp.prizeLabel,
          icon: rankPrize?.icon || rp.icon,
          rank: w.rank,
          cpaAchieved: w.cpaAchieved,
          redeemed: w.redeemed,
          redeemedAt: w.redeemedAt,
          finalizedAt: rp.finalizedAt,
        };
      });

    return { data: rewards };
  }

  // ─── POST /v1/prizes/:id/redeem ──────────────────────────────────────────

  async redeemPrize(
    userId: string,
    userEmail: string,
    prizeId: string,
    dto: RedeemPrizeDto,
    ip: string,
    userAgent: string,
  ): Promise<{ success: boolean; message: string }> {
    const prize = await this.prisma.rankingPrize.findUnique({
      where: { id: prizeId },
      select: { id: true, title: true, status: true, winMode: true },
    });

    if (!prize) throw new PrizeNotFoundException(prizeId);
    // RANKING: só resgata após finalize. TARGET (Meta de CPA): resgatável assim
    // que vira vencedor (cron premia durante o período), sem esperar finalize.
    const redeemable =
      prize.status === PrizeStatus.FINALIZED ||
      (prize.winMode === 'TARGET' &&
        (prize.status === PrizeStatus.ACTIVE ||
          prize.status === PrizeStatus.ENDED));
    if (!redeemable) {
      throw new PrizeRedemptionBlockedException('Premiação não finalizada.');
    }

    // Find the winner record for this user
    const whereClause: {
      rankingPrizeId: string;
      userId: string;
      rank?: number;
      redeemed?: boolean;
    } = {
      rankingPrizeId: prizeId,
      userId,
    };

    if (dto.rank) {
      whereClause.rank = dto.rank;
    } else {
      whereClause.redeemed = false;
    }

    const winner = await this.prisma.prizeWinner.findFirst({
      where: whereClause,
    });

    if (!winner) {
      throw new WinnerNotAuthorizedException(userId, prizeId);
    }
    if (winner.redeemed) {
      throw new PrizeRedemptionBlockedException('Prêmio já resgatado.');
    }

    const winnerPrizeType = winner.prizeType || 'OTHER';
    const winnerPrizeValue = winner.prizeValue?.toNumber() ?? 0;

    // Transaction: update winner + credit balance if applicable
    await this.prisma.$transaction(async (tx) => {
      const updateData: {
        redeemed: boolean;
        redeemedAt: Date;
        balanceCredited?: boolean;
      } = {
        redeemed: true,
        redeemedAt: new Date(),
      };

      if (winnerPrizeType === PrizeType.BALANCE && winnerPrizeValue > 0) {
        await tx.user.update({
          where: { id: userId },
          data: { bonusBalance: { increment: winnerPrizeValue } },
        });
        updateData.balanceCredited = true;
      }

      await tx.prizeWinner.update({
        where: { id: winner.id },
        data: updateData,
      });
    });

    // Audit log (outside transaction — non-critical)
    // Resolve userName from DB (not in JWT)
    const dbUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });

    await this.prisma.auditLog.create({
      data: {
        userId,
        userName: dbUser?.name ?? 'Unknown',
        userEmail,
        action: 'prize_redeemed',
        resource: 'RankingPrize',
        method: 'POST',
        path: `/prizes/${prizeId}/redeem`,
        ip,
        userAgent,
        details: {
          prizeId,
          prizeTitle: prize.title,
          prizeType: winnerPrizeType,
          prizeValue: winnerPrizeValue,
          rank: winner.rank,
        },
      },
    });

    this.logger.log(
      `User ${userId} redeemed prize ${prizeId} (rank ${winner.rank}, type=${winnerPrizeType}, value=${winnerPrizeValue})`,
    );

    return { success: true, message: 'Prêmio resgatado com sucesso!' };
  }

  // ─── GET /v1/prizes/leaderboard ──────────────────────────────────────────

  async getLeaderboard(
    userId: string,
    options: {
      prizeId?: string;
      period?: 'month' | 'week' | 'today';
      bettingHouse?: string;
    } = {},
  ): Promise<{ data: LeaderboardEntry[]; context: LeaderboardContext | null }> {
    const now = new Date();
    let startDate: Date;
    let endDate: Date = now;
    let context: LeaderboardContext | null = null;
    // House scope: prize-bound uses the prize's house; period board uses the query filter.
    let house: string | null = options.bettingHouse
      ? options.bettingHouse
      : null;

    if (options.prizeId) {
      // Use the prize's own date window
      const prize = await this.prisma.rankingPrize.findUnique({
        where: { id: options.prizeId },
        select: {
          id: true,
          title: true,
          description: true,
          icon: true,
          prizeLabel: true,
          targetCpa: true,
          winnersCount: true,
          bettingHouse: true,
          winMode: true,
          cpaFromNetwork: true,
          startDate: true,
          endDate: true,
          status: true,
        },
      });

      if (prize) {
        startDate = prize.startDate;
        endDate = prize.endDate < now ? prize.endDate : now;
        house = prize.bettingHouse ?? null;
        context = {
          prizeId: prize.id,
          title: prize.title,
          description: prize.description,
          icon: prize.icon,
          prizeLabel: prize.prizeLabel,
          targetCpa: prize.targetCpa,
          winnersCount: prize.winnersCount,
          bettingHouse: prize.bettingHouse ?? null,
          startDate: prize.startDate,
          endDate: prize.endDate,
          status: prize.status,
        };

        // Classificação ligada a um prêmio usa a MESMA regra da prévia do admin
        // (repo.calculateWinners): respeita winMode (TARGET=meta / RANKING=top N),
        // mínimo de CPA e cpaFromNetwork (soma da rede). computeStandings genérico
        // mostrava CPA individual cru — errado p/ prêmios de meta/rede.
        const candidates = await this.repo.calculateWinners(
          startDate,
          endDate,
          prize.winnersCount,
          prize.targetCpa,
          prize.bettingHouse,
          prize.winMode,
          prize.cpaFromNetwork,
        );
        const data = await this.candidatesToEntries(
          candidates,
          startDate,
          endDate,
          house,
          userId,
        );
        return { data, context };
      } else {
        // Prize not found — fall back to period
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      }
    } else {
      // Period-based window
      const period = options.period ?? 'month';
      switch (period) {
        case 'today':
          startDate = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate(),
          );
          break;
        case 'week': {
          const dayOfWeek = now.getDay();
          startDate = new Date(
            now.getFullYear(),
            now.getMonth(),
            now.getDate() - dayOfWeek,
          );
          break;
        }
        case 'month':
        default:
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
      }
    }

    const data = await this.computeStandings(
      startDate,
      endDate,
      house,
      50,
      userId,
    );
    return { data, context };
  }

  /**
   * Aggregates CPA + FTD per affiliate within a window and returns the top
   * `take` ranked by CPA. Shared by the leaderboard and the prize showcase.
   */
  private async computeStandings(
    startDate: Date,
    endDate: Date,
    house: string | null,
    take: number,
    userId: string,
  ): Promise<LeaderboardEntry[]> {
    // 1. Build campaignId → { userId, userName } map.
    //    Exclude external (third-party shadow) users from the leaderboard.
    const links = await this.prisma.affiliateLink.findMany({
      where: { campaignId: { not: '' }, user: { isExternal: false } },
      select: {
        campaignId: true,
        userId: true,
        user: { select: { name: true } },
      },
      distinct: ['campaignId'],
    });

    const campaignMap = new Map<string, { userId: string; userName: string }>();
    for (const link of links) {
      campaignMap.set(link.campaignId, {
        userId: link.userId,
        userName: link.user.name,
      });
    }

    if (campaignMap.size === 0) return [];

    // 2. Aggregate CPA + FTD per campaignId within the resolved window.
    //    house set → top CPA dessa casa; null → soma todas as casas.
    const aggregation = await this.prisma.affiliateData.groupBy({
      by: ['campaignId'],
      where: {
        campaignId: { in: Array.from(campaignMap.keys()) },
        date: { gte: startDate, lte: endDate },
        ...(house ? { bettingHouse: house } : {}),
      },
      _sum: { cpaQualified: true, ftds: true },
      orderBy: { _sum: { cpaQualified: 'desc' } },
      take,
    });

    return aggregation
      .filter((row) => (row._sum.cpaQualified ?? 0) > 0)
      .map((row, index) => {
        const info = campaignMap.get(row.campaignId);
        const entryUserId = info?.userId ?? '';
        return {
          rank: index + 1,
          userId: entryUserId,
          userName: info?.userName ?? row.campaignId,
          cpa: row._sum.cpaQualified ?? 0,
          ftd: row._sum.ftds ?? 0,
          isMe: entryUserId === userId,
        };
      });
  }

  /**
   * Converte os candidatos do repo (já ranqueados por CPA/rede e filtrados por
   * regra do prêmio) em entradas do leaderboard, agregando o FTD de cada
   * campanha dentro da mesma janela/casa para a coluna FTD.
   */
  private async candidatesToEntries(
    candidates: RankingCandidate[],
    startDate: Date,
    endDate: Date,
    house: string | null,
    userId: string,
  ): Promise<LeaderboardEntry[]> {
    if (candidates.length === 0) return [];

    const campaignIds = candidates.map((c) => c.campaignId).filter(Boolean);
    const ftdAgg = campaignIds.length
      ? await this.prisma.affiliateData.groupBy({
          by: ['campaignId'],
          where: {
            campaignId: { in: campaignIds },
            date: { gte: startDate, lte: endDate },
            ...(house ? { bettingHouse: house } : {}),
          },
          _sum: { ftds: true },
        })
      : [];
    const ftdMap = new Map(ftdAgg.map((r) => [r.campaignId, r._sum.ftds ?? 0]));

    return candidates.map((c, index) => ({
      rank: index + 1,
      userId: c.userId,
      userName: c.userName,
      cpa: c.cpaQualified,
      ftd: ftdMap.get(c.campaignId) ?? 0,
      isMe: c.userId === userId,
    }));
  }

  // ─── GET /v1/prizes/showcase ──────────────────────────────────────────────
  // Premiações ativas + encerradas, cada uma com os usuários que estão
  // ganhando (ao vivo) ou que ganharam (vencedores, quando FINALIZED).

  async getPrizeShowcase(userId: string): Promise<{ data: PrizeShowcase[] }> {
    const prizeSelect = {
      id: true,
      title: true,
      description: true,
      prizeType: true,
      prizeValue: true,
      prizeLabel: true,
      icon: true,
      startDate: true,
      endDate: true,
      winnersCount: true,
      targetCpa: true,
      bettingHouse: true,
      winMode: true,
      cpaFromNetwork: true,
      status: true,
      createdAt: true,
      prizes: {
        select: {
          rank: true,
          prizeType: true,
          prizeValue: true,
          prizeLabel: true,
          icon: true,
        },
        orderBy: { rank: 'asc' as const },
      },
    };

    // Ativas/encerradas-sem-finalizar primeiro; finalizadas recentes depois.
    const [live, finalized] = await Promise.all([
      this.prisma.rankingPrize.findMany({
        where: { status: { in: [PrizeStatus.ACTIVE, PrizeStatus.ENDED] } },
        select: prizeSelect,
        orderBy: { endDate: 'asc' },
      }),
      this.prisma.rankingPrize.findMany({
        where: { status: PrizeStatus.FINALIZED },
        select: prizeSelect,
        orderBy: { finalizedAt: 'desc' },
        take: 10,
      }),
    ]);

    const now = new Date();
    const data: PrizeShowcase[] = [];

    for (const p of [...live, ...finalized]) {
      const base: ActivePrize = {
        id: p.id,
        title: p.title,
        description: p.description,
        prizeType: p.prizeType,
        prizeValue: p.prizeValue.toNumber(),
        prizeLabel: p.prizeLabel,
        icon: p.icon,
        startDate: p.startDate,
        endDate: p.endDate,
        winnersCount: p.winnersCount,
        targetCpa: p.targetCpa,
        bettingHouse: p.bettingHouse ?? null,
        winMode: p.winMode,
        status: p.status,
        createdAt: p.createdAt,
        prizes: p.prizes.map(
          (rp): RankPrizeInfo => ({
            rank: rp.rank,
            prizeType: rp.prizeType,
            prizeValue: rp.prizeValue.toNumber(),
            prizeLabel: rp.prizeLabel,
            icon: rp.icon,
          }),
        ),
      };

      const labelForRank = (rank: number): string =>
        base.prizes.find((rp) => rp.rank === rank)?.prizeLabel ||
        base.prizeLabel;

      let winners: PrizeWinnerEntry[];
      const final = p.status === PrizeStatus.FINALIZED;
      // FINALIZED → vencedores definitivos persistidos. Demais (ativos) → prévia
      // ao vivo pela MESMA regra do admin (repo.calculateWinners): respeita
      // winMode/meta/cpaFromNetwork. Antes usava CPA individual cru — errado p/
      // prêmios de meta e de rede.
      const liveStandings = !final;

      if (final) {
        // Vencedores definitivos persistidos no momento da finalização.
        const rows = await this.prisma.prizeWinner.findMany({
          where: { rankingPrizeId: p.id },
          orderBy: { rank: 'asc' },
          take: p.winnersCount,
        });
        winners = rows.map((w) => ({
          rank: w.rank,
          userId: w.userId,
          userName: w.userName,
          cpa: w.cpaAchieved,
          prizeLabel: w.prizeLabel || labelForRank(w.rank),
          isMe: w.userId === userId,
        }));
      } else {
        // Prévia ao vivo dos vencedores, por tipo de prêmio.
        const start = p.startDate;
        const end = p.endDate < now ? p.endDate : now;
        const candidates = await this.repo.calculateWinners(
          start,
          end,
          p.winnersCount,
          p.targetCpa,
          p.bettingHouse,
          p.winMode,
          p.cpaFromNetwork,
        );
        winners = candidates.map((c, index) => ({
          rank: index + 1,
          userId: c.userId,
          userName: c.userName,
          cpa: c.cpaQualified,
          prizeLabel: labelForRank(index + 1),
          isMe: c.userId === userId,
        }));
      }

      data.push({
        ...base,
        final,
        liveStandings,
        cpaFromNetwork: p.cpaFromNetwork,
        winners,
      });
    }

    return { data };
  }
}

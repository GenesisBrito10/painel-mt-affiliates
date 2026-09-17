import { Injectable } from '@nestjs/common';
import { PrizeWinMode } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { NETWORK_LEVEL_CAP } from '../../../dashboard/application/dashboard-balance.service.js';
import type { IRankingRepository } from '../../domain/ports/ranking.repository.js';
import type { RankingCandidate } from '../../domain/types/ranking.types.js';

@Injectable()
export class RankingPrismaRepository implements IRankingRepository {
  constructor(private readonly prisma: PrismaService) {}

  async calculateWinners(
    startDate: Date,
    endDate: Date,
    winnersCount: number,
    targetCpa: number,
    bettingHouse?: string | null,
    winMode: PrizeWinMode = PrizeWinMode.RANKING,
    cpaFromNetwork = false,
  ): Promise<RankingCandidate[]> {
    // 1. Build campaignId → { userId, userName, bettingHouse } map from AffiliateLink
    const links = await this.prisma.affiliateLink.findMany({
      where: { campaignId: { not: '' } },
      select: {
        campaignId: true,
        userId: true,
        bettingHouse: true,
        user: { select: { name: true } },
      },
      distinct: ['campaignId'],
    });

    const campaignMap = new Map<
      string,
      { userId: string; userName: string; bettingHouse: string }
    >();
    for (const link of links) {
      campaignMap.set(link.campaignId, {
        userId: link.userId,
        userName: link.user.name,
        bettingHouse: link.bettingHouse,
      });
    }

    if (campaignMap.size === 0) return [];

    // TARGET: targetCpa é a meta obrigatória (mínimo 1) — vencem os top N que atingem.
    // RANKING: targetCpa é mínimo opcional (0 = sem mínimo) — vencem os top N por mais CPA.
    const minCpa =
      winMode === PrizeWinMode.TARGET
        ? Math.max(targetCpa, 1)
        : targetCpa > 0
          ? targetCpa
          : 1;

    // TARGET (Meta de CPA): todos que atingem a meta ganham — sem limite de vagas.
    // RANKING: limitado ao número de posições/vagas.
    const limit = winMode === PrizeWinMode.TARGET ? null : winnersCount;

    return cpaFromNetwork
      ? this.networkCandidates(
          campaignMap,
          startDate,
          endDate,
          bettingHouse,
          minCpa,
          limit,
        )
      : this.individualCandidates(
          campaignMap,
          startDate,
          endDate,
          bettingHouse,
          minCpa,
          limit,
        );
  }

  // ── Individual production (top N campaigns by own CPA) ───────────────────

  private async individualCandidates(
    campaignMap: Map<
      string,
      { userId: string; userName: string; bettingHouse: string }
    >,
    startDate: Date,
    endDate: Date,
    bettingHouse: string | null | undefined,
    minCpa: number,
    limit: number | null,
  ): Promise<RankingCandidate[]> {
    const aggregation = await this.prisma.affiliateData.groupBy({
      by: ['campaignId'],
      where: {
        campaignId: { in: Array.from(campaignMap.keys()) },
        date: { gte: startDate, lte: endDate },
        ...(bettingHouse ? { bettingHouse } : {}),
      },
      _sum: { cpaQualified: true },
      orderBy: { _sum: { cpaQualified: 'desc' } },
      ...(limit ? { take: limit } : {}),
    });

    return aggregation
      .filter((row) => (row._sum.cpaQualified ?? 0) >= minCpa)
      .map((row) => {
        const info = campaignMap.get(row.campaignId);
        return {
          campaignId: row.campaignId,
          userId: info?.userId ?? '',
          userName: info?.userName ?? row.campaignId,
          cpaQualified: row._sum.cpaQualified ?? 0,
        };
      });
  }

  // ── Network production (per head, sum of downline CPA, excluding self) ───

  private async networkCandidates(
    campaignMap: Map<
      string,
      { userId: string; userName: string; bettingHouse: string }
    >,
    startDate: Date,
    endDate: Date,
    bettingHouse: string | null | undefined,
    minCpa: number,
    limit: number | null,
  ): Promise<RankingCandidate[]> {
    // Own CPA per user (no take — need all to roll up the network).
    const aggregation = await this.prisma.affiliateData.groupBy({
      by: ['campaignId'],
      where: {
        campaignId: { in: Array.from(campaignMap.keys()) },
        date: { gte: startDate, lte: endDate },
        ...(bettingHouse ? { bettingHouse } : {}),
      },
      _sum: { cpaQualified: true },
    });

    const ownCpa = new Map<string, number>();
    // firstCampaign exibe um campaignId p/ cada head na prévia. Quando o prêmio
    // tem casa específica (ex.: superbet), preferimos o campaignId daquela casa
    // — antes pegava qualquer um (ordem de distinct do Prisma), mostrando links
    // de outras casas mesmo quando a contagem só conta a casa do prêmio.
    const firstCampaign = new Map<string, string>();
    const preferredSet = new Set<string>();
    for (const [campaignId, info] of campaignMap) {
      const isPreferred = !!bettingHouse && info.bettingHouse === bettingHouse;
      const existing = firstCampaign.get(info.userId);
      if (!existing) {
        firstCampaign.set(info.userId, campaignId);
        if (isPreferred) preferredSet.add(info.userId);
      } else if (isPreferred && !preferredSet.has(info.userId)) {
        firstCampaign.set(info.userId, campaignId);
        preferredSet.add(info.userId);
      }
    }
    for (const row of aggregation) {
      const info = campaignMap.get(row.campaignId);
      if (!info) continue;
      ownCpa.set(
        info.userId,
        (ownCpa.get(info.userId) ?? 0) + (row._sum.cpaQualified ?? 0),
      );
    }

    // Referral adjacency + names.
    const allUsers = await this.prisma.user.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, referredById: true },
    });
    const nameById = new Map<string, string>();
    const children = new Map<string, string[]>();
    for (const u of allUsers) {
      nameById.set(u.id, u.name);
      if (!u.referredById) continue;
      const arr = children.get(u.referredById) ?? [];
      arr.push(u.id);
      children.set(u.referredById, arr);
    }

    // For each head (user with downline), sum downline own-CPA (BFS to cap).
    const candidates: RankingCandidate[] = [];
    for (const headId of children.keys()) {
      let sum = 0;
      const visited = new Set<string>([headId]);
      let frontier = children.get(headId) ?? [];
      for (
        let depth = 1;
        depth <= NETWORK_LEVEL_CAP && frontier.length > 0;
        depth++
      ) {
        const next: string[] = [];
        for (const id of frontier) {
          if (visited.has(id)) continue;
          visited.add(id);
          sum += ownCpa.get(id) ?? 0;
          const kids = children.get(id);
          if (kids) next.push(...kids);
        }
        frontier = next;
      }
      if (sum >= minCpa) {
        candidates.push({
          campaignId: firstCampaign.get(headId) ?? '',
          userId: headId,
          userName: nameById.get(headId) ?? headId,
          cpaQualified: sum,
        });
      }
    }

    const sorted = candidates.sort((a, b) => b.cpaQualified - a.cpaQualified);
    return limit ? sorted.slice(0, limit) : sorted;
  }
}

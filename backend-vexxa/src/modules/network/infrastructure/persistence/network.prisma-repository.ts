import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service.js';
import {
  NETWORK_REPOSITORY,
  type INetworkRepository,
} from '../../domain/ports/network.repository.js';
import type {
  NetworkMemberStats,
  ReferralEntry,
} from '../../domain/types/network.types.js';

// Profundidade máxima da BFS de convidados (espelha o NETWORK_TREE_DEPTH do
// service). Nível 1 = convidados diretos.
const REFERRALS_MAX_DEPTH = 10;

// ─── Helper ──────────────────────────────────────────────────────────────────

function toNum(val: Prisma.Decimal | null | undefined): number {
  if (!val) return 0;
  return val.toNumber();
}

@Injectable()
export class NetworkPrismaRepository implements INetworkRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Stats per campaignId ────────────────────────────────────────────────

  async aggregateStatsByCampaignId(
    campaignIds: string[],
    auditExclusion?: { startDate: Date; endDate: Date },
    dateRange?: { startDate: Date; endDate: Date },
  ): Promise<Map<string, NetworkMemberStats>> {
    if (campaignIds.length === 0) return new Map();

    const where: Prisma.AffiliateDataWhereInput = {
      campaignId: { in: campaignIds },
    };

    if (dateRange) {
      where.date = { gte: dateRange.startDate, lte: dateRange.endDate };
    }

    if (auditExclusion) {
      where.AND = [
        {
          NOT: {
            date: { gte: auditExclusion.startDate, lt: auditExclusion.endDate },
          },
        },
      ];
    }

    const rows = await this.prisma.affiliateData.groupBy({
      by: ['campaignId'],
      where,
      _sum: {
        registrations: true,
        ftds: true,
        deposit: true,
        totalCommission: true,
        revShare: true,
        cpaQualified: true,
      },
    });

    const result = new Map<string, NetworkMemberStats>();
    for (const row of rows) {
      result.set(row.campaignId, {
        registrations: row._sum.registrations ?? 0,
        ftds: row._sum.ftds ?? 0,
        deposit: toNum(row._sum.deposit),
        totalCommission: toNum(row._sum.totalCommission),
        revShare: toNum(row._sum.revShare),
        cpaQualified: row._sum.cpaQualified ?? 0,
      });
    }
    return result;
  }

  // ─── Sub-referral counts ─────────────────────────────────────────────────

  async countSubReferrals(userIds: string[]): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();

    const rows = await this.prisma.user.groupBy({
      by: ['referredById'],
      where: { referredById: { in: userIds } },
      _count: { id: true },
    });

    const result = new Map<string, number>();
    for (const row of rows) {
      if (row.referredById) {
        result.set(row.referredById, row._count.id);
      }
    }
    return result;
  }

  // ─── Fraud logs ──────────────────────────────────────────────────────────

  async findFraudLogs(userIds: string[]): Promise<
    Array<{
      userId: string;
      id: string;
      bettingHouse: string;
      oldCount: number;
      newCount: number;
      reason: string;
      changedByName: string | null;
      changedByEmail: string | null;
      createdAt: Date;
    }>
  > {
    if (userIds.length === 0) return [];

    const logs = await this.prisma.fraudLog.findMany({
      where: { userId: { in: userIds } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        bettingHouse: true,
        oldCount: true,
        newCount: true,
        reason: true,
        createdAt: true,
        changedBy: { select: { name: true, email: true } },
      },
    });

    return logs.map((l) => ({
      userId: l.userId,
      id: l.id,
      bettingHouse: l.bettingHouse,
      oldCount: l.oldCount,
      newCount: l.newCount,
      reason: l.reason,
      changedByName: l.changedBy?.name ?? null,
      changedByEmail: l.changedBy?.email ?? null,
      createdAt: l.createdAt,
    }));
  }

  // ─── Direct referrals (read projection) ──────────────────────────────────

  async findReferrals(
    userId: string,
    house?: string,
    maxLevel = REFERRALS_MAX_DEPTH,
  ): Promise<ReferralEntry[]> {
    const depthCap = Math.min(Math.max(1, maxLevel), REFERRALS_MAX_DEPTH);
    const out: ReferralEntry[] = [];
    const seen = new Set<string>([userId]); // guarda contra ciclos
    let currentIds: string[] = [userId];

    // BFS por nível: nível 1 = convidados diretos, 2 = convidados deles, etc.
    for (let level = 1; level <= depthCap; level++) {
      if (currentIds.length === 0) break;

      const referredUsers = await this.prisma.user.findMany({
        where: { referredById: { in: currentIds } },
        select: {
          id: true,
          name: true,
          email: true,
          externalEmail: true,
          status: true,
          referralCode: true,
          createdAt: true,
          isExternal: true,
          externalId: true,
          affiliateLinks: {
            where: { deletedAt: null },
            select: {
              bettingHouse: true,
              cpa: true,
              revshare: true,
            },
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (referredUsers.length === 0) break;

      const nextIds: string[] = [];
      for (const u of referredUsers) {
        if (seen.has(u.id)) continue;
        seen.add(u.id);
        // Sempre continua a travessia (mesmo que o filtro de casa esconda o
        // usuário do resultado, seus convidados ainda entram nos níveis abaixo).
        nextIds.push(u.id);

        // Filtro de casa: só entra no resultado quem tem link na casa pedida.
        if (house && !u.affiliateLinks.some((l) => l.bettingHouse === house)) {
          continue;
        }

        const primaryLink = u.affiliateLinks[0];
        out.push({
          id: u.id,
          userId: u.id,
          bettingHouseSlug: primaryLink?.bettingHouse ?? '',
          status: u.status.toLowerCase(),
          referralCode: u.referralCode,
          commissionCpa: toNum(primaryLink?.cpa),
          commissionRevshare: toNum(primaryLink?.revshare),
          createdAt: u.createdAt,
          userName: u.name,
          // Show the real e-mail for external sub-users (synthetic never surfaced).
          userEmail: u.externalEmail ?? u.email,
          isExternal: u.isExternal,
          externalId: u.externalId,
          level,
          affiliateLinks: u.affiliateLinks.map((l) => ({
            bettingHouse: l.bettingHouse,
            cpa: toNum(l.cpa),
            revshare: toNum(l.revshare),
          })),
        });
      }

      currentIds = nextIds;
    }

    return out;
  }
}

// Re-export token for module wiring
export { NETWORK_REPOSITORY };

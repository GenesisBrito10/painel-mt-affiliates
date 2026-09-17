import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { UserAccessContext } from '../domain/types/dashboard.types.js';
import { UserRole } from '@prisma/client';

@Injectable()
export class DashboardAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves the access context for a user:
   * - ADMIN → isAdmin: true, all arrays empty (no restriction needed)
   * - AFFILIATE → collects own campaignIds + BFS 3-level network campaignIds
   */
  async resolveAccessContext(
    userId: string,
    userRole: UserRole,
  ): Promise<UserAccessContext> {
    if (userRole === UserRole.ADMIN || userRole === UserRole.SUPERADMIN) {
      return {
        ownCampaignIds: [],
        networkCampaignIds: [],
        allCampaignIds: [],
        isAdmin: true,
      };
    }

    // Own campaign IDs from AffiliateLinks
    const ownLinks = await this.prisma.affiliateLink.findMany({
      where: { userId },
      select: { campaignId: true },
    });
    const ownCampaignIds = ownLinks.map(
      (l: { campaignId: string }) => l.campaignId,
    );

    // BFS 3-level referral network — collect all campaignIds from referred users
    const networkCampaignIds = await this.collectNetworkCampaignIds(userId);

    const allSet = new Set([...ownCampaignIds, ...networkCampaignIds]);

    return {
      ownCampaignIds,
      networkCampaignIds,
      allCampaignIds: Array.from(allSet),
      isAdmin: false,
    };
  }

  /**
   * CTE recursive: collects campaignIds from all users referred by userId,
   * up to 3 levels deep — replaces the previous BFS 3-query loop.
   * Uses existing @@index([referredById]) for efficient traversal.
   */
  async collectNetworkCampaignIds(userId: string): Promise<string[]> {
    const result = await this.prisma.$queryRaw<{ campaignId: string }[]>`
      WITH RECURSIVE network AS (
        -- Level 1: direct referrals of the root user
        SELECT id, 1 AS depth
        FROM "users"
        WHERE "referredById" = ${userId}

        UNION ALL

        -- Levels 2 & 3: recurse through the tree
        SELECT u.id, n.depth + 1
        FROM "users" u
        INNER JOIN network n ON u."referredById" = n.id
        WHERE n.depth < 3
      )
      SELECT DISTINCT al."campaignId"
      FROM network n
      INNER JOIN "affiliate_links" al ON al."userId" = n.id AND al."deletedAt" IS NULL;
    `;

    return result.map((r) => r.campaignId);
  }

  /**
   * Resolves which campaignIds to use based on scope.
   * Returns null for admin (no filter) or the appropriate campaignIds list.
   */
  resolveCampaignIdsForScope(
    access: UserAccessContext,
    scope: 'mine' | 'network' | 'all' = 'all',
  ): string[] | null {
    if (access.isAdmin) return null; // admin = no restriction

    switch (scope) {
      case 'mine':
        return access.ownCampaignIds;
      case 'network':
        return access.networkCampaignIds;
      case 'all':
      default:
        return access.allCampaignIds;
    }
  }
}

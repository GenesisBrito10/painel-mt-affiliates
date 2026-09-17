import type {
  NetworkMemberStats,
  FraudReportLog,
  ReferralEntry,
} from '../types/network.types.js';

export const NETWORK_REPOSITORY = Symbol('INetworkRepository');

export interface INetworkRepository {
  /**
   * Aggregate affiliate_data grouped by campaignId for the given campaign IDs.
   * Applies audit exclusion date range if provided.
   * Returns a Map<campaignId, NetworkMemberStats>.
   */
  aggregateStatsByCampaignId(
    campaignIds: string[],
    auditExclusion?: { startDate: Date; endDate: Date },
    dateRange?: { startDate: Date; endDate: Date },
  ): Promise<Map<string, NetworkMemberStats>>;

  /**
   * Count direct sub-referrals per userId in batch.
   * Returns a Map<userId, count>.
   */
  countSubReferrals(userIds: string[]): Promise<Map<string, number>>;

  /**
   * Fetch FraudLogs for the given userIds with changedBy info resolved.
   * Sorted by createdAt DESC.
   */
  findFraudLogs(userIds: string[]): Promise<
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
  >;

  /**
   * Read projection: referrals of userId (BFS por nível, até maxLevel) com o
   * primeiro affiliateLink de cada um. Cada entry vem tagueada com `level`
   * (1 = convidado direto). Opcionalmente filtrada por bettingHouse slug.
   */
  findReferrals(
    userId: string,
    house?: string,
    maxLevel?: number,
  ): Promise<ReferralEntry[]>;
}

import type { PrizeWinMode } from '@prisma/client';
import type { RankingCandidate } from '../types/ranking.types.js';

// Repository Port — read-only aggregation for ranking calculations.
export const RANKING_REPOSITORY = Symbol('IRankingRepository');

export interface IRankingRepository {
  /**
   * Aggregates cpaQualified per campaignId within the given date range,
   * resolves campaignId → userId/userName via AffiliateLink,
   * filters by CPA threshold, orders desc, and returns top N candidates.
   *
   * @param bettingHouse  slug to restrict CPA counting to one house; null/undefined = all houses.
   * @param winMode       RANKING = targetCpa is an optional minimum; TARGET = targetCpa is the goal.
   */
  calculateWinners(
    startDate: Date,
    endDate: Date,
    winnersCount: number,
    targetCpa: number,
    bettingHouse?: string | null,
    winMode?: PrizeWinMode,
    cpaFromNetwork?: boolean,
  ): Promise<RankingCandidate[]>;
}

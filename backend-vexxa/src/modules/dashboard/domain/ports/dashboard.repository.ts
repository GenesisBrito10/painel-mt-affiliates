import type {
  AggregatedMetrics,
  DailyMetrics,
  CampaignMetrics,
  DashboardFilters,
  SyncDay,
} from '../types/dashboard.types.js';

// Repository Port — read-only. Implemented by DashboardPrismaRepository.
export const DASHBOARD_REPOSITORY = Symbol('IDashboardRepository');

export interface CampaignHouseMetrics {
  campaignId: string;
  bettingHouse: string;
  cpaQualified: number;
  revShare: number;
  deposit: number;
  netPl: number | null;
  withdrawalTotal: number | null;
  volume: number | null;
  pinbetMetricsComplete: boolean;
}

export interface PinbetOperationalMetrics {
  house: 'pinbet-diario' | 'pinbet-mensal';
  netPl: number | null;
  depositTotal: number;
  withdrawalTotal: number;
  volume: number;
  metricsComplete: boolean;
}

export interface IDashboardRepository {
  /** SUM all metrics matching the given filters */
  aggregateSummary(filters: DashboardFilters): Promise<AggregatedMetrics>;

  /** SUM metrics grouped by calendar day */
  aggregateDaily(filters: DashboardFilters): Promise<DailyMetrics[]>;

  /** SUM metrics grouped by campaignName */
  aggregateByCampaign(filters: DashboardFilters): Promise<CampaignMetrics[]>;

  /** SUM metrics grouped by date + bettingHouse (for per-house daily breakdown) */
  aggregateDailyPerHouse(filters: DashboardFilters): Promise<
    {
      date: string;
      bettingHouse: string;
      clicks: number;
      registrations: number;
      ftds: number;
      qftd: number;
      deposit: number;
      volume: number;
      revShare: number;
      cpaValue: number;
      totalCommission: number;
    }[]
  >;

  /**
   * Aggregate per (campaignId, bettingHouse) — used by balance service
   * to compute commission per link without N+1 queries.
   */
  aggregatePerCampaignHouse(
    campaignIds: string[],
    bettingHouse: string | undefined,
    startDate: Date,
    endDate: Date,
    auditExclusion?: import('../types/dashboard.types.js').AuditExclusion,
    // Balance cutover POR CAMPANHA (alias-safe): campanha → data; exclui dados
    // dessa campanha anteriores à data. Independente do cutover de sync.
    campaignCutover?: Map<string, Date>,
  ): Promise<CampaignHouseMetrics[]>;

  aggregatePinbetMetrics(
    filters: DashboardFilters,
  ): Promise<PinbetOperationalMetrics[]>;

  /** Distinct campaignIds present in affiliate_data (for filter dropdowns) */
  getDistinctAffiliates(
    campaignIds: string[] | null,
    bettingHouse?: string,
  ): Promise<string[]>;

  /** Distinct campaignNames */
  getDistinctCampaigns(
    campaignIds: string[] | null,
    bettingHouse?: string,
    affiliateName?: string,
  ): Promise<string[]>;

  /** Distinct utmCampaign values (panels) */
  getDistinctPanels(
    campaignIds: string[] | null,
    bettingHouse?: string,
  ): Promise<string[]>;

  /** Calendar of synced days for a house in the current month */
  getSyncedDays(bettingHouseSlug: string): Promise<SyncDay[]>;

  /**
   * Ranking aggregation — returns metrics per campaignId, ordered by cpaQualified desc.
   * Only includes campaignIds in the provided list.
   */
  aggregateRanking(
    campaignIds: string[],
    startDate: Date,
    endDate: Date,
    bettingHouse?: string,
    limit?: number,
  ): Promise<{ campaignId: string; metrics: AggregatedMetrics }[]>;
}

// Shared domain types for the Dashboard module.
// No framework imports — pure TypeScript.

// ─── Metrics ─────────────────────────────────────────────────────────────────

export interface AggregatedMetrics {
  clicks: number;
  registrations: number;
  ftds: number;
  qftd: number;
  deposit: number;
  volume: number;
  revShare: number;
  cpaValue: number;
  cpaQualified: number;
  totalCommission: number;
}

export const ZERO_METRICS: AggregatedMetrics = {
  clicks: 0,
  registrations: 0,
  ftds: 0,
  qftd: 0,
  deposit: 0,
  volume: 0,
  revShare: 0,
  cpaValue: 0,
  cpaQualified: 0,
  totalCommission: 0,
};

export interface DailyMetrics {
  date: string; // YYYY-MM-DD
  clicks: number;
  registrations: number;
  ftds: number;
  qftd: number;
  deposit: number;
  volume: number;
  revShare: number;
  cpaValue: number;
  cpaQualified: number;
  totalCommission: number;
}

export interface CampaignMetrics {
  campaignId: string;
  bettingHouse: string;
  campaignName: string;
  clicks: number;
  registrations: number;
  ftds: number;
  qftd: number;
  deposit: number;
  volume: number;
  revShare: number;
  cpaValue: number;
  cpaQualified: number;
  totalCommission: number;
}

// ─── Filters ─────────────────────────────────────────────────────────────────

export type DashboardScope = 'mine' | 'network' | 'all';

export interface DashboardFilters {
  /** null = admin (no campaign restriction) */
  campaignIds: string[] | null;
  bettingHouse?: string;
  startDate: Date;
  endDate: Date;
  campaignName?: string;
  utmCampaign?: string;
  affiliateName?: string;
  /** Exclude date range (for audit block feature) */
  auditExclusion?: AuditExclusion;
  /**
   * Balance cutover POR CAMPANHA (alias-safe): campanha → data. Esconde os dados
   * dessa campanha anteriores à data no dashboard (front + admin), espelhando o
   * cutover de saldo por casa (`balance_cutover_date_<slug>`). Sem tocar no
   * cutover de sync nem no global.
   */
  campaignCutover?: Map<string, Date>;
}

export interface AuditExclusion {
  startDate: Date;
  endDate: Date;
}

// ─── Access Control ───────────────────────────────────────────────────────────

export interface UserAccessContext {
  /** campaignIds belonging to the user's own affiliate links */
  ownCampaignIds: string[];
  /** campaignIds belonging to BFS 3-level referral network */
  networkCampaignIds: string[];
  /** union of own + network */
  allCampaignIds: string[];
  /** true if user is ADMIN — bypass all filters */
  isAdmin: boolean;
}

// ─── Balance ─────────────────────────────────────────────────────────────────

export interface PerHouseBalance {
  house: string;
  cpa: number;
  rev: number;
  networkCpa: number;
  networkRev: number;
  /** Manual per-house credit/debit (BalanceAdjustment) for this house */
  adjustment: number;
  fraudDeduction: number;
  networkFraudDeduction: number;
  total: number;
  /** Pinbet only: cumulative own + network provider Net P&L. */
  netPl?: number | null;
  /** False while at least one returned Pinbet row still has null metrics. */
  pinbetMetricsComplete?: boolean;
  /** 80% of positive cumulative Net P&L. */
  netPlWithdrawalLimit?: number | null;
  /** Active/completed gross withdrawals already consuming the limit. */
  netPlLimitConsumed?: number;
  /** Gross amount currently available for withdrawal in this house. */
  withdrawable?: number;
  withdrawalRestriction?:
    | 'METRICS_SYNCING'
    | 'NET_PL_NON_POSITIVE'
    | 'NET_PL_CAP'
    | null;
  /** Pinbet mensal only: independent afp1/afp2 ledgers before summing. */
  pinbetDimensions?: PinbetDimensionBalance[];
}

export interface PinbetDimensionBalance {
  dimension: 'AFP1' | 'AFP2';
  balance: number;
  netPl: number | null;
  netPlWithdrawalLimit: number | null;
  netPlLimitConsumed: number;
  withdrawable: number;
  withdrawalRestriction:
    | 'METRICS_SYNCING'
    | 'NET_PL_NON_POSITIVE'
    | 'NET_PL_CAP'
    | null;
}

export interface DepositInfo {
  avgDepositPerCpa: number;
  totalDeposit: number;
  totalCpaQualified: number;
  minAvgDeposit: number;
  belowMinimum: boolean;
  exemptByNetworkHead: boolean;
  warningMessage: string | null;
}

// ─── Network (BFS) ───────────────────────────────────────────────────────────

export interface NetworkMemberLink {
  campaignId: string;
  bettingHouse: string;
  linkType: string | null;
  cpa: number;
  revshare: number;
}

export interface NetworkMember {
  userId: string;
  affiliateLinks: NetworkMemberLink[];
  fraudCounts: { bettingHouse: string; count: number }[];
  /** CPA rate of L1 ancestor for each house (spread model) */
  l1CpaByHouse: Map<string, number>;
  /** revshare rate of L1 ancestor for each house (spread model) */
  l1RevByHouse: Map<string, number>;
}

// ─── Sync Status ─────────────────────────────────────────────────────────────

export type SyncDayStatus = 'synced' | 'pending' | 'today' | 'future';

export interface SyncDay {
  day: number;
  status: SyncDayStatus;
  hasSynced: boolean;
}

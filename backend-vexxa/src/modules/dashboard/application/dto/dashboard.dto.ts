import { IsOptional, IsString, IsDateString, IsIn } from 'class-validator';
import type {
  AggregatedMetrics,
  DailyMetrics,
  CampaignMetrics,
  PerHouseBalance,
  DepositInfo,
  SyncDay,
} from '../../domain/types/dashboard.types.js';

// ─── Input ────────────────────────────────────────────────────────────────────

export class DashboardQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  bettingHouse?: string;

  @IsOptional()
  @IsIn(['mine', 'network', 'all'])
  scope?: 'mine' | 'network' | 'all';

  @IsOptional()
  @IsString()
  affiliateName?: string;

  @IsOptional()
  @IsString()
  campaignName?: string;

  @IsOptional()
  @IsString()
  utmCampaign?: string;
}

export class RankingQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  bettingHouse?: string;

  @IsOptional()
  @IsString()
  limit?: string;
}

export class SyncStatusQueryDto {
  @IsString()
  house!: string;
}

// ─── Response ─────────────────────────────────────────────────────────────────

/** Matches frontend DashboardSummary type */
export type DashboardSummaryResponseDto = AggregatedMetrics;

/** Matches frontend DailyDataPoint[] */
export type DashboardDailyResponseDto = DailyMetrics[];

/** Matches frontend DashboardFilterOptions */
export interface DashboardFiltersResponseDto {
  bettingHouses: { id: string; name: string; slug: string }[];
  affiliates: string[];
  campaigns: string[];
  panels: string[];
}

/** Matches frontend BalanceData */
export interface BalanceResponseDto {
  balance: number;
  periodBalance: number;
  isFiltered: boolean;
  /** Raw earnings total before any deduction (CPA + RevShare + Network + Bonus) */
  baseGross: number;
  /** baseGross minus fraud deduction */
  grossBalance: number;
  /** Total deducted from balance: approved + pending withdrawals */
  approvedWithdrawals: number;
  /** Breakdown: approved-only withdrawals */
  withdrawalsApproved: number;
  /** Breakdown: pending-only withdrawals */
  withdrawalsPending: number;
  cpa: number;
  rev: number;
  networkCpa: number;
  networkRev: number;
  networkTotal: number;
  bonusBalance: number;
  balanceAdjustment: number;
  fraudDeduction: number;
  networkFraudDeduction: number;
  totalFraudDeduction: number;
  fraudDetails: FraudDetailDto[];
  perHouse: PerHouseBalance[];
  minWithdrawalAmount: number;
  /** Pre-calculated withdrawal fee (absolute value, e.g. R$30.00) */
  withdrawalFee: number;
  /** Withdrawal fee rate (e.g. 0.06 for 6%) */
  withdrawalFeeRate: number;
  /** Balance after fee deduction (balance - withdrawalFee) */
  netBalance: number;
  /** Bônus disponível: bonusBalance − saques de bônus ativos */
  bonusAvailable: number;
  /** Disponível para saque (sacável real): casas sacáveis + bônus disponível */
  withdrawableTotal: number;
  /** withdrawableTotal líquido da taxa de saque */
  withdrawableNet: number;
  depositInfo: DepositInfo;
}

export interface FraudDetailDto {
  bettingHouse: string;
  fraudCount: number;
  deduction: number;
  source: 'direct' | 'network';
  memberName?: string;
  memberEmail?: string;
}

export interface LinksPerformanceRowDto {
  key: string;
  bettingHouse: string;
  campaignId: string;
  cpaRate: number;
  revRate: number;
  myCpa: number;
  myRev: number;
  myCommission: number;
  clicks: number;
  registrations: number;
  ftds: number;
  qftd: number;
  deposit: number;
  revShare: number;
  cpaValue: number;
  cpaQualified: number;
  totalCommission: number;
}

export interface CampaignRowDto extends CampaignMetrics {
  // extends all campaign metrics
}

export interface RankingRowDto {
  rank: number;
  campaignId: string;
  userName: string;
  cpaQualified: number;
  ftds: number;
  registrations: number;
  deposit: number;
  revShare: number;
  cpaValue: number;
  totalCommission: number;
}

export interface SyncStatusResponseDto {
  house: string;
  lastSyncAt: Date | null;
  month: number;
  year: number;
  today: number;
  days: SyncDay[];
}

export interface WithdrawalScheduleDto {
  name: string;
  slug: string;
  withdrawalDay: number | null;
  withdrawalDayEnd: number | null;
}

export interface FraudDetailItemDto {
  bettingHouse: string;
  fraudCount: number;
  cpaRate: number;
  deduction: number;
  source: 'direct' | 'network';
  memberName?: string;
  memberEmail?: string;
}

export interface FraudDetailsResponseDto {
  directFrauds: FraudDetailItemDto[];
  networkFrauds: FraudDetailItemDto[];
  totalDirect: number;
  totalNetwork: number;
  totalDeduction: number;
}

export interface FraudOverviewItemDto {
  userId: string;
  name: string;
  email: string;
  fraudList: {
    bettingHouse: string;
    fraudCount: number;
    cpaRate: number;
    deduction: number;
  }[];
  totalCount: number;
  totalDeduction: number;
}

import {
  IsOptional,
  IsString,
  IsDateString,
  IsNumber,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { LedgerEventType } from '@prisma/client';
import type {
  PerHouseBalance,
  DepositInfo,
} from '../../domain/types/dashboard.types.js';

// ─── Input DTOs ─────────────────────────────────────────────────────────────────

export class EarningsLedgerQueryDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  eventType?: LedgerEventType;

  @IsOptional()
  @IsString()
  bettingHouse?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 50;
}

// ─── Output DTOs ────────────────────────────────────────────────────────────────

export interface EarningsOverviewDto {
  availableBalance: number;

  formula: {
    ownCpa: number;
    ownRevshare: number;
    networkCpa: number;
    networkRevshare: number;
    bonusBalance: number;
    grossTotal: number;

    fraudDeductionDirect: number;
    fraudDeductionNetwork: number;
    totalFraudDeduction: number;

    withdrawalsApproved: number;
    withdrawalsPending: number;

    netBalance: number;
    withdrawalFee: number;
    withdrawalFeeRate: number;
    availableBalance: number;
  };

  perHouse: PerHouseBalance[];
  depositInfo: DepositInfo;

  meta: {
    lastUpdatedAt: string;
    validationStatus: 'synced' | 'partial' | 'stale';
  };
}

export interface NetworkMemberEarningDto {
  memberId: string;
  memberName: string;
  memberEmail: string;
  level: number;
  parentName: string | null;
  joinedAt: string;

  cpaEarnings: number;
  revshareEarnings: number;
  grossEarnings: number;
  totalEarnings: number;
  fraudDeduction: number;
  fraudCount: number;

  clicks: number;
  ftds: number;
  cpaQualified: number;
  registrations: number;
  deposit: number;
  revShareGenerated: number;
  totalCommissionGenerated: number;
  cpaRate: number;
  revshareRate: number;
  subReferrals: number;

  houses: string[];
  houseBreakdown: NetworkMemberHouseBreakdownDto[];
  status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'BLOCKED';
}

export interface NetworkMemberHouseBreakdownDto {
  house: string;
  cpaRate: number;
  revshareRate: number;
  uplineCpaRate: number;
  uplineRevshareRate: number;
  cpaMargin: number;
  revshareMargin: number;
  clicks: number;
  registrations: number;
  ftds: number;
  cpaQualified: number;
  deposit: number;
  revShareGenerated: number;
  totalCommissionGenerated: number;
  cpaEarnings: number;
  revshareEarnings: number;
  grossEarnings: number;
  fraudCount: number;
  fraudDeduction: number;
  netEarnings: number;
}

export interface NetworkBreakdownDto {
  totalNetworkEarnings: number;
  grossNetworkEarnings: number;
  totalCpaEarnings: number;
  totalRevshareEarnings: number;
  totalFraudDeduction: number;
  totalMembers: number;
  totals: {
    clicks: number;
    registrations: number;
    ftds: number;
    cpaQualified: number;
    deposit: number;
    revShareGenerated: number;
    totalCommissionGenerated: number;
    fraudCount: number;
    subReferrals: number;
  };
  statusSummary: {
    approved: number;
    pending: number;
    rejected: number;
    blocked: number;
  };
  levelSummary: Record<
    number,
    {
      members: number;
      earnings: number;
      registrations: number;
      cpaQualified: number;
    }
  >;
  members: NetworkMemberEarningDto[];
}

export interface LedgerEntryDto {
  id: string;
  date: string;
  eventType: string;
  eventLabel: string;
  amount: number;
  bettingHouse: string | null;
  sourceName: string | null;
  status: string;
  referenceId: string | null;
}

export interface LedgerPageDto {
  data: LedgerEntryDto[];
  total: number;
  page: number;
  limit: number;
  periodSummary: {
    totalCredits: number;
    totalDebits: number;
    netChange: number;
  };
}

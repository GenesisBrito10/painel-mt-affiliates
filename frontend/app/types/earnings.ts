
export type LedgerEventType = 
  | 'CPA'
  | 'REVSHARE'
  | 'WITHDRAWAL_PENDING'
  | 'WITHDRAWAL_APPROVED'
  | 'WITHDRAWAL_REJECTED'
  | 'FRAUD_DEDUCTION'
  | 'BONUS'
  | 'MANUAL_ADJUSTMENT';

export interface EarningsFormula {
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
}

export interface PerHouseBalance {
  houseId: string;
  houseName: string;
  cpa: number;
  revshare: number;
  total: number;
  cpaCount: number;
  ftdCount: number;
}

export interface DepositInfo {
  totalDeposits: number;
  totalDepositAmount: number;
}

export interface EarningsOverview {
  availableBalance: number;
  formula: EarningsFormula;
  perHouse: PerHouseBalance[];
  depositInfo: DepositInfo;
  meta: {
    lastUpdatedAt: string;
    validationStatus: 'synced' | 'partial' | 'stale';
  };
}

export interface NetworkMemberEarnings {
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
  houseBreakdown: NetworkMemberHouseBreakdown[];
  status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'BLOCKED';
}

export interface NetworkMemberHouseBreakdown {
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

export interface EarningsNetwork {
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
  levelSummary: Record<number, {
    members: number;
    earnings: number;
    registrations: number;
    cpaQualified: number;
  }>;
  members: NetworkMemberEarnings[];
}

export interface EarningsLedgerItem {
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

export interface EarningsPeriodSummary {
  totalCredits: number;
  totalDebits: number;
  netChange: number;
}

export interface EarningsLedger {
  data: EarningsLedgerItem[];
  total: number;
  page: number;
  limit: number;
  periodSummary: EarningsPeriodSummary;
}

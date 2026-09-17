/** Dashboard domain types — mirrors backend DTOs without any `any` */

export type DashboardScope = 'mine' | 'network' | 'all'

export interface DashboardSummary {
  clicks: number
  registrations: number
  ftds: number
  qftd: number
  deposit: number
  volume: number
  revShare: number
  cpaValue: number
  cpaQualified: number
}

export interface DailyDataPoint {
  date: string
  clicks: number
  registrations: number
  ftds: number
  qftd: number
  deposit: number
  volume: number
  revShare: number
  cpaValue: number
  cpaQualified: number
}

export interface PerHouseBalance {
  house: string
  cpa: number
  rev: number
  networkCpa: number
  networkRev: number
  /** Ajuste manual de saldo desta casa (model BalanceAdjustment) */
  adjustment: number
  fraudDeduction: number
  networkFraudDeduction: number
  total: number
  netPl?: number | null
  pinbetMetricsComplete?: boolean
  netPlWithdrawalLimit?: number | null
  netPlLimitConsumed?: number
  withdrawable?: number
  withdrawalRestriction?: 'METRICS_SYNCING' | 'NET_PL_NON_POSITIVE' | 'NET_PL_CAP' | null
}

export interface PinbetMetricHouse {
  house: 'pinbet-diario' | 'pinbet-mensal'
  name: string
  netPl: number | null
  depositTotal: number
  withdrawalTotal: number
  volume: number
  metricsComplete: boolean
  health: 'HEALTHY' | 'ATTENTION' | 'SYNCING'
}

export interface PinbetMetricsResponse {
  houses: PinbetMetricHouse[]
}

export interface FraudDetail {
  bettingHouse: string
  fraudCount: number
  cpaRate: number
  deduction: number
  source: 'direct' | 'network'
  memberId?: string
  memberName?: string
  memberEmail?: string
  memberStatus?: string
}

export interface FraudDetailsResponse {
  directFrauds: FraudDetail[]
  networkFrauds: FraudDetail[]
  totalDirect: number
  totalNetwork: number
  totalDeduction: number
}

export interface BalanceData {
  balance: number
  /** Raw earnings before any deduction */
  baseGross: number
  /** baseGross minus fraud */
  grossBalance: number
  /** Total deducted: approved + pending */
  approvedWithdrawals: number
  /** Approved-only withdrawals */
  withdrawalsApproved: number
  /** Pending-only withdrawals */
  withdrawalsPending: number
  cpa: number
  rev: number
  networkCpa: number
  networkRev: number
  networkTotal: number
  bonusBalance: number
  balanceAdjustment: number
  fraudDeduction: number
  networkFraudDeduction: number
  totalFraudDeduction: number
  fraudDetails: FraudDetail[]
  perHouse: PerHouseBalance[]
  minWithdrawalAmount: number
  withdrawalFee: number
  withdrawalFeeRate: number
  netBalance: number
  // Disponível para saque (fonte única): casas sacáveis + bônus disponível.
  bonusAvailable: number
  withdrawableTotal: number
  withdrawableNet: number
  depositInfo?: {
    avgDepositPerCpa: number
    totalDeposit: number
    totalCpaQualified: number
    minAvgDeposit: number
    belowMinimum: boolean
    exemptByNetworkHead: boolean
    warningMessage: string | null
  }
}

export interface FilterHouseOption {
  id: string
  name: string
  slug: string
  logoUrl?: string
}

export interface DashboardFilterOptions {
  bettingHouses: FilterHouseOption[]
  affiliates: string[]
  campaigns: string[]
  panels: string[]
}

export interface ApiEnvelope<T> {
  data: T
  timestamp: string
}

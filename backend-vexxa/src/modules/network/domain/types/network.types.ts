// ─── Network Module — Domain Types ──────────────────────────────────────────
// Pure types, no framework dependencies.

export interface NetworkMemberStats {
  registrations: number;
  ftds: number;
  deposit: number;
  totalCommission: number;
  revShare: number;
  cpaQualified: number;
}

export interface EnrichedNetworkMember {
  userId: string;
  name: string;
  email: string;
  status: string;
  referralCode: string | null;
  joinedAt: Date;
  /** bettingHouse slugs from affiliateLinks */
  houses: string[];
  /** First link's CPA rate (display only) */
  cpa: number;
  /** First link's revshare rate (display only) */
  revshare: number;
  /** BFS depth: 1..10 */
  level: number;
  /** Name of the direct referrer */
  parentName: string;
  /** Count of this member's direct sub-referrals */
  subReferrals: number;
  /** Aggregated affiliate_data stats */
  stats: NetworkMemberStats;
  /** Spread-model earnings attributable to root user from this member */
  myEarnings: number;
  /** Total fraud count from member's fraudCounts */
  fraudCount: number;
  /** Monetary deduction from fraud (spread margin × fraud count) */
  fraudDeduction: number;
}

export interface NetworkTreeResult {
  referralCode: string | null;
  totalReferrals: number;
  networkEarnings: number;
  networkFraudLoss: number;
  netNetworkEarnings: number;
  totals: NetworkMemberStats;
  /** Status counts computed across ALL members before pagination */
  statusSummary: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
  };
  network: EnrichedNetworkMember[];
  /** Server-side pagination */
  total: number;
  page: number;
  limit: number;
}

export interface FraudReportLog {
  id: string;
  bettingHouse: string;
  oldCount: number;
  newCount: number;
  fraudCount: number;
  reason: string;
  registeredBy: { name: string; email: string } | null;
  createdAt: Date;
}

export interface FraudReportMember {
  userId: string;
  name: string;
  email: string;
  totalFraudCpa: number;
  logs: FraudReportLog[];
}

export interface FraudReportResult {
  total: number;
  totalFraudCpa: number;
  members: FraudReportMember[];
}

export interface ReferralEntry {
  id: string;
  userId: string;
  bettingHouseSlug: string;
  status: string;
  referralCode: string | null;
  commissionCpa: number;
  commissionRevshare: number;
  createdAt: Date;
  userName: string;
  userEmail: string;
  /** True when the invitee is an API/external sub-user (created via affiliate-API). */
  isExternal: boolean;
  /** Panel id sent by the partner (external sub-users only). */
  externalId: string | null;
  /** Depth in the referral tree relative to the querying user (1 = direto). */
  level: number;
  /** All affiliate links the invitee has — populated by findReferrals */
  affiliateLinks: Array<{
    bettingHouse: string;
    cpa: number;
    revshare: number;
  }>;
}

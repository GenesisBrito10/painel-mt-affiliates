// ─── Affiliates Page — API Response Types ────────────────────────────────
// All types reflect real backend API shapes (zero mock).

// ────────────── User / Auth ─────────────────────────────────────────────

export interface UserProfile {
  id: string
  name: string
  email: string
  role: 'affiliate' | 'admin'
  active: boolean
  createdAt: string
}

// ────────────── Membership ───────────────────────────────────────────────

export interface MembershipResponse {
  id: string
  /** Slug da casa — campo real retornado pela API nova */
  bettingHouse: string
  campaignId?: string
  status: 'pending' | 'approved' | 'rejected'
  referralCode: string | null
  commissionCpa: number
  commissionRevshare: number
  createdAt: string
  /** Legacy fields — may be undefined in new API */
  userId?: string
  bettingHouseId?: string
  bettingHouseName?: string
  bettingHouseSlug?: string
  referredById?: string | null
}

// ────────────── Affiliate Link ───────────────────────────────────────────

export interface AffiliateLinkResponse {
  id: string
  membershipId?: string
  campaignName?: string
  cpa: number
  revshare: number
  createdAt: string
}

// ────────────── Enriched Membership (mine + links) ───────────────────────

export interface EnrichedMembership extends MembershipResponse {
  affiliateLinks: AffiliateLinkResponse[]
}


// ────────────── Network Tree ─────────────────────────────────────────────

export interface NetworkMemberStats {
  registrations: number
  ftds: number
  deposit: number
  totalCommission: number
  revShare: number
  cpaQualified: number
}

export interface NetworkMemberView {
  id: string
  userId: string
  name: string
  email: string
  status: string
  referralCode: string | null
  joinedAt: string
  houses: string[]
  cpa: number
  revshare: number
  level: number
  parentName: string
  subReferrals: number
  stats: NetworkMemberStats
  myEarnings: number
}

export interface NetworkTreeResponse {
  referralCode: string | null
  totalReferrals: number
  networkEarnings: number
  totals: NetworkMemberStats
  /** Status counts computed server-side across ALL pages before pagination */
  statusSummary?: {
    total: number
    pending: number
    approved: number
    rejected: number
  }
  network: NetworkMemberView[]
  /** Server-side pagination */
  total: number
  page: number
  limit: number
}


// ────────────── Referrals (Convidados) ──────────────────────────────────

export interface ReferralEntry {
  id: string
  userId: string
  bettingHouseSlug: string
  status: 'pending' | 'approved' | 'rejected'
  referralCode: string | null
  commissionCpa: number
  commissionRevshare: number
  createdAt: string
  userName: string
  userEmail: string
  /** True when the invitee is an API/external sub-user (created via affiliate-API). */
  isExternal?: boolean
  externalId?: string | null
  /** Nível na árvore de indicação (1 = convidado direto). */
  level: number
  /** All affiliate links the invitee has (populated by backend) */
  affiliateLinks: Array<{ bettingHouse: string; cpa: number; revshare: number }>
}

// ────────────── Admin Aggregated View ───────────────────────────────────

export interface AdminAffiliateMembership {
  id: string
  /** Slug da casa de apostas (ex: "superbet") — shape da nova API */
  bettingHouse: string
  campaignId?: string
  status: 'pending' | 'approved' | 'rejected'
  commissionCpa: number
  commissionRevshare: number
  referralCode?: string | null
  /** Legacy fields — kept for backward compat */
  bettingHouseId?: string
  bettingHouseSlug?: string
  bettingHouseName?: string
  affiliateLinks?: AffiliateLinkResponse[]
}

export interface AdminAffiliateEntry {
  id: string
  name: string
  email: string
  role: 'affiliate' | 'admin'
  /** F6: user-level status — PENDING, APPROVED, REJECTED */
  status?: 'PENDING' | 'APPROVED' | 'REJECTED'
  ageVerified?: boolean
  active?: boolean
  withdrawalBlocked?: boolean
  createdAt: string
  memberships: AdminAffiliateMembership[]
  /** UI-only: computed from memberships */
  panel?: string
}

export interface AdminAffiliateProfile extends AdminAffiliateEntry {
  withdrawalBlocked: boolean
  affiliateLinks: Array<{
    id: string
    bettingHouse: string
    campaignId: string
    cpa: string | number | null
    revshare: string | number | null
  }>
}


export interface AdminAffiliatesResponse {
  data: AdminAffiliateEntry[]
  meta: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

// ────────────── Betting House ────────────────────────────────────────────

export interface BettingHouseOption {
  id: string
  name: string
  slug: string
}

// ────────────── Filters ──────────────────────────────────────────────────

export interface AdminAffiliateFilters {
  search: string
  role: string
  status: string
  bettingHouseId: string
  noLink: boolean
  panel: string
  page: number
  limit: number
}

// ────────────── Approval Form ────────────────────────────────────────────

export interface ReferrerLink {
  bettingHouse: string
  houseName: string
  cpa: number
  revshare: number
}

export interface ApprovalFormState {
  membershipId: string
  bettingHouse: string
  cpa: number | null
  revshare: number | null
  note: string
  maxCpa: number
  maxRevshare: number
}

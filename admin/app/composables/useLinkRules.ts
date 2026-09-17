export interface RangeTier {
  min: number | null
  max: number | null
  cpa: number
}

export interface HouseLinkRule {
  id: string
  houseSlug: string
  requestEnabled: boolean
  autoAssignEnabled: boolean
  ruleType: 'INVITER_DISCOUNT' | 'RANGE'
  defaultCpa: string | number
  fallbackCpa: string | number
  inviterCpaThreshold: string | number | null
  inviterCpaDiscount: string | number
  defaultRevshare: string | number
  rangeReferenceHouse: string | null
  rangeTiers: RangeTier[]
  checkExistingLink: boolean
  checkPendingRequest: boolean
  useInviterCpa: boolean
  applyFallbackNoInviterCpa: boolean
  applyDefaultNoInviter: boolean
  blockOnRequiredFail: boolean
  processOldRequests: boolean
  requireActiveLinkInHouses: boolean
  requiredHouseSlugs: string[]
  blockMessage: string
  updatedByName: string
  updatedAt: string
}

export interface RuleChangeLog {
  id: string
  houseSlug: string
  adminName: string
  changeReason: string | null
  changes: Record<string, { old: unknown; new: unknown }>
  createdAt: string
}

export interface BackfillSummary {
  houseSlug: string
  dryRun: boolean
  forceRecalculate: boolean
  evaluated: number
  processed: number
  skipped: number
  blocked: number
  waitingPool: number
  waitingSnapshot: number
  errors: number
  preview?: Array<{
    requestId: string
    userId: string
    hasSnapshot: boolean
    savedCpa: number | null
    computedCpa: number | null
    diff: number | null
    wouldOutcome: string
    missingHouses: string[]
  }>
}

export function useLinkRules() {
  const apiBase = useApiBase()
  const { authHeaders } = useAuth()

  async function listRules(): Promise<HouseLinkRule[]> {
    const res = await $fetch<{ data: HouseLinkRule[] }>(
      `${apiBase}/admin/link-rules`,
      { headers: authHeaders() },
    )
    return res.data
  }

  async function getHistory(slug: string): Promise<RuleChangeLog[]> {
    const res = await $fetch<{ data: RuleChangeLog[] }>(
      `${apiBase}/admin/link-rules/${slug}/history`,
      { headers: authHeaders() },
    )
    return res.data
  }

  async function saveRule(
    slug: string,
    body: Partial<HouseLinkRule> & { changeReason?: string },
  ): Promise<HouseLinkRule> {
    const res = await $fetch<{ data: HouseLinkRule }>(
      `${apiBase}/admin/link-rules/${slug}`,
      { method: 'PUT', headers: authHeaders(), body },
    )
    return res.data
  }

  async function runBackfill(
    slug: string,
    opts: { dryRun?: boolean; forceRecalculate?: boolean; reason?: string } = {},
  ): Promise<BackfillSummary> {
    const params = new URLSearchParams({ slug })
    const res = await $fetch<{ data: BackfillSummary }>(
      `${apiBase}/admin/link-rules/backfill?${params.toString()}`,
      { method: 'POST', headers: authHeaders(), body: opts },
    )
    return res.data
  }

  async function reprocess(
    requestId: string,
    body: { reason: string; recalculateSnapshot?: boolean },
  ): Promise<{ status: string; outcome: string }> {
    return $fetch<{ status: string; outcome: string }>(
      `${apiBase}/v1/link-requests/${requestId}/reprocess`,
      { method: 'POST', headers: authHeaders(), body },
    )
  }

  return { listRules, getHistory, saveRule, runBackfill, reprocess }
}

/**
 * useLinkRequests — manages link requests and deal requests for affiliates.
 *
 * Endpoints consumed:
 *   GET  /v1/link-requests/houses        → active betting houses (used in modal dropdown)
 *   GET  /v1/link-requests               → list link requests (role-aware)
 *   POST /v1/link-requests               → create a link request (by bettingHouseSlug)
 *   GET  /v1/deal-requests               → list deal requests (role-aware)
 *   PUT  /v1/deal-requests/:id/approve   → approve/reject deal request (leader or admin)
 */

export interface BettingHouseOption {
  id: string
  name: string
  slug: string
}

export interface LinkItem {
  label: string
  url: string
}

export interface LinkRequestItem {
  id: string
  userId: string
  userName: string
  userEmail: string
  dealId: string | null
  dealName: string | null
  bettingHouseSlug: string
  message: string
  status: 'PENDING' | 'FULFILLED' | 'REJECTED'
  links: LinkItem[]
  adminNote: string
  fulfilledAt: string | null
  fulfilledByName: string
  createdAt: string
  resolvedCpa?: number | null
  missingHouseSlugs?: string[]
  blockedReason?: string | null
}

interface ListResponse {
  data: LinkRequestItem[]
}

interface HousesResponse {
  data: BettingHouseOption[]
}

export function useLinkRequests() {
  const { authHeaders } = useAuth()
  const apiBase = useApiBase()

  // ─── State ──────────────────────────────────────────────────────────────────
  const houses = ref<BettingHouseOption[]>([])
  const loadingHouses = ref(false)

  const linkRequests = ref<LinkRequestItem[]>([])
  const loadingLinks = ref(false)
  const linkError = ref<string | null>(null)

  const dealRequests = ref<LinkRequestItem[]>([])
  const loadingDeals = ref(false)
  const dealError = ref<string | null>(null)

  const submitting = ref(false)
  const submitError = ref<string | null>(null)

  // ─── Houses ─────────────────────────────────────────────────────────────────
  async function fetchHouses() {
    loadingHouses.value = true
    try {
      const res = await $fetch<HousesResponse>(`${apiBase}/v1/link-requests/houses`, {
        headers: authHeaders(),
      })
      houses.value = res.data
    }
    catch {
      houses.value = []
    }
    finally {
      loadingHouses.value = false
    }
  }

  // ─── Link Requests ──────────────────────────────────────────────────────────
  async function fetchLinkRequests(params?: { sort?: string; dateFrom?: string; dateTo?: string }) {
    loadingLinks.value = true
    linkError.value = null
    try {
      const res = await $fetch<ListResponse>(`${apiBase}/v1/link-requests`, {
        headers: authHeaders(),
        query: { mine: true, ...(params ?? {}) },
      })
      linkRequests.value = res.data
    }
    catch (err: unknown) {
      linkError.value = parseApiError(err)
    }
    finally {
      loadingLinks.value = false
    }
  }

  // ─── Create Link Request ─────────────────────────────────────────────────────
  // Sends bettingHouseSlug; backend resolves the active deal automatically.
  async function createLinkRequest(bettingHouseSlug: string, message?: string) {
    submitting.value = true
    submitError.value = null
    try {
      const res = await $fetch<{ id: string; status: string }>(
        `${apiBase}/v1/link-requests`,
        {
          method: 'POST',
          headers: authHeaders(),
          body: { bettingHouseSlug, message: message ?? '' },
        },
      )
      await fetchLinkRequests()
      return { success: true, status: res.status }
    }
    catch (err: unknown) {
      const msg = parseApiError(err)
      submitError.value = msg
      return { success: false, error: msg }
    }
    finally {
      submitting.value = false
    }
  }

  // ─── Deal Requests ──────────────────────────────────────────────────────────
  async function fetchDealRequests(params?: { status?: string; dateFrom?: string; dateTo?: string }) {
    loadingDeals.value = true
    dealError.value = null
    try {
      const res = await $fetch<ListResponse>(`${apiBase}/v1/deal-requests`, {
        headers: authHeaders(),
        query: params ?? {},
      })
      dealRequests.value = res.data
    }
    catch (err: unknown) {
      dealError.value = parseApiError(err)
    }
    finally {
      loadingDeals.value = false
    }
  }

  // ─── Approve/Reject Deal Request (leader or admin) ──────────────────────────
  async function approveDealRequest(
    id: string,
    payload: { action?: 'reject'; cpa?: number; revshare?: number; adminNote?: string; links?: LinkItem[] },
  ) {
    submitting.value = true
    submitError.value = null
    try {
      await $fetch(`${apiBase}/v1/deal-requests/${id}/approve`, {
        method: 'PUT',
        headers: authHeaders(),
        body: payload,
      })
      await fetchDealRequests()
      return { success: true }
    }
    catch (err: unknown) {
      const msg = parseApiError(err)
      submitError.value = msg
      return { success: false, error: msg }
    }
    finally {
      submitting.value = false
    }
  }

  // ─── Set manual CPA (esportiva-diario) ──────────────────────────────────────
  // Convidante/admin define só o CPA; a planilha (aba DIÁRIO) atribui o link
  // depois via scheduler. Não fulfilla com link.
  async function setCpa(id: string, cpa: number, revshare?: number) {
    submitting.value = true
    submitError.value = null
    try {
      await $fetch(`${apiBase}/v1/link-requests/${id}/set-cpa`, {
        method: 'PUT',
        headers: authHeaders(),
        body: { cpa, revshare },
      })
      await fetchDealRequests()
      return { success: true }
    }
    catch (err: unknown) {
      const msg = parseApiError(err)
      submitError.value = msg
      return { success: false, error: msg }
    }
    finally {
      submitting.value = false
    }
  }

  // ─── Referrer ceiling for approve modal ─────────────────────────────────────
  async function fetchReferrerCeiling(linkRequestId: string): Promise<{
    hasCeiling: boolean
    maxCpa?: number
    maxRevshare?: number
    presetCpa?: number | null
    presetRevshare?: number | null
  }> {
    try {
      const res = await $fetch<any>(`${apiBase}/v1/link-requests/${linkRequestId}/referrer-ceiling`, {
        headers: authHeaders(),
      })
      return res
    }
    catch {
      return { hasCeiling: false }
    }
  }

  // ─── Init ────────────────────────────────────────────────────────────────────
  async function init() {
    await Promise.all([fetchHouses(), fetchLinkRequests(), fetchDealRequests()])
  }

  return {
    // houses
    houses,
    loadingHouses,
    fetchHouses,
    // link requests
    linkRequests,
    loadingLinks,
    linkError,
    fetchLinkRequests,
    createLinkRequest,
    // deal requests
    dealRequests,
    loadingDeals,
    dealError,
    fetchDealRequests,
    approveDealRequest,
    setCpa,
    fetchReferrerCeiling,
    // shared
    submitting,
    submitError,
    init,
  }
}

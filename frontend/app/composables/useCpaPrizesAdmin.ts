/**
 * useCpaPrizesAdmin — admin API client for the CPA prize feature.
 * All routes under /v1/admin/cpa-prizes (ADMIN role).
 */

export interface CpaPrizeRuleVersion {
  id: string
  version: number
  bettingHouse: string | null
  cpaPerPrize: number
  countMode: 'INDIVIDUAL' | 'NETWORK'
  prizeType: string
  prizeValue: number
  prizeLabel: string
  icon: string
  startDate: string
  endDate: string | null
  effectiveFromDate: string
  supersededAt: string | null
}

export interface CpaPrizeRule {
  id: string
  name: string
  description: string
  active: boolean
  archived: boolean
  currentVersionId: string | null
  createdBy?: { name: string; email: string }
  versions: CpaPrizeRuleVersion[]
  _count?: { awards: number }
}

export interface CpaPrizeAwardAdmin {
  id: string
  userId: string
  userName: string
  bettingHouse: string | null
  countMode: string
  cpaThreshold: number
  cycleIndex: number
  prizeType: string
  prizeValue: number
  prizeLabel: string
  status: string
  rejectionReason: string | null
  createdAt: string
  user?: { name: string; email: string }
}

export interface CpaPrizeMetrics {
  awards: { total: number; available: number; redemptionRequested: number; paid: number; cancelled: number; rejected: number }
  value: { totalGenerated: number; paid: number; pending: number }
  redemptions: { requested: number; approved: number; rejected: number }
  topUsers: { userId: string; userName: string; awards: number }[]
}

export interface CreateRuleInput {
  name: string
  description?: string
  bettingHouse?: string
  cpaPerPrize: number
  countMode: 'INDIVIDUAL' | 'NETWORK'
  prizeType: string
  prizeValue?: number
  prizeLabel?: string
  icon?: string
  startDate: string
  endDate?: string
}

export function useCpaPrizesAdmin() {
  const { authHeaders, user } = useAuth()
  const apiBase = useApiBase()
  const toast = useToast()
  const base = `${apiBase}/v1/admin/cpa-prizes`

  const rules = ref<CpaPrizeRule[]>([])
  const awards = ref<CpaPrizeAwardAdmin[]>([])
  const redemptions = ref<CpaPrizeAwardAdmin[]>([])
  const metrics = ref<CpaPrizeMetrics | null>(null)
  const logs = ref<Record<string, unknown>[]>([])
  const loading = ref(false)
  const busy = ref(false)

  const isAdmin = computed(() => user.value?.role === 'admin')

  async function fetchRules(archived = false) {
    if (!isAdmin.value) return
    loading.value = true
    try {
      const res = await $fetch<{ data: CpaPrizeRule[] }>(base, {
        headers: authHeaders(),
        query: { archived: String(archived) },
      })
      rules.value = res.data
    } catch (err: unknown) {
      toast.add({ title: parseApiError(err), color: 'error' })
    } finally {
      loading.value = false
    }
  }

  async function fetchMetrics() {
    if (!isAdmin.value) return
    try {
      metrics.value = await $fetch<CpaPrizeMetrics>(`${base}/metrics`, { headers: authHeaders() })
    } catch (err: unknown) {
      toast.add({ title: parseApiError(err), color: 'error' })
    }
  }

  async function fetchAwards(status?: string) {
    if (!isAdmin.value) return
    const res = await $fetch<{ data: CpaPrizeAwardAdmin[] }>(`${base}/awards`, {
      headers: authHeaders(),
      query: status ? { status } : {},
    })
    awards.value = res.data
  }

  async function fetchRedemptions() {
    if (!isAdmin.value) return
    const res = await $fetch<{ data: CpaPrizeAwardAdmin[] }>(`${base}/redemptions`, {
      headers: authHeaders(),
    })
    redemptions.value = res.data
  }

  async function fetchLogs(ruleId?: string) {
    if (!isAdmin.value) return
    const res = await $fetch<{ data: Record<string, unknown>[] }>(`${base}/logs`, {
      headers: authHeaders(),
      query: ruleId ? { ruleId } : {},
    })
    logs.value = res.data
  }

  async function fetchUserHistory(userId: string) {
    return $fetch(`${base}/users/${userId}/history`, { headers: authHeaders() })
  }

  async function createRule(input: CreateRuleInput) {
    busy.value = true
    try {
      await $fetch(base, { method: 'POST', headers: authHeaders(), body: input })
      toast.add({ title: 'Regra criada', color: 'success' })
      await fetchRules()
    } catch (err: unknown) {
      toast.add({ title: parseApiError(err), color: 'error' })
    } finally {
      busy.value = false
    }
  }

  async function updateRule(id: string, body: Record<string, unknown>) {
    busy.value = true
    try {
      await $fetch(`${base}/${id}`, { method: 'PUT', headers: authHeaders(), body })
      toast.add({ title: 'Regra atualizada', color: 'success' })
      await fetchRules()
    } catch (err: unknown) {
      toast.add({ title: parseApiError(err), color: 'error' })
    } finally {
      busy.value = false
    }
  }

  async function removeRule(id: string) {
    busy.value = true
    try {
      const res = await $fetch<{ success: boolean; archived: boolean }>(`${base}/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      toast.add({ title: res.archived ? 'Regra arquivada' : 'Regra removida', color: 'success' })
      await fetchRules()
    } catch (err: unknown) {
      toast.add({ title: parseApiError(err), color: 'error' })
    } finally {
      busy.value = false
    }
  }

  async function recalculate(id: string) {
    busy.value = true
    try {
      const res = await $fetch<{ usersEvaluated: number; awardsGenerated: number; errors: number; skippedLocked: boolean }>(
        `${base}/${id}/recalculate`,
        { method: 'POST', headers: authHeaders() },
      )
      toast.add({
        title: res.skippedLocked
          ? 'Avaliação já em andamento'
          : `Recalculado: ${res.awardsGenerated} prêmios, ${res.usersEvaluated} usuários`,
        color: 'success',
      })
      await Promise.all([fetchMetrics(), fetchRedemptions()])
    } catch (err: unknown) {
      toast.add({ title: parseApiError(err), color: 'error' })
    } finally {
      busy.value = false
    }
  }

  async function approve(awardId: string) {
    busy.value = true
    try {
      await $fetch(`${base}/awards/${awardId}/approve`, { method: 'POST', headers: authHeaders() })
      toast.add({ title: 'Resgate aprovado', color: 'success' })
      await fetchRedemptions()
    } catch (err: unknown) {
      toast.add({ title: parseApiError(err), color: 'error' })
    } finally {
      busy.value = false
    }
  }

  async function reject(awardId: string, reason: string) {
    busy.value = true
    try {
      await $fetch(`${base}/awards/${awardId}/reject`, {
        method: 'POST',
        headers: authHeaders(),
        body: { reason },
      })
      toast.add({ title: 'Resgate rejeitado', color: 'success' })
      await fetchRedemptions()
    } catch (err: unknown) {
      toast.add({ title: parseApiError(err), color: 'error' })
    } finally {
      busy.value = false
    }
  }

  async function cancel(awardId: string, reason: string) {
    busy.value = true
    try {
      await $fetch(`${base}/awards/${awardId}/cancel`, {
        method: 'POST',
        headers: authHeaders(),
        body: { reason },
      })
      toast.add({ title: 'Prêmio cancelado', color: 'success' })
      await Promise.all([fetchAwards(), fetchRedemptions()])
    } catch (err: unknown) {
      toast.add({ title: parseApiError(err), color: 'error' })
    } finally {
      busy.value = false
    }
  }

  return {
    rules, awards, redemptions, metrics, logs, loading, busy, isAdmin,
    fetchRules, fetchMetrics, fetchAwards, fetchRedemptions, fetchLogs, fetchUserHistory,
    createRule, updateRule, removeRule, recalculate, approve, reject, cancel,
  }
}

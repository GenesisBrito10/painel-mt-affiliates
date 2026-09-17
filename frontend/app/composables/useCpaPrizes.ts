/**
 * useCpaPrizes — user-facing CPA prize progress, awards, and redemption.
 * GET  /v1/cpa-prizes/progress
 * GET  /v1/cpa-prizes/my-awards
 * POST /v1/cpa-prizes/awards/:id/redeem
 *
 * Também agrega as premiações do RANKING (GET /v1/prizes/my-rewards) p/ que
 * esta página mostre TODOS os prêmios do usuário num só lugar — o resgate
 * dessas premiações continua acontecendo na página /ranking.
 */
import type { MyReward } from '~/types/ranking'

export interface CpaPrizeProgress {
  ruleId: string
  ruleVersionId: string
  name: string
  description: string
  countMode: 'INDIVIDUAL' | 'NETWORK'
  bettingHouse: string | null
  meta: number
  prizeType: string
  prizeValue: number
  prizeLabel: string
  icon: string
  totalCpa: number
  prizesWon: number
  remainder: number
  faltam: number
  message: string
}

export interface CpaPrizeAward {
  id: string
  ruleName: string
  countMode: 'INDIVIDUAL' | 'NETWORK'
  bettingHouse: string | null
  cpaThreshold: number
  cycleIndex: number
  prizeType: string
  prizeValue: number
  prizeLabel: string
  status: 'AVAILABLE' | 'REDEMPTION_REQUESTED' | 'PAID' | 'CANCELLED' | 'REJECTED'
  rejectionReason: string | null
  createdAt: string
  redemptionRequestedAt: string | null
  resolvedAt: string | null
}

export function useCpaPrizes() {
  const { authHeaders } = useAuth()
  const apiBase = useApiBase()
  const toast = useToast()

  const progress = ref<CpaPrizeProgress[]>([])
  const awards = ref<CpaPrizeAward[]>([])
  const rankingAwards = ref<MyReward[]>([])
  const loading = ref(false)
  const redeeming = ref<string | null>(null)
  const error = ref<string | null>(null)

  async function fetchAll() {
    loading.value = true
    error.value = null
    try {
      const [p, a, r] = await Promise.all([
        $fetch<{ data: CpaPrizeProgress[] }>(`${apiBase}/v1/cpa-prizes/progress`, {
          headers: authHeaders(),
        }),
        $fetch<{ data: CpaPrizeAward[] }>(`${apiBase}/v1/cpa-prizes/my-awards`, {
          headers: authHeaders(),
        }),
        $fetch<{ data: MyReward[] }>(`${apiBase}/v1/prizes/my-rewards`, {
          headers: authHeaders(),
        }),
      ])
      progress.value = p.data
      awards.value = a.data
      rankingAwards.value = r.data
    } catch (err: unknown) {
      error.value = parseApiError(err)
    } finally {
      loading.value = false
    }
  }

  async function requestRedemption(awardId: string) {
    redeeming.value = awardId
    try {
      const res = await $fetch<{ success: boolean; message: string }>(
        `${apiBase}/v1/cpa-prizes/awards/${awardId}/redeem`,
        { method: 'POST', headers: authHeaders() },
      )
      toast.add({ title: res.message || 'Resgate solicitado', color: 'success' })
      await fetchAll()
    } catch (err: unknown) {
      toast.add({ title: parseApiError(err), color: 'error' })
    } finally {
      redeeming.value = null
    }
  }

  return {
    progress,
    awards,
    rankingAwards,
    loading,
    redeeming,
    error,
    fetchAll,
    requestRedemption,
  }
}

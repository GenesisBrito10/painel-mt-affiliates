/**
 * useRanking — manages the ranking leaderboard, active prizes, and user rewards.
 *
 * Endpoints consumed:
 *   GET  /v1/prizes/leaderboard  → { data: LeaderboardEntry[], context: LeaderboardContext | null }
 *   GET  /v1/prizes/active       → ActivePrize[]
 *   GET  /v1/prizes/my-rewards   → MyReward[]
 *   POST /v1/prizes/:id/redeem   → RedeemResponse
 */
import type {
  LeaderboardEntry,
  LeaderboardContext,
  LeaderboardResponse,
  ActivePrize,
  ActivePrizesResponse,
  PrizeShowcase,
  PrizeShowcaseResponse,
  MyReward,
  MyRewardsResponse,
  RedeemResponse,
  LeaderboardPeriod,
} from '~/types/ranking'

export function useRanking() {
  const { authHeaders } = useAuth()
  const apiBase = useApiBase()
  const toast = useToast()

  // ─── State ──────────────────────────────────────────────────────────────────
  const leaderboard = ref<LeaderboardEntry[]>([])
  const leaderboardContext = ref<LeaderboardContext | null>(null)
  const loadingLeaderboard = ref(false)

  const prizes = ref<ActivePrize[]>([])
  const loadingPrizes = ref(false)

  // Premiações (ativas + encerradas) com vencedores/lideres embutidos no card.
  const showcase = ref<PrizeShowcase[]>([])
  const loadingShowcase = ref(false)

  const rewards = ref<MyReward[]>([])
  const loadingRewards = ref(false)

  const error = ref<string | null>(null)
  const redeeming = ref(false)

  // ─── Leaderboard ────────────────────────────────────────────────────────────
  async function fetchLeaderboard(opts: { prizeId?: string; period?: LeaderboardPeriod; bettingHouse?: string } = {}) {
    loadingLeaderboard.value = true
    error.value = null
    try {
      const query: Record<string, string> = {}
      if (opts.prizeId) query.prizeId = opts.prizeId
      else if (opts.period) query.period = opts.period
      // House filter applies to the period board (prize-bound board uses the prize's own house)
      if (opts.bettingHouse) query.bettingHouse = opts.bettingHouse

      const res = await $fetch<LeaderboardResponse>(`${apiBase}/v1/prizes/leaderboard`, {
        headers: authHeaders(),
        query,
      })
      leaderboard.value = res.data
      leaderboardContext.value = res.context ?? null
    }
    catch (err: unknown) {
      error.value = parseApiError(err)
    }
    finally {
      loadingLeaderboard.value = false
    }
  }

  // ─── Active Prizes ──────────────────────────────────────────────────────────
  async function fetchActivePrizes() {
    loadingPrizes.value = true
    try {
      const res = await $fetch<ActivePrizesResponse>(`${apiBase}/v1/prizes/active`, {
        headers: authHeaders(),
      })
      prizes.value = res.data
    }
    catch {
      prizes.value = []
    }
    finally {
      loadingPrizes.value = false
    }
  }

  // ─── Showcase (premiações + quem está ganhando / quem ganhou) ────────────────
  async function fetchShowcase() {
    loadingShowcase.value = true
    try {
      const res = await $fetch<PrizeShowcaseResponse>(`${apiBase}/v1/prizes/showcase`, {
        headers: authHeaders(),
      })
      showcase.value = res.data
    }
    catch {
      showcase.value = []
    }
    finally {
      loadingShowcase.value = false
    }
  }

  // ─── My Rewards ─────────────────────────────────────────────────────────────
  async function fetchMyRewards() {
    loadingRewards.value = true
    try {
      const res = await $fetch<MyRewardsResponse>(`${apiBase}/v1/prizes/my-rewards`, {
        headers: authHeaders(),
      })
      rewards.value = res.data
    }
    catch {
      rewards.value = []
    }
    finally {
      loadingRewards.value = false
    }
  }

  // ─── Redeem Prize ───────────────────────────────────────────────────────────
  async function redeemPrize(prizeId: string, rank?: number) {
    redeeming.value = true
    try {
      const body: Record<string, unknown> = {}
      if (rank) body.rank = rank

      const res = await $fetch<RedeemResponse>(`${apiBase}/v1/prizes/${prizeId}/redeem`, {
        method: 'POST',
        headers: authHeaders(),
        body,
      })
      toast.add({
        title: '🎉 Prêmio resgatado!',
        description: res.message,
        color: 'success',
        icon: 'i-lucide-check-circle',
      })
      await fetchMyRewards()
      return { success: true }
    }
    catch (err: unknown) {
      const msg = parseApiError(err)
      toast.add({
        title: 'Erro ao resgatar',
        description: msg,
        color: 'error',
        icon: 'i-lucide-alert-circle',
      })
      return { success: false, error: msg }
    }
    finally {
      redeeming.value = false
    }
  }

  // ─── Derived ────────────────────────────────────────────────────────────────
  const podium = computed(() => leaderboard.value.slice(0, 3))
  const tableEntries = computed(() => leaderboard.value.slice(3))
  const pendingRewards = computed(() => rewards.value.filter(r => !r.redeemed))
  const redeemedRewards = computed(() => rewards.value.filter(r => r.redeemed))

  // ─── Init ───────────────────────────────────────────────────────────────────
  async function init() {
    await Promise.all([fetchActivePrizes(), fetchShowcase(), fetchMyRewards()])
    // Default leaderboard to first active prize, or monthly period
    const firstPrize = prizes.value[0]
    await fetchLeaderboard(firstPrize ? { prizeId: firstPrize.id } : { period: 'month' })
  }

  return {
    // leaderboard
    leaderboard,
    leaderboardContext,
    loadingLeaderboard,
    podium,
    tableEntries,
    fetchLeaderboard,
    // prizes
    prizes,
    loadingPrizes,
    fetchActivePrizes,
    // showcase (premiações com vencedores/lideres)
    showcase,
    loadingShowcase,
    fetchShowcase,
    // rewards
    rewards,
    pendingRewards,
    redeemedRewards,
    loadingRewards,
    fetchMyRewards,
    // redeem
    redeeming,
    redeemPrize,
    // shared
    error,
    init,
  }
}

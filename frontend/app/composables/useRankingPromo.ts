/**
 * useRankingPromo — modal de engajamento exibido UMA vez por sessão no login.
 *
 * Regra (para gerar competição entre afiliados):
 *   1. Se houver premiação ATIVA → exibe a premiação (modo 'prize').
 *   2. Caso contrário → exibe a Classificação Geral (modo 'ranking').
 *
 * Endpoints consumidos (somente leitura):
 *   GET /v1/prizes/active       → ActivePrize[]
 *   GET /v1/prizes/leaderboard  → { data: LeaderboardEntry[], context }
 */
import type {
  ActivePrize,
  ActivePrizesResponse,
  LeaderboardEntry,
  LeaderboardResponse,
} from '~/types/ranking'

const SESSION_KEY = 'vex_ranking_promo_seen'
const rankingPromoDisabled = () => true

function hasSessionFlag(key: string) {
  try {
    return sessionStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function setSessionFlag(key: string) {
  try {
    sessionStorage.setItem(key, '1')
  } catch {
    // Storage may be unavailable on restricted Safari sessions.
  }
}

export function useRankingPromo() {
  const { user, authHeaders } = useAuth()
  const apiBase = useApiBase()

  const showModal = ref(false)
  const mode = ref<'prize' | 'ranking'>('ranking')
  const activePrize = ref<ActivePrize | null>(null)
  const topEntries = ref<LeaderboardEntry[]>([])
  const myEntry = ref<LeaderboardEntry | null>(null)

  async function check(): Promise<void> {
    // Temporarily disabled: do not show the ranking/prize promo modal on login.
    if (rankingPromoDisabled()) return

    if (!import.meta.client) return
    const u = user.value
    if (!u || u.role !== 'affiliate') return

    const key = `${SESSION_KEY}:${u.id}`
    if (hasSessionFlag(key)) return

    // 1. Premiação ativa?
    let prizes: ActivePrize[] = []
    try {
      const res = await $fetch<ActivePrizesResponse>(`${apiBase}/v1/prizes/active`, {
        headers: authHeaders(),
        timeout: 5000,
      })
      prizes = res.data ?? []
    }
    catch {
      prizes = []
    }
    const prize = prizes[0] ?? null

    // 2. Leaderboard (vinculado ao prêmio se houver, senão mensal).
    let board: LeaderboardEntry[] = []
    try {
      const res = await $fetch<LeaderboardResponse>(`${apiBase}/v1/prizes/leaderboard`, {
        headers: authHeaders(),
        query: prize ? { prizeId: prize.id } : { period: 'month' },
        timeout: 5000,
      })
      board = res.data ?? []
    }
    catch {
      board = []
    }

    // 3. Decide modo + dados.
    mode.value = prize ? 'prize' : 'ranking'
    activePrize.value = prize
    topEntries.value = board.slice(0, 5)
    myEntry.value = board.find(e => e.isMe) ?? null

    // Sem premiação E sem ninguém no ranking → nada a mostrar.
    if (!prize && board.length === 0) return

    setSessionFlag(key)
    showModal.value = true
  }

  function dismiss(): void {
    showModal.value = false
  }

  return { showModal, mode, activePrize, topEntries, myEntry, check, dismiss }
}

/**
 * usePrizeNotification — checks for unredeemed prizes on mount and exposes
 * state so the default layout can show a "redeem your prize" modal.
 *
 * - Fetches GET /v1/prizes/my-rewards once per session (using sessionStorage flag).
 * - If the user has ≥ 1 pending reward, opens the modal automatically.
 * - The layout can also call `redeemFromModal` to trigger the redeem flow.
 */
import type { MyReward, MyRewardsResponse, RedeemResponse } from '~/types/ranking'

const SESSION_KEY = 'vex_prize_notif_checked'

function hasSessionFlag(key: string) {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

function setSessionFlag(key: string) {
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(key, '1')
  } catch {
    // Storage may be unavailable on restricted Safari sessions.
  }
}

export function usePrizeNotification() {
  const { authHeaders } = useAuth()
  const apiBase = useApiBase()
  const toast = useToast()

  const showModal = ref(false)
  const pendingRewards = ref<MyReward[]>([])
  const redeeming = ref(false)
  const currentIdx = ref(0)

  const current = computed(() => pendingRewards.value[currentIdx.value] ?? null)
  const total = computed(() => pendingRewards.value.length)

  // Check once per browser session so the modal doesn't re-appear on every navigation.
  async function check() {
    if (hasSessionFlag(SESSION_KEY)) return

    try {
      const res = await $fetch<MyRewardsResponse>(`${apiBase}/v1/prizes/my-rewards`, {
        headers: authHeaders(),
        timeout: 5000,
      })
      const pending = (res.data ?? []).filter(r => !r.redeemed)
      if (pending.length) {
        pendingRewards.value = pending
        currentIdx.value = 0
        showModal.value = true
      }
    }
    catch {
      // Silently ignore — non-critical
    }
    finally {
      setSessionFlag(SESSION_KEY)
    }
  }

  async function redeemCurrent() {
    if (!current.value) return
    redeeming.value = true
    try {
      const res = await $fetch<RedeemResponse>(`${apiBase}/v1/prizes/${current.value.prizeId}/redeem`, {
        method: 'POST',
        headers: authHeaders(),
        body: { rank: current.value.rank },
      })
      toast.add({
        title: '🎉 Prêmio resgatado!',
        description: res.message,
        color: 'success',
        icon: 'i-lucide-check-circle',
      })
      // Remove redeemed from list
      pendingRewards.value = pendingRewards.value.filter((_, i) => i !== currentIdx.value)
      if (currentIdx.value >= pendingRewards.value.length) {
        currentIdx.value = Math.max(0, pendingRewards.value.length - 1)
      }
      if (!pendingRewards.value.length) showModal.value = false
    }
    catch (err: unknown) {
      toast.add({
        title: 'Erro ao resgatar',
        description: parseApiError(err),
        color: 'error',
        icon: 'i-lucide-alert-circle',
      })
    }
    finally {
      redeeming.value = false
    }
  }

  function skipCurrent() {
    pendingRewards.value = pendingRewards.value.filter((_, i) => i !== currentIdx.value)
    if (!pendingRewards.value.length) {
      showModal.value = false
    }
    else {
      currentIdx.value = Math.min(currentIdx.value, pendingRewards.value.length - 1)
    }
  }

  function dismiss() {
    showModal.value = false
  }

  return {
    showModal,
    pendingRewards,
    current,
    total,
    currentIdx,
    redeeming,
    check,
    redeemCurrent,
    skipCurrent,
    dismiss,
  }
}

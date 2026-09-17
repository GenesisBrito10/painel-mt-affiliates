// Estado global de manutenção. Faz polling no endpoint público /v1/maintenance.

interface MaintenanceState {
  enabled: boolean
  title: string
  message: string
  bannerEnabled: boolean
  bannerTitle: string
  bannerMessage: string
}

const POLL_INTERVAL_MS = 30_000
const DEFAULT_STATE: MaintenanceState = {
  enabled: false,
  title: 'Sistema em manutenção',
  message: 'Estamos realizando uma manutenção programada. Voltamos em instantes.',
  bannerEnabled: false,
  bannerTitle: 'Instabilidade temporária',
  bannerMessage: 'Estamos passando por uma instabilidade no painel. Tudo deve voltar ao normal em breve.'
}

let maintenancePollTimer: ReturnType<typeof window.setInterval> | null = null

function stopMaintenancePolling() {
  if (!maintenancePollTimer) return
  window.clearInterval(maintenancePollTimer)
  maintenancePollTimer = null
}

export function useMaintenance() {
  const state = useState<MaintenanceState>('maintenance', () => ({ ...DEFAULT_STATE }))
  const ready = useState<boolean>('maintenance:ready', () => false)

  async function refresh() {
    if (typeof window === 'undefined') return
    try {
      const apiBase = useApiBase()
      const data = await $fetch<MaintenanceState>(`${apiBase}/v1/maintenance`, {
        timeout: 5000,
      })
      state.value = {
        enabled: !!data.enabled,
        title: data.title || DEFAULT_STATE.title,
        message: data.message || DEFAULT_STATE.message,
        bannerEnabled: !!data.bannerEnabled,
        bannerTitle: data.bannerTitle || DEFAULT_STATE.bannerTitle,
        bannerMessage: data.bannerMessage || DEFAULT_STATE.bannerMessage
      }
    } catch {
      // silencioso: mantém último valor conhecido
    } finally {
      ready.value = true
    }
  }

  function startPolling() {
    if (typeof window === 'undefined') return () => {}
    if (!maintenancePollTimer) {
      void refresh()
      maintenancePollTimer = window.setInterval(refresh, POLL_INTERVAL_MS)
    }
    return stopMaintenancePolling
  }

  return { state, ready, refresh, startPolling, stopPolling: stopMaintenancePolling }
}

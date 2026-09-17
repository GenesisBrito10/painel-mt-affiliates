export interface LoginModalConfig {
  id: string
  key: string
  enabled: boolean
  audience: string
  priority: number
  kind: string
  title: string
  eyebrow: string
  description: string
  icon: string
  actionLabel: string
  secondaryActionLabel: string
  actionUrl: string | null
  accent: string
  storageKey: string
  dismissScope: string
  imageUrl: string | null
  imageLayout: string
  lockSeconds: number
  payload: Record<string, unknown> | null
}

export function useLoginModals() {
  const apiBase = useApiBase()
  const { user, token, authHeaders } = useAuth()

  const modals = useState<LoginModalConfig[]>('login-modals', () => [])
  const loaded = useState<boolean>('login-modals-loaded', () => false)
  const failed = useState<boolean>('login-modals-failed', () => false)
  const loadedForUser = useState<string | null>('login-modals-loaded-for-user', () => null)

  const ready = computed(() => loaded.value || failed.value)

  async function fetchLoginModals(force = false) {
    const currentUser = user.value
    if (!token.value || !currentUser) return
    if (!force && loaded.value && loadedForUser.value === currentUser.id) return

    try {
      const res = await $fetch<LoginModalConfig[]>(`${apiBase}/v1/login-modals`, {
        headers: authHeaders(),
      })
      modals.value = Array.isArray(res) ? res : []
      loadedForUser.value = currentUser.id
      loaded.value = true
      failed.value = false
    } catch {
      failed.value = true
      loaded.value = false
      modals.value = []
      loadedForUser.value = currentUser.id
    }
  }

  function modalByKey(key: string): LoginModalConfig | null {
    return modals.value.find(modal => modal.key === key) ?? null
  }

  function resetLoginModals() {
    modals.value = []
    loaded.value = false
    failed.value = false
    loadedForUser.value = null
  }

  return {
    modals,
    loaded,
    failed,
    ready,
    fetchLoginModals,
    modalByKey,
    resetLoginModals,
  }
}

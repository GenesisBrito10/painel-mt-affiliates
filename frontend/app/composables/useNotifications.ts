/**
 * useNotifications — notification management for VeXXa affiliates.
 *
 * Endpoints consumed:
 *   GET    /v1/notifications                          → paginated list (cursor)
 *   GET    /v1/notifications/unread-count             → { count: number }
 *   PATCH  /v1/notifications/read-all                 → { count: number }
 *   PATCH  /v1/notifications/:id/read                 → Notification
 *   DELETE /v1/notifications/:id                      → 204
 *   GET    /v1/notifications/vapid-public-key         → { publicKey: string }
 *   POST   /v1/notifications/push-subscriptions       → PushSubscription
 *   DELETE /v1/notifications/push-subscriptions/:id   → 204
 *   POST   /v1/notifications/push-subscriptions/test  → { sent: number }
 */

export interface NotificationItem {
  id: string
  type: 'REGISTRATION' | 'COMMISSION_CHANGE' | 'WITHDRAWAL_APPROVED' | 'STATUS_CHANGE' | 'GENERAL'
  title: string
  message: string
  read: boolean
  metadata: Record<string, unknown> | null
  createdAt: string
}

interface ListResponse {
  data: NotificationItem[]
  total: number
  nextCursor: string | null
}

interface PushSubscriptionRecord {
  id: string
  endpoint: string
}

// ─── Global shared state (singleton across composable instances) ──────────────

const _notifications = () => useState<NotificationItem[]>('notif-list', () => [])
const _unreadCount = () => useState<number>('notif-unread', () => 0)
const _nextCursor = () => useState<string | null>('notif-cursor', () => null)
const _activePushSubId = () => useState<string | null>('notif-push-sub-id', () => null)

export function useNotifications() {
  const { authHeaders } = useAuth()
  const apiBase = useApiBase()

  const notifications = _notifications()
  const unreadCount = _unreadCount()
  const nextCursor = _nextCursor()
  const activePushSubId = _activePushSubId()

  const loading = ref(false)
  const loadingMore = ref(false)
  const markingAll = ref(false)
  const pushLoading = ref(false)
  const pushEnabled = ref(false)
  const pushSupported = ref(false)
  const pushError = ref<string | null>(null)
  const hasMore = computed(() => !!nextCursor.value)

  // ─── Polling interval handle ──────────────────────────────────────────────

  let pollTimer: ReturnType<typeof setInterval> | null = null

  // ─── Fetch list (initial or filter change) ────────────────────────────────

  async function fetchList(readFilter?: boolean) {
    loading.value = true
    nextCursor.value = null
    try {
      const query: Record<string, string | number | boolean> = { limit: 25 }
      if (readFilter !== undefined) query.read = readFilter

      const res = await $fetch<ListResponse>(`${apiBase}/v1/notifications`, {
        headers: authHeaders(),
        query,
      })
      notifications.value = res.data
      nextCursor.value = res.nextCursor
      unreadCount.value = res.data.filter(n => !n.read).length
    } catch (err: unknown) {
      console.error('[useNotifications] fetchList:', parseApiError(err))
    } finally {
      loading.value = false
    }
  }

  // ─── Load more (cursor pagination) ───────────────────────────────────────

  async function loadMore(readFilter?: boolean) {
    if (!nextCursor.value || loadingMore.value) return
    loadingMore.value = true
    try {
      const query: Record<string, string | number | boolean> = { limit: 25, cursor: nextCursor.value }
      if (readFilter !== undefined) query.read = readFilter

      const res = await $fetch<ListResponse>(`${apiBase}/v1/notifications`, {
        headers: authHeaders(),
        query,
      })
      notifications.value = [...notifications.value, ...res.data]
      nextCursor.value = res.nextCursor
    } catch (err: unknown) {
      console.error('[useNotifications] loadMore:', parseApiError(err))
    } finally {
      loadingMore.value = false
    }
  }

  // ─── Poll unread count (for sidebar badge) ────────────────────────────────

  async function fetchUnreadCount() {
    try {
      const res = await $fetch<{ count: number }>(`${apiBase}/v1/notifications/unread-count`, {
        headers: authHeaders(),
      })
      unreadCount.value = res.count
    } catch {
      // silent — non-critical
    }
  }

  function startPolling(intervalMs = 60_000) {
    stopPolling()
    fetchUnreadCount()
    pollTimer = setInterval(fetchUnreadCount, intervalMs)
  }

  function stopPolling() {
    if (pollTimer !== null) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  // ─── Mark single as read ──────────────────────────────────────────────────

  async function markAsRead(id: string) {
    const notif = notifications.value.find(n => n.id === id)
    if (!notif || notif.read) return

    try {
      await $fetch(`${apiBase}/v1/notifications/${id}/read`, {
        method: 'PATCH',
        headers: authHeaders(),
      })
      notif.read = true
      unreadCount.value = Math.max(0, unreadCount.value - 1)
    } catch (err: unknown) {
      console.error('[useNotifications] markAsRead:', parseApiError(err))
    }
  }

  // ─── Mark all as read ─────────────────────────────────────────────────────

  async function markAllAsRead() {
    markingAll.value = true
    try {
      await $fetch(`${apiBase}/v1/notifications/read-all`, {
        method: 'PATCH',
        headers: authHeaders(),
      })
      notifications.value.forEach(n => { n.read = true })
      unreadCount.value = 0
    } catch (err: unknown) {
      console.error('[useNotifications] markAllAsRead:', parseApiError(err))
    } finally {
      markingAll.value = false
    }
  }

  // ─── Delete notification ──────────────────────────────────────────────────

  async function deleteNotification(id: string) {
    try {
      await $fetch(`${apiBase}/v1/notifications/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      const removed = notifications.value.find(n => n.id === id)
      notifications.value = notifications.value.filter(n => n.id !== id)
      if (removed && !removed.read) {
        unreadCount.value = Math.max(0, unreadCount.value - 1)
      }
    } catch (err: unknown) {
      console.error('[useNotifications] delete:', parseApiError(err))
    }
  }

  // ─── Push Notifications ───────────────────────────────────────────────────

  function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const rawData = window.atob(base64)
    const arr = new Uint8Array(rawData.length)
    for (let i = 0; i < rawData.length; i++) arr[i] = rawData.charCodeAt(i)
    return arr
  }

  async function initPushState() {
    if (!import.meta.client) return
    pushError.value = null

    // ── Step 1: Check browser API capability ──────────────────────────────────
    const hasSW = 'serviceWorker' in navigator
    const hasPush = 'PushManager' in window
    const hasNotification = 'Notification' in window

    if (!hasSW || !hasPush || !hasNotification) {
      pushSupported.value = false
      pushError.value = 'Seu navegador não suporta notificações push.'
      return
    }

    // ── Step 2: HTTPS check (required for push on all browsers) ──────────────
    const isSecure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    if (!isSecure) {
      pushSupported.value = false
      pushError.value = 'Notificações push requerem HTTPS. Acesse via conexão segura.'
      return
    }

    // ── Step 3: Mark as supported — browser has the capability ───────────────
    pushSupported.value = true

    // ── Step 4: Try to register the SW and read current subscription state ───
    try {
      const reg = await navigator.serviceWorker.register('/sw-push.js', { scope: '/' })
      await navigator.serviceWorker.ready

      const permission = Notification.permission
      if (permission === 'denied') {
        pushError.value = 'Permissão bloqueada. Habilite as notificações nas configurações do navegador.'
        pushEnabled.value = false
        return
      }

      const sub = await reg.pushManager.getSubscription()
      pushEnabled.value = !!sub || !!activePushSubId.value
    } catch (err) {
      // SW registration failed — but browser still supports it in theory
      // Don't set pushSupported to false, just surface the error
      const msg = err instanceof Error ? err.message : String(err)
      pushError.value = `Erro ao inicializar: ${msg}`
      pushEnabled.value = false
    }
  }

  async function togglePush() {
    if (!pushSupported.value || pushLoading.value) return
    pushLoading.value = true

    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw-push.js')
      if (!reg) throw new Error('Service worker not registered')

      if (pushEnabled.value) {
        // Unsubscribe
        const sub = await reg.pushManager.getSubscription()
        if (sub) await sub.unsubscribe()

        if (activePushSubId.value) {
          await $fetch(`${apiBase}/v1/notifications/push-subscriptions/${activePushSubId.value}`, {
            method: 'DELETE',
            headers: authHeaders(),
          }).catch(() => undefined)
          activePushSubId.value = null
        }
        pushEnabled.value = false
      } else {
        // Subscribe
        const vapidRes = await $fetch<{ publicKey: string }>(
          `${apiBase}/v1/notifications/vapid-public-key`,
          { headers: authHeaders() },
        )
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidRes.publicKey).buffer as ArrayBuffer,
        })
        const json = sub.toJSON()
        const record = await $fetch<PushSubscriptionRecord>(
          `${apiBase}/v1/notifications/push-subscriptions`,
          {
            method: 'POST',
            headers: authHeaders(),
            body: {
              endpoint: json.endpoint,
              p256dh: json.keys?.p256dh,
              auth: json.keys?.auth,
            },
          },
        )
        activePushSubId.value = record.id
        pushEnabled.value = true
      }
    } catch (err: unknown) {
      console.error('[useNotifications] togglePush:', err)
    } finally {
      pushLoading.value = false
    }
  }

  async function sendTestPush(): Promise<{ sent: number }> {
    try {
      return await $fetch<{ sent: number }>(
        `${apiBase}/v1/notifications/push-subscriptions/test`,
        { method: 'POST', headers: authHeaders() },
      )
    } catch (err: unknown) {
      console.error('[useNotifications] sendTestPush:', parseApiError(err))
      return { sent: 0 }
    }
  }

  return {
    // state
    notifications,
    unreadCount,
    hasMore,
    loading,
    loadingMore,
    markingAll,
    pushLoading,
    pushEnabled,
    pushSupported,
    pushError,
    // list
    fetchList,
    loadMore,
    // read / delete
    markAsRead,
    markAllAsRead,
    deleteNotification,
    // polling
    startPolling,
    stopPolling,
    fetchUnreadCount,
    // push
    initPushState,
    togglePush,
    sendTestPush,
  }
}

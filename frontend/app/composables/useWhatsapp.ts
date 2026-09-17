// Composable do Admin WhatsApp — todas as chamadas passam pelo backend.

export interface WhatsappStatus {
  status: 'open' | 'close' | 'connecting' | 'error'
  instanceName: string
  phoneNumber: string | null
  lastConnectedAt: string | null
  lastDisconnectedAt: string | null
  circuitOpenUntil: string | null
  consecutiveFailures: number
  selectedGroupId: string | null
  selectedGroupName: string | null
  enabled: boolean
}

export interface WhatsappGroup {
  id: string
  name: string
}

export interface WhatsappSettings {
  id: string
  instanceName: string
  selectedGroupId: string | null
  selectedGroupName: string | null
  messageTemplate: string
  sendMedia: boolean
  delayMinSeconds: number
  delayMaxSeconds: number
  maxAttempts: number
  maxWaitConnectionMinutes: number
  failureCooldownSeconds: number
  enabled: boolean
}

export interface WhatsappSendLog {
  id: string
  withdrawalId: string | null
  isTest: boolean
  userName: string
  userEmail: string | null
  amount: string | null
  groupName: string | null
  message: string
  status: string
  attempts: number
  lastError: string | null
  evolutionResponse: Record<string, unknown> | null
  sentAt: string | null
  createdAt: string
}

export interface WhatsappMetrics {
  total: number
  sent: number
  failed: number
  pending: number
  waitingConnection: number
  paused: number
  cancelled: number
  successRate: number
  lastSentAt: string | null
  lastFailureAt: string | null
  connectionStatus: string
  circuitOpenUntil: string | null
}

export interface HistoryQuery {
  status?: string
  from?: string
  to?: string
  search?: string
  page?: number
  limit?: number
}

export function useWhatsapp() {
  const apiBase = useApiBase()
  const { authHeaders } = useAuth()
  const base = `${apiBase}/v1/whatsapp`

  const fetchStatus = () =>
    $fetch<WhatsappStatus>(`${base}/status`, { headers: authHeaders() })

  const connect = () =>
    $fetch<{ status: string; qrcode?: string }>(`${base}/connect`, {
      method: 'POST',
      headers: authHeaders(),
    })

  const fetchQrCode = () =>
    $fetch<{ qrcode?: string; pairingCode?: string }>(`${base}/qrcode`, {
      headers: authHeaders(),
    })

  const reconnect = () =>
    $fetch<{ status: string }>(`${base}/reconnect`, {
      method: 'POST',
      headers: authHeaders(),
    })

  const disconnect = () =>
    $fetch<{ status: string }>(`${base}/disconnect`, {
      method: 'POST',
      headers: authHeaders(),
    })

  const resetCircuit = () =>
    $fetch<WhatsappStatus>(`${base}/reset-circuit`, {
      method: 'POST',
      headers: authHeaders(),
    })

  // Limpa o token de instância cacheado e re-resolve (usar após reconectar a
  // instância na Evolution — token salvo fica velho e dá 401).
  const refreshInstance = () =>
    $fetch<WhatsappStatus & { tokenResolved: boolean }>(
      `${base}/refresh-instance`,
      { method: 'POST', headers: authHeaders() },
    )

  const fetchGroups = () =>
    $fetch<WhatsappGroup[]>(`${base}/groups`, { headers: authHeaders() })

  const fetchSettings = () =>
    $fetch<WhatsappSettings>(`${base}/settings`, { headers: authHeaders() })

  const saveSettings = (body: Partial<WhatsappSettings>) =>
    $fetch<WhatsappSettings>(`${base}/settings`, {
      method: 'PUT',
      headers: authHeaders(),
      body,
    })

  const preview = (template?: string) =>
    $fetch<{ preview: string }>(`${base}/settings/preview`, {
      method: 'POST',
      headers: authHeaders(),
      body: { template },
    })

  const testSend = () =>
    $fetch<{ enqueued: boolean; logId: string }>(`${base}/test-send`, {
      method: 'POST',
      headers: authHeaders(),
    })

  const fetchMetrics = () =>
    $fetch<WhatsappMetrics>(`${base}/metrics`, { headers: authHeaders() })

  const fetchHistory = (query: HistoryQuery) =>
    $fetch<{
      data: WhatsappSendLog[]
      total: number
      page: number
      limit: number
      totalPages: number
    }>(`${base}/send-history`, { headers: authHeaders(), query })

  const fetchDetail = (id: string) =>
    $fetch<WhatsappSendLog>(`${base}/send-history/${id}`, {
      headers: authHeaders(),
    })

  const retry = (id: string) =>
    $fetch<WhatsappSendLog>(`${base}/send-history/${id}/retry`, {
      method: 'POST',
      headers: authHeaders(),
    })

  return {
    fetchStatus,
    connect,
    fetchQrCode,
    reconnect,
    disconnect,
    resetCircuit,
    refreshInstance,
    fetchGroups,
    fetchSettings,
    saveSettings,
    preview,
    testSend,
    fetchMetrics,
    fetchHistory,
    fetchDetail,
    retry,
  }
}

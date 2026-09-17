export const LINK_WEBHOOK_EVENTS = [
  'link_request.created',
  'link_request.approved',
  'link_request.rejected',
  'affiliate_data.synced',
  'deal.updated',
  'house.updated',
  'withdrawal.created',
  'withdrawal.status_changed',
] as const

export type LinkWebhookEventName = (typeof LINK_WEBHOOK_EVENTS)[number]

export const LINK_WEBHOOK_EVENT_LABELS: Record<string, string> = {
  'link_request.created': 'Pedido de link criado',
  'link_request.approved': 'Link aprovado',
  'link_request.rejected': 'Link rejeitado',
  'affiliate_data.synced': 'Dados sincronizados (pós-cron)',
  'deal.updated': 'Deal alterado',
  'house.updated': 'Casa alterada',
  'withdrawal.created': 'Saque criado',
  'withdrawal.status_changed': 'Saque mudou de status',
}

export interface LinkWebhookSettings {
  id: string
  ownerUserId: string | null
  scope: 'global' | 'network'
  enabled: boolean
  webhookUrl: string
  webhookSecret: string
  hasSecret: boolean
  events: string[]
  availableEvents: string[]
  updatedAt: string
}

export interface LinkWebhookDelivery {
  id: string
  linkRequestId: string | null
  event: string
  origin: string
  status: 'PENDING' | 'SUCCESS' | 'FAILED'
  httpStatus: number | null
  responseBody: string | null
  errorMessage: string | null
  attempts: number
  payload: unknown
  deliveredAt: string | null
  createdAt: string
  requesterName: string | null
  requesterEmail: string | null
}

interface DeliveriesResponse {
  data: LinkWebhookDelivery[]
  total: number
  page: number
  limit: number
}

export interface TestWebhookResponse {
  success: boolean
  httpStatus?: number
  error?: string
  event?: string
  request?: {
    headers?: Record<string, string>
    timestamp?: number
    body?: string
  }
  responseBody?: string | null
}

export interface DeliveryFilters {
  status?: string
  event?: string
  from?: string
  to?: string
  search?: string
}

export function useLinkWebhooks() {
  const apiBase = useApiBase()
  const { authHeaders } = useAuth()

  async function fetchSettings() {
    return await $fetch<LinkWebhookSettings>(`${apiBase}/v1/admin/link-webhooks/settings`, {
      headers: authHeaders(),
    })
  }

  async function saveSettings(payload: {
    enabled?: boolean
    webhookUrl?: string
    events?: string[]
    webhookSecret?: string
  }) {
    return await $fetch<LinkWebhookSettings>(`${apiBase}/v1/admin/link-webhooks/settings`, {
      method: 'PUT',
      headers: authHeaders(),
      body: payload,
    })
  }

  async function fetchDeliveries(page = 1, limit = 20, filters: DeliveryFilters = {}) {
    return await $fetch<DeliveriesResponse>(`${apiBase}/v1/admin/link-webhooks/deliveries`, {
      headers: authHeaders(),
      query: {
        page,
        limit,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.event ? { event: filters.event } : {}),
        ...(filters.from ? { from: filters.from } : {}),
        ...(filters.to ? { to: filters.to } : {}),
        ...(filters.search ? { search: filters.search } : {}),
      },
    })
  }

  async function redeliver(id: string) {
    return await $fetch<{ id: string, status: string }>(
      `${apiBase}/v1/admin/link-webhooks/deliveries/${id}/redeliver`,
      { method: 'POST', headers: authHeaders() },
    )
  }

  async function testWebhook(event?: string) {
    return await $fetch<TestWebhookResponse>(`${apiBase}/v1/admin/link-webhooks/test`, {
      method: 'POST',
      headers: authHeaders(),
      body: event ? { event } : {},
    })
  }

  return {
    fetchSettings,
    saveSettings,
    fetchDeliveries,
    redeliver,
    testWebhook,
  }
}

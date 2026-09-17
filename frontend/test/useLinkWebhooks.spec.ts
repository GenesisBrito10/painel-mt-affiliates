import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  useLinkWebhooks,
  LINK_WEBHOOK_EVENTS,
  LINK_WEBHOOK_EVENT_LABELS,
} from '../app/composables/useLinkWebhooks'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('useApiBase', () => 'http://api')
  vi.stubGlobal('useAuth', () => ({
    authHeaders: () => ({ Authorization: 'Bearer token' }),
  }))
  vi.stubGlobal('$fetch', fetchMock)
  fetchMock.mockReset().mockResolvedValue({})
})

describe('webhook event catalog', () => {
  it('has a label for every event', () => {
    for (const ev of LINK_WEBHOOK_EVENTS) {
      expect(LINK_WEBHOOK_EVENT_LABELS[ev]).toBeTruthy()
    }
  })

  it('includes the cron and link events', () => {
    expect(LINK_WEBHOOK_EVENTS).toContain('affiliate_data.synced')
    expect(LINK_WEBHOOK_EVENTS).toContain('link_request.approved')
  })
})

describe('useLinkWebhooks', () => {
  it('saveSettings PUTs events array', async () => {
    const { saveSettings } = useLinkWebhooks()
    await saveSettings({ enabled: true, webhookUrl: 'https://x', events: ['deal.updated'] })

    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('http://api/v1/admin/link-webhooks/settings')
    expect(opts.method).toBe('PUT')
    expect(opts.body).toEqual({ enabled: true, webhookUrl: 'https://x', events: ['deal.updated'] })
  })

  it('fetchDeliveries forwards status/event filters as query', async () => {
    const { fetchDeliveries } = useLinkWebhooks()
    await fetchDeliveries(2, 10, { status: 'FAILED', event: 'house.updated' })

    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('http://api/v1/admin/link-webhooks/deliveries')
    expect(opts.query).toEqual({ page: 2, limit: 10, status: 'FAILED', event: 'house.updated' })
  })

  it('fetchDeliveries omits empty filters', async () => {
    const { fetchDeliveries } = useLinkWebhooks()
    await fetchDeliveries(1, 20)
    const [, opts] = fetchMock.mock.calls[0]
    expect(opts.query).toEqual({ page: 1, limit: 20 })
  })

  it('redeliver POSTs to the redeliver endpoint', async () => {
    const { redeliver } = useLinkWebhooks()
    await redeliver('del-9')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('http://api/v1/admin/link-webhooks/deliveries/del-9/redeliver')
    expect(opts.method).toBe('POST')
  })
})

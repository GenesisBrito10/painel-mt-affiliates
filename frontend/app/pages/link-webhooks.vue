<script setup lang="ts">
import type { LinkWebhookDelivery, LinkWebhookSettings, LinkWebhookEventName } from '~/composables/useLinkWebhooks'

definePageMeta({ layout: 'default' })

const { user } = useAuth()
const lw = useLinkWebhooks()
const toast = useToast()

const loading = ref(true)
const saving = ref(false)
const testing = ref(false)
const deliveriesLoading = ref(false)
const settings = ref<LinkWebhookSettings | null>(null)
const deliveries = ref<LinkWebhookDelivery[]>([])
const page = ref(1)
const total = ref(0)
const limit = 15
const secretInput = ref('')

const canAccessLinkWebhooks = computed(() =>
  user.value?.role === 'admin' || !!user.value?.apiAccessEnabled,
)

const isNetworkScope = computed(() =>
  settings.value?.scope === 'network'
  || (user.value?.role !== 'admin' && !!user.value?.hasReferrals),
)

const subtitle = computed(() =>
  isNetworkScope.value
    ? 'Sua configuração exclusiva. Recebe eventos dos seus links e dos afiliados da sua rede.'
    : 'Configuração global. Recebe todos os eventos de links da plataforma.',
)

const payloadExample = computed(() => JSON.stringify({
  event: 'link_request.approved',
  timestamp: '2026-06-10T00:00:00.000Z',
  origin: 'ADMIN_APPROVE',
  linkRequest: {
    id: '...',
    status: 'FULFILLED',
    bettingHouseSlug: 'superbet',
    links: [{ label: 'Link principal', url: 'https://...' }],
    dealId: '...',
    fulfilledAt: '2026-06-10T00:00:00.000Z',
  },
  user: {
    id: '...',
    name: 'Cliente do Parceiro',
    email: 'cliente@painel-do-parceiro.com',
    referredById: '...',
  },
  affiliateLink: {
    bettingHouse: 'superbet',
    campaignId: 'campaign-id-atribuido',
    cpa: 150,
    revshare: 35,
  },
}, null, 2))

const eventLabels = LINK_WEBHOOK_EVENT_LABELS

const eventFilter = ref('')
const statusFilter = ref('')
const expandedId = ref<string | null>(null)
const redeliveringId = ref<string | null>(null)

const availableEvents = computed(() => settings.value?.availableEvents ?? [...LINK_WEBHOOK_EVENTS])

function toggleEvent(name: string, on: boolean) {
  if (!settings.value) return
  const set = new Set(settings.value.events)
  if (on) set.add(name)
  else set.delete(name)
  settings.value.events = [...set]
}

const statusLabels: Record<string, string> = {
  SUCCESS: 'Entregue',
  FAILED: 'Falhou',
  PENDING: 'Pendente',
}

const statusColors: Record<string, 'success' | 'error' | 'warning'> = {
  SUCCESS: 'success',
  FAILED: 'error',
  PENDING: 'warning',
}

function formatDate(value: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function loadSettings() {
  settings.value = await lw.fetchSettings()
  secretInput.value = ''
}

async function loadDeliveries(p = page.value) {
  deliveriesLoading.value = true
  try {
    const res = await lw.fetchDeliveries(p, limit, {
      status: statusFilter.value || undefined,
      event: eventFilter.value || undefined,
    })
    deliveries.value = res.data
    total.value = res.total
    page.value = res.page
  } finally {
    deliveriesLoading.value = false
  }
}

async function save() {
  if (!settings.value || saving.value) return
  saving.value = true
  try {
    const body: {
      enabled: boolean
      webhookUrl: string
      events: string[]
      webhookSecret?: string
    } = {
      enabled: settings.value.enabled,
      webhookUrl: settings.value.webhookUrl,
      events: settings.value.events,
    }
    if (secretInput.value.trim()) body.webhookSecret = secretInput.value.trim()
    settings.value = await lw.saveSettings(body)
    secretInput.value = ''
    toast.add({ title: 'Configuração salva', color: 'success', icon: 'i-lucide-check' })
  } catch (err) {
    toast.add({ title: 'Erro ao salvar', description: parseApiError(err), color: 'error', icon: 'i-lucide-alert-circle' })
  } finally {
    saving.value = false
  }
}

async function redeliver(id: string) {
  if (redeliveringId.value) return
  redeliveringId.value = id
  try {
    await lw.redeliver(id)
    toast.add({ title: 'Reenvio enfileirado', color: 'success', icon: 'i-lucide-send' })
    await loadDeliveries(1)
  } catch (err) {
    toast.add({ title: 'Falha ao reenviar', description: parseApiError(err), color: 'error', icon: 'i-lucide-alert-circle' })
  } finally {
    redeliveringId.value = null
  }
}

function toggleExpand(id: string) {
  expandedId.value = expandedId.value === id ? null : id
}

function prettyPayload(payload: unknown) {
  try {
    return JSON.stringify(payload, null, 2)
  } catch {
    return String(payload)
  }
}

const testEvent = ref<LinkWebhookEventName>('link_request.approved')
const testResult = ref<import('~/composables/useLinkWebhooks').TestWebhookResponse | null>(null)
const testEventOptions = LINK_WEBHOOK_EVENTS.map(e => ({ label: eventLabels[e] ?? e, value: e }))

async function runTest() {
  if (testing.value) return
  testing.value = true
  try {
    const res = await lw.testWebhook(testEvent.value)
    testResult.value = res
    if (res.success) {
      toast.add({ title: 'Teste enviado', description: `HTTP ${res.httpStatus}`, color: 'success', icon: 'i-lucide-send' })
    } else {
      toast.add({ title: 'Teste falhou', description: res.error, color: 'error', icon: 'i-lucide-alert-circle' })
    }
    await loadDeliveries(1)
  } catch (err) {
    toast.add({ title: 'Teste falhou', description: parseApiError(err), color: 'error', icon: 'i-lucide-alert-circle' })
  } finally {
    testing.value = false
  }
}

onMounted(async () => {
  if (!canAccessLinkWebhooks.value) {
    loading.value = false
    return
  }
  try {
    await Promise.all([loadSettings(), loadDeliveries(1)])
  } catch (err) {
    toast.add({ title: 'Erro ao carregar webhooks', description: parseApiError(err), color: 'error', icon: 'i-lucide-alert-circle' })
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <main class="space-y-6">
    <div>
      <p class="text-sm font-medium text-emerald-700">Integrações</p>
      <h1 class="mt-1 text-2xl font-semibold text-slate-950">Webhooks de Links</h1>
      <p class="mt-2 max-w-3xl text-sm text-slate-600">{{ subtitle }}</p>
    </div>

    <UCard v-if="!loading && !canAccessLinkWebhooks">
      <div class="flex items-start gap-3">
        <UIcon name="i-lucide-lock" class="mt-0.5 h-5 w-5 text-amber-600" />
        <div>
          <h2 class="font-semibold text-slate-950">Você não tem permissão</h2>
          <p class="mt-1 text-sm text-slate-600">
            Acesso liberado pelo administrador.
          </p>
        </div>
      </div>
    </UCard>

    <div v-else class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <section class="space-y-6">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <div>
                <h2 class="font-semibold text-slate-950">Configuração</h2>
                <p class="text-sm text-slate-500">
                  Escopo {{ isNetworkScope ? 'da rede' : 'global' }}
                </p>
              </div>
              <UBadge :color="settings?.enabled ? 'success' : 'neutral'" variant="subtle">
                {{ settings?.enabled ? 'Ativo' : 'Desativado' }}
              </UBadge>
            </div>
          </template>

          <div v-if="loading" class="space-y-3">
            <USkeleton class="h-10 w-full" />
            <USkeleton class="h-10 w-full" />
            <USkeleton class="h-24 w-full" />
          </div>

          <div v-else-if="settings" class="space-y-5">
            <USwitch v-model="settings.enabled" label="Status geral" />

            <UFormField label="Destino">
              <UInput
                v-model="settings.webhookUrl"
                icon="i-lucide-link"
                placeholder="https://seu-dominio.com/webhooks/links"
              />
            </UFormField>

            <UFormField label="Segredo HMAC-SHA256">
              <UInput
                v-model="secretInput"
                icon="i-lucide-key-round"
                type="password"
                :placeholder="settings.hasSecret ? '•••••••• (deixe vazio para manter)' : 'Opcional — header X-Vallex-Signature'"
              />
            </UFormField>

            <UFormField label="Eventos que deseja receber">
              <div class="grid gap-2 sm:grid-cols-2">
                <UCheckbox
                  v-for="ev in availableEvents"
                  :key="ev"
                  :model-value="settings.events.includes(ev)"
                  :label="eventLabels[ev] ?? ev"
                  @update:model-value="(v: boolean) => toggleEvent(ev, v)"
                />
              </div>
            </UFormField>

            <div class="flex flex-wrap items-end gap-3">
              <UButton icon="i-lucide-save" :loading="saving" @click="save">
                Salvar configuração
              </UButton>
              <UFormField label="Evento de teste">
                <USelect v-model="testEvent" :items="testEventOptions" value-key="value" class="min-w-56" />
              </UFormField>
              <UButton
                icon="i-lucide-send"
                color="neutral"
                variant="outline"
                :loading="testing"
                @click="runTest"
              >
                Enviar teste
              </UButton>
            </div>

            <div v-if="testResult" class="rounded-lg p-3 text-xs" style="background: var(--vex-bg); border: 1px solid var(--vex-border-subtle)">
              <p class="font-bold" :style="testResult.success ? 'color: var(--vex-positive)' : 'color: var(--vex-negative)'">
                {{ testResult.success ? 'Entregue' : 'Falhou' }} · HTTP {{ testResult.httpStatus ?? '—' }} · evento {{ testResult.event }}
              </p>
              <template v-if="testResult.request">
                <p class="mt-2 font-bold" style="color: var(--vex-text-muted)">Headers enviados (inclui assinatura)</p>
                <pre class="mt-1 overflow-x-auto rounded p-2 text-[11px]" style="background: var(--vex-surface-strong); color: var(--vex-text)">{{ JSON.stringify(testResult.request.headers, null, 2) }}</pre>
                <p class="mt-2 font-bold" style="color: var(--vex-text-muted)">Corpo (assine: HMAC-SHA256 de "timestamp.corpo")</p>
                <pre class="mt-1 max-h-48 overflow-auto rounded p-2 text-[11px]" style="background: var(--vex-surface-strong); color: var(--vex-text)">{{ testResult.request.body }}</pre>
              </template>
              <p class="mt-2 font-bold" style="color: var(--vex-text-muted)">Resposta do seu endpoint</p>
              <pre class="mt-1 max-h-40 overflow-auto rounded p-2 text-[11px]" style="background: var(--vex-surface-strong); color: var(--vex-text)">{{ testResult.responseBody || testResult.error || '(sem corpo)' }}</pre>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <h2 class="font-semibold text-slate-950">Histórico de entregas</h2>
              <div class="flex flex-wrap items-center gap-2">
                <select
                  v-model="eventFilter"
                  class="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700"
                  @change="loadDeliveries(1)"
                >
                  <option value="">Todos eventos</option>
                  <option v-for="ev in availableEvents" :key="ev" :value="ev">{{ eventLabels[ev] ?? ev }}</option>
                </select>
                <select
                  v-model="statusFilter"
                  class="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700"
                  @change="loadDeliveries(1)"
                >
                  <option value="">Todos status</option>
                  <option value="SUCCESS">Entregue</option>
                  <option value="FAILED">Falhou</option>
                  <option value="PENDING">Pendente</option>
                </select>
                <UButton
                  icon="i-lucide-refresh-cw"
                  color="neutral"
                  variant="ghost"
                  :loading="deliveriesLoading"
                  @click="loadDeliveries(1)"
                />
              </div>
            </div>
          </template>

          <div class="space-y-3 md:hidden">
            <div
              v-for="item in deliveries"
              :key="item.id"
              class="rounded-lg border border-slate-200 p-3"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm font-semibold text-slate-900">{{ eventLabels[item.event] ?? item.event }}</span>
                <UBadge :color="statusColors[item.status]" variant="subtle">
                  {{ statusLabels[item.status] }}
                </UBadge>
              </div>
              <p v-if="item.requesterEmail" class="mt-2 text-sm text-slate-600">{{ item.requesterName }} · {{ item.requesterEmail }}</p>
              <p class="mt-1 text-xs text-slate-500">
                {{ formatDate(item.createdAt) }} · HTTP {{ item.httpStatus ?? '-' }} · {{ item.attempts }} tentativa(s)
              </p>
              <p v-if="item.errorMessage" class="mt-2 text-xs text-red-600">{{ item.errorMessage }}</p>
              <div class="mt-2 flex gap-3">
                <button class="text-xs text-emerald-700" @click="toggleExpand(item.id)">Ver payload</button>
                <button
                  class="text-xs text-emerald-700"
                  :disabled="redeliveringId === item.id"
                  @click="redeliver(item.id)"
                >
                  Reenviar
                </button>
              </div>
              <pre v-if="expandedId === item.id" class="mt-2 max-h-72 overflow-auto rounded bg-slate-950 p-2 text-[11px] text-slate-100">{{ prettyPayload(item.payload) }}</pre>
            </div>
          </div>

          <div class="hidden overflow-x-auto md:block">
            <table class="min-w-full text-left text-sm">
              <thead class="border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr>
                  <th class="py-2 pr-4">Evento</th>
                  <th class="py-2 pr-4">Status</th>
                  <th class="py-2 pr-4">Destino</th>
                  <th class="py-2 pr-4">HTTP</th>
                  <th class="py-2 pr-4">Tentativas</th>
                  <th class="py-2 pr-4">Data</th>
                  <th class="py-2 pr-4" />
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                <template v-for="item in deliveries" :key="item.id">
                  <tr>
                    <td class="py-3 pr-4 font-medium text-slate-900">{{ eventLabels[item.event] ?? item.event }}</td>
                    <td class="py-3 pr-4">
                      <UBadge :color="statusColors[item.status]" variant="subtle">
                        {{ statusLabels[item.status] }}
                      </UBadge>
                    </td>
                    <td class="py-3 pr-4">
                      <div class="font-medium text-slate-800">{{ item.requesterName ?? '—' }}</div>
                      <div class="text-xs text-slate-500">{{ item.requesterEmail ?? '' }}</div>
                    </td>
                    <td class="py-3 pr-4 text-slate-600">{{ item.httpStatus ?? '-' }}</td>
                    <td class="py-3 pr-4 text-slate-600">{{ item.attempts }}</td>
                    <td class="py-3 pr-4 text-slate-600">{{ formatDate(item.createdAt) }}</td>
                    <td class="py-3 pr-2 text-right">
                      <div class="flex justify-end gap-2">
                        <UButton size="xs" color="neutral" variant="ghost" icon="i-lucide-code" @click="toggleExpand(item.id)" />
                        <UButton
                                  size="xs"
                          color="neutral"
                          variant="outline"
                          icon="i-lucide-send"
                          :loading="redeliveringId === item.id"
                          @click="redeliver(item.id)"
                        >
                          Reenviar
                        </UButton>
                      </div>
                    </td>
                  </tr>
                  <tr v-if="expandedId === item.id">
                    <td colspan="7" class="pb-3">
                      <pre class="max-h-72 overflow-auto rounded bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-100">{{ prettyPayload(item.payload) }}</pre>
                      <p v-if="item.errorMessage" class="mt-1 text-xs text-red-600">{{ item.errorMessage }}</p>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>

          <div v-if="!deliveries.length && !deliveriesLoading" class="py-10 text-center text-sm text-slate-500">
            Nenhuma entrega registrada.
          </div>
        </UCard>
      </section>

      <aside class="space-y-6">
        <UCard>
          <template #header>
            <h2 class="font-semibold text-slate-950">Payload</h2>
          </template>
          <pre class="max-h-[560px] overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-relaxed text-slate-100">{{ payloadExample }}</pre>
        </UCard>
      </aside>
    </div>
  </main>
</template>

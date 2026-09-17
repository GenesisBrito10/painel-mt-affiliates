<script setup lang="ts">
definePageMeta({ layout: 'default' })

const { authHeaders } = useAuth()
const apiBase = useApiBase()
const toast = useToast()

type Overview = {
  total: number
  success: number
  failed: number
  pending: number
  successRate: number
  totalAttempts: number
  retried: number
  last24h: number
  byEvent: { event: string, count: number }[]
}
type Endpoint = {
  id: string
  ownerUserId: string | null
  ownerName: string
  ownerEmail: string | null
  scope: 'global' | 'network'
  enabled: boolean
  webhookUrl: string
  events: string[]
  updatedAt: string
  deliveries: { success: number, failed: number, pending: number }
  lastDeliveryAt: string | null
}
type Delivery = {
  id: string
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
  ownerName: string
  ownerEmail: string | null
}

const EVENTS = [
  'link_request.created',
  'link_request.approved',
  'link_request.rejected',
  'affiliate_data.synced',
  'deal.updated',
  'house.updated',
  'withdrawal.created',
  'withdrawal.status_changed',
]
const EVENT_LABELS: Record<string, string> = {
  'link_request.created': 'Pedido criado',
  'link_request.approved': 'Link aprovado',
  'link_request.rejected': 'Link rejeitado',
  'affiliate_data.synced': 'Dados sincronizados',
  'deal.updated': 'Deal alterado',
  'house.updated': 'Casa alterada',
  'withdrawal.created': 'Saque criado',
  'withdrawal.status_changed': 'Saque mudou de status',
}

const overview = ref<Overview | null>(null)
const endpoints = ref<Endpoint[]>([])
const deliveries = ref<Delivery[]>([])
const loading = ref(true)
const deliveriesLoading = ref(false)
const redeliveringId = ref<string | null>(null)
const expandedId = ref<string | null>(null)

const page = ref(1)
const total = ref(0)
const limit = 20

const filters = reactive({
  status: '',
  event: '',
  search: '',
  from: '',
  to: '',
})

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit)))

function date(v: string | null) {
  if (!v) return '—'
  return new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}
function num(v: number) {
  return new Intl.NumberFormat('pt-BR').format(v || 0)
}
function pct(v: number) {
  return `${(v * 100).toFixed(1)}%`
}
function apiError(err: unknown): string {
  const e = err as { data?: { message?: string }, message?: string }
  const m = e?.data?.message ?? e?.message ?? 'Erro inesperado'
  return Array.isArray(m) ? m.join(', ') : String(m)
}

async function loadOverview() {
  overview.value = await $fetch<Overview>(`${apiBase}/v1/admin/link-webhooks/observability/overview`, {
    headers: authHeaders(),
    query: { from: filters.from || undefined, to: filters.to || undefined },
  })
}
async function loadEndpoints() {
  endpoints.value = await $fetch<Endpoint[]>(`${apiBase}/v1/admin/link-webhooks/observability/endpoints`, {
    headers: authHeaders(),
  })
}
async function loadDeliveries(p = page.value) {
  deliveriesLoading.value = true
  try {
    const res = await $fetch<{ data: Delivery[], total: number, page: number }>(
      `${apiBase}/v1/admin/link-webhooks/observability/deliveries`,
      {
        headers: authHeaders(),
        query: {
          page: p,
          limit,
          status: filters.status || undefined,
          event: filters.event || undefined,
          search: filters.search || undefined,
          from: filters.from || undefined,
          to: filters.to || undefined,
        },
      },
    )
    deliveries.value = res.data
    total.value = res.total
    page.value = res.page
  } finally {
    deliveriesLoading.value = false
  }
}

async function applyFilters() {
  await Promise.all([loadOverview(), loadDeliveries(1)])
}

async function redeliver(id: string) {
  if (redeliveringId.value) return
  redeliveringId.value = id
  try {
    await $fetch(`${apiBase}/v1/admin/link-webhooks/deliveries/${id}/redeliver`, {
      method: 'POST',
      headers: authHeaders(),
    })
    toast.add({ title: 'Reenvio enfileirado', color: 'success', icon: 'i-lucide-send' })
    await Promise.all([loadDeliveries(), loadOverview()])
  } catch (err) {
    toast.add({ title: 'Falha ao reenviar', description: apiError(err), color: 'error', icon: 'i-lucide-alert-circle' })
  } finally {
    redeliveringId.value = null
  }
}

function toggleExpand(id: string) {
  expandedId.value = expandedId.value === id ? null : id
}
function pretty(p: unknown) {
  try { return JSON.stringify(p, null, 2) } catch { return String(p) }
}

onMounted(async () => {
  try {
    await Promise.all([loadOverview(), loadEndpoints(), loadDeliveries(1)])
  } catch (err) {
    toast.add({ title: 'Erro ao carregar webhooks', description: apiError(err), color: 'error', icon: 'i-lucide-alert-circle' })
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <main class="space-y-3.5">
    <div>
      <h1 class="text-xl font-bold">Observabilidade de Webhooks</h1>
      <p class="text-sm" style="color: var(--color-text-secondary)">
        Entregas, erros, retries e webhooks cadastrados — em toda a plataforma.
      </p>
    </div>

    <!-- KPIs -->
    <div class="grid grid-cols-2 gap-3.5 lg:grid-cols-6">
      <KpiCard label="Total" :value="num(overview?.total ?? 0)" icon="i-lucide-send" tone="purple" />
      <KpiCard label="Sucesso" :value="num(overview?.success ?? 0)" icon="i-lucide-check-circle" tone="green" />
      <KpiCard label="Falhas" :value="num(overview?.failed ?? 0)" icon="i-lucide-x-circle" tone="red" :alert="(overview?.failed ?? 0) > 0" />
      <KpiCard label="Pendentes" :value="num(overview?.pending ?? 0)" icon="i-lucide-clock" tone="amber" />
      <KpiCard label="Taxa de sucesso" :value="pct(overview?.successRate ?? 0)" icon="i-lucide-percent" tone="gold" />
      <KpiCard label="Reenviadas (retry)" :value="num(overview?.retried ?? 0)" icon="i-lucide-rotate-cw" tone="purple" :hint="`${num(overview?.totalAttempts ?? 0)} tentativas`" />
    </div>

    <!-- Webhooks cadastrados -->
    <div class="card-vex">
      <p class="mb-3 text-sm font-bold">Webhooks cadastrados ({{ endpoints.length }})</p>
      <div class="overflow-x-auto">
        <table class="tbl">
          <thead>
            <tr>
              <th>Dono</th>
              <th>Escopo</th>
              <th>Status</th>
              <th>Eventos</th>
              <th>Entregas</th>
              <th>Última</th>
              <th>URL</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in endpoints" :key="e.id">
              <td>
                <div class="font-semibold">{{ e.ownerName }}</div>
                <div class="text-xs" style="color: var(--color-text-secondary)">{{ e.ownerEmail ?? '—' }}</div>
              </td>
              <td>{{ e.scope === 'global' ? 'Global' : 'Rede' }}</td>
              <td><StatusBadge :status="e.enabled ? 'ACTIVE' : 'DISABLED'" size="xs" /></td>
              <td>
                <span class="text-xs" style="color: var(--color-text-secondary)">{{ e.events.length }} evento(s)</span>
              </td>
              <td class="whitespace-nowrap text-xs">
                <span class="text-green-400">{{ num(e.deliveries.success) }}✓</span>
                <span class="mx-1 text-red-400">{{ num(e.deliveries.failed) }}✗</span>
                <span class="text-amber-400">{{ num(e.deliveries.pending) }}⏳</span>
              </td>
              <td class="whitespace-nowrap text-xs">{{ date(e.lastDeliveryAt) }}</td>
              <td class="max-w-[220px] truncate text-xs" style="color: var(--color-text-secondary)">{{ e.webhookUrl || '—' }}</td>
            </tr>
            <tr v-if="!endpoints.length && !loading">
              <td colspan="7" class="py-6 text-center text-sm" style="color: var(--color-text-secondary)">Nenhum webhook cadastrado.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Filtros de entregas -->
    <div class="card-vex flex flex-wrap items-center gap-2.5">
      <div class="relative">
        <UIcon name="i-lucide-search" class="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2" style="color: var(--color-text-secondary)" />
        <input v-model="filters.search" class="vex-input pl-8" placeholder="Buscar dono (nome/email)" @keyup.enter="applyFilters">
      </div>
      <select v-model="filters.status" class="vex-input" @change="applyFilters">
        <option value="">Todos status</option>
        <option value="SUCCESS">Sucesso</option>
        <option value="FAILED">Falhou</option>
        <option value="PENDING">Pendente</option>
      </select>
      <select v-model="filters.event" class="vex-input" @change="applyFilters">
        <option value="">Todos eventos</option>
        <option v-for="ev in EVENTS" :key="ev" :value="ev">{{ EVENT_LABELS[ev] ?? ev }}</option>
      </select>
      <input v-model="filters.from" type="date" class="vex-input" @change="applyFilters">
      <input v-model="filters.to" type="date" class="vex-input" @change="applyFilters">
      <IconBtn icon="i-lucide-refresh-cw" title="Atualizar" @click="applyFilters" />
    </div>

    <!-- Tabela de entregas -->
    <div class="card-vex">
      <p class="mb-3 text-sm font-bold">Entregas ({{ num(total) }})</p>
      <div class="overflow-x-auto">
        <table class="tbl">
          <thead>
            <tr>
              <th>Evento</th>
              <th>Dono</th>
              <th>Status</th>
              <th>HTTP</th>
              <th>Tentativas</th>
              <th>Data</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <template v-for="d in deliveries" :key="d.id">
              <tr>
                <td>
                  <div class="font-semibold">{{ EVENT_LABELS[d.event] ?? d.event }}</div>
                  <div class="text-xs" style="color: var(--color-text-secondary)">{{ d.origin }}</div>
                </td>
                <td>
                  <div>{{ d.ownerName }}</div>
                  <div class="text-xs" style="color: var(--color-text-secondary)">{{ d.ownerEmail ?? '—' }}</div>
                </td>
                <td><StatusBadge :status="d.status" size="xs" /></td>
                <td>{{ d.httpStatus ?? '—' }}</td>
                <td>{{ d.attempts }}</td>
                <td class="whitespace-nowrap text-xs">{{ date(d.createdAt) }}</td>
                <td>
                  <div class="flex justify-end gap-1.5">
                    <IconBtn icon="i-lucide-code" title="Ver payload" @click="toggleExpand(d.id)" />
                    <IconBtn
                      v-if="d.status === 'FAILED'"
                      icon="i-lucide-send"
                      color="green"
                      title="Reenviar"
                      :disabled="redeliveringId === d.id"
                      @click="redeliver(d.id)"
                    />
                  </div>
                </td>
              </tr>
              <tr v-if="expandedId === d.id">
                <td colspan="7">
                  <p v-if="d.errorMessage" class="mb-1 text-xs text-red-400">{{ d.errorMessage }}</p>
                  <pre class="max-h-72 overflow-auto rounded-lg p-3 text-[11px] leading-relaxed" style="background: var(--color-bg); border: 1px solid var(--color-border)">{{ pretty(d.payload) }}</pre>
                </td>
              </tr>
            </template>
            <tr v-if="!deliveries.length && !deliveriesLoading">
              <td colspan="7" class="py-6 text-center text-sm" style="color: var(--color-text-secondary)">Nenhuma entrega encontrada.</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="mt-4 flex items-center justify-center gap-3 text-sm">
        <button class="vex-input px-3" :disabled="page <= 1" @click="loadDeliveries(page - 1)">«</button>
        <span>Página {{ page }} de {{ totalPages }}</span>
        <button class="vex-input px-3" :disabled="page >= totalPages" @click="loadDeliveries(page + 1)">»</button>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import type { LinkWebhookDelivery } from '~/composables/useLinkWebhooks'

definePageMeta({ layout: 'default' })

const { user } = useAuth()
const lw = useLinkWebhooks()
const toast = useToast()

const canAccess = computed(() =>
  user.value?.role === 'admin' || !!user.value?.apiAccessEnabled,
)

const loading = ref(false)
const deliveries = ref<LinkWebhookDelivery[]>([])
const total = ref(0)
const page = ref(1)
const limit = ref(20)
const limitOptions = [
  { label: '10 / página', value: 10 },
  { label: '20 / página', value: 20 },
  { label: '50 / página', value: 50 },
  { label: '100 / página', value: 100 },
]

function changeLimit() {
  page.value = 1
  load(1)
}
const expandedId = ref<string | null>(null)
const redeliveringId = ref<string | null>(null)
const selected = ref<Set<string>>(new Set())
const bulkRedelivering = ref(false)
const bulkProgress = ref({ done: 0, total: 0 })

const allSelected = computed(
  () => deliveries.value.length > 0 && deliveries.value.every(d => selected.value.has(d.id)),
)
const selectedCount = computed(() => selected.value.size)

const eventLabels = LINK_WEBHOOK_EVENT_LABELS
const eventOptions = computed(() => [
  { label: 'Todos os eventos', value: 'all' },
  ...LINK_WEBHOOK_EVENTS.map(e => ({ label: eventLabels[e] ?? e, value: e })),
])
const statusOptions = [
  { label: 'Todos os status', value: 'all' },
  { label: 'Entregue', value: 'SUCCESS' },
  { label: 'Falhou', value: 'FAILED' },
  { label: 'Pendente', value: 'PENDING' },
]

const filters = reactive({ event: 'all', status: 'all', search: '', from: '', to: '' })

const statusLabels: Record<string, string> = { SUCCESS: 'Entregue', FAILED: 'Falhou', PENDING: 'Pendente' }
const statusColors: Record<string, 'success' | 'error' | 'warning'> = { SUCCESS: 'success', FAILED: 'error', PENDING: 'warning' }

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit.value)))

function formatDate(value: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function prettyPayload(payload: unknown) {
  try { return JSON.stringify(payload, null, 2) } catch { return String(payload) }
}

function toggleExpand(id: string) {
  expandedId.value = expandedId.value === id ? null : id
}

async function load(p = page.value) {
  if (!canAccess.value) return
  loading.value = true
  try {
    const res = await lw.fetchDeliveries(p, limit.value, {
      event: filters.event !== 'all' ? filters.event : undefined,
      status: filters.status !== 'all' ? filters.status : undefined,
      search: filters.search || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
    })
    deliveries.value = res.data
    total.value = res.total
    page.value = res.page
    selected.value = new Set()
  } catch (err) {
    toast.add({ title: 'Erro ao carregar eventos', description: parseApiError(err), color: 'error', icon: 'i-lucide-alert-circle' })
  } finally {
    loading.value = false
  }
}

function applyFilters() {
  page.value = 1
  load(1)
}

function clearFilters() {
  filters.event = 'all'
  filters.status = 'all'
  filters.search = ''
  filters.from = ''
  filters.to = ''
  applyFilters()
}

function changePage(p: number) {
  if (p < 1 || p > totalPages.value) return
  load(p)
}

async function redeliver(id: string) {
  if (redeliveringId.value) return
  redeliveringId.value = id
  try {
    await lw.redeliver(id)
    toast.add({ title: 'Reenvio enfileirado', color: 'success', icon: 'i-lucide-send' })
    await load(page.value)
  } catch (err) {
    toast.add({ title: 'Falha ao reenviar', description: parseApiError(err), color: 'error', icon: 'i-lucide-alert-circle' })
  } finally {
    redeliveringId.value = null
  }
}

function toggleSelect(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function toggleSelectAll() {
  if (allSelected.value) {
    selected.value = new Set()
  } else {
    selected.value = new Set(deliveries.value.map(d => d.id))
  }
}

async function redeliverSelected() {
  if (bulkRedelivering.value || selected.value.size === 0) return
  const ids = deliveries.value.filter(d => selected.value.has(d.id)).map(d => d.id)
  bulkRedelivering.value = true
  bulkProgress.value = { done: 0, total: ids.length }
  let ok = 0
  const failures: string[] = []
  // Sequencial — evita martelar o backend/fila com muitos reenvios de uma vez.
  for (const id of ids) {
    try {
      await lw.redeliver(id)
      ok++
    } catch {
      failures.push(id)
    } finally {
      bulkProgress.value = { done: ok + failures.length, total: ids.length }
    }
  }
  if (failures.length === 0) {
    toast.add({ title: `${ok} reenvio(s) enfileirado(s)`, color: 'success', icon: 'i-lucide-send' })
  } else {
    toast.add({
      title: `${ok} reenviado(s), ${failures.length} falhou(aram)`,
      color: ok > 0 ? 'warning' : 'error',
      icon: 'i-lucide-alert-circle',
    })
  }
  bulkRedelivering.value = false
  await load(page.value)
}

onMounted(() => load(1))
</script>

<template>
  <div class="flex flex-col gap-5 p-4 sm:p-6">
    <div>
      <h1 class="text-xl font-bold">Eventos de Webhook</h1>
      <p class="mt-1 text-sm" style="color: var(--vex-text-muted)">
        Histórico das entregas de webhook para o seu endpoint — filtre, inspecione o payload/resposta e reenvie.
      </p>
    </div>

    <div v-if="!canAccess" class="vex-card p-6 text-sm" style="color: var(--vex-text-muted)">
      Você não tem permissão.
    </div>

    <template v-else>
      <!-- Filters -->
      <section class="vex-card p-4">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <UFormField label="Evento">
            <USelect v-model="filters.event" :items="eventOptions" value-key="value" />
          </UFormField>
          <UFormField label="Status">
            <USelect v-model="filters.status" :items="statusOptions" value-key="value" />
          </UFormField>
          <UFormField label="Busca">
            <UInput v-model="filters.search" placeholder="evento, origem, e-mail..." @keyup.enter="applyFilters" />
          </UFormField>
          <UFormField label="De">
            <UInput v-model="filters.from" type="date" />
          </UFormField>
          <UFormField label="Até">
            <UInput v-model="filters.to" type="date" />
          </UFormField>
        </div>
        <div class="mt-3 flex gap-2">
          <UButton icon="i-lucide-filter" label="Filtrar" color="primary" :loading="loading" @click="applyFilters" />
          <UButton icon="i-lucide-x" label="Limpar" color="neutral" variant="soft" @click="clearFilters" />
          <UButton icon="i-lucide-refresh-cw" label="Atualizar" color="neutral" variant="ghost" :loading="loading" @click="load(page)" />
        </div>
      </section>

      <!-- Deliveries -->
      <section class="vex-card p-4">
        <div v-if="loading" class="py-8 text-center text-sm" style="color: var(--vex-text-muted)">Carregando...</div>
        <div v-else-if="deliveries.length === 0" class="py-8 text-center text-sm" style="color: var(--vex-text-muted)">
          Nenhuma entrega encontrada.
        </div>
        <div v-else class="flex flex-col gap-2">
          <!-- Barra de seleção em lote -->
          <div class="flex flex-wrap items-center gap-3 rounded-lg px-3 py-2" style="border: 1px solid var(--vex-border-subtle); background: var(--vex-surface)">
            <UCheckbox
              :model-value="allSelected"
              label="Selecionar todos"
              @update:model-value="toggleSelectAll"
            />
            <span class="text-xs" style="color: var(--vex-text-muted)">{{ selectedCount }} selecionado(s)</span>
            <UButton
              class="ml-auto"
              icon="i-lucide-send"
              size="xs"
              color="primary"
              :label="bulkRedelivering
                ? `Reenviando ${bulkProgress.done}/${bulkProgress.total}...`
                : `Reenviar selecionados (${selectedCount})`"
              :disabled="selectedCount === 0 || bulkRedelivering"
              :loading="bulkRedelivering"
              @click="redeliverSelected"
            />
          </div>

          <div
            v-for="d in deliveries"
            :key="d.id"
            class="flex items-stretch rounded-lg"
            style="border: 1px solid var(--vex-border-subtle); background: var(--vex-surface-strong)"
          >
            <div class="flex flex-col">
              <label class="flex h-full items-center px-3" @click.stop>
                <UCheckbox :model-value="selected.has(d.id)" @update:model-value="toggleSelect(d.id)" />
              </label>
            </div>
            <div class="min-w-0 flex-1">
            <button type="button" class="flex w-full flex-wrap items-center gap-3 py-2 pr-3 text-left" @click="toggleExpand(d.id)">
              <UBadge :color="statusColors[d.status] ?? 'neutral'" variant="subtle" size="sm">{{ statusLabels[d.status] ?? d.status }}</UBadge>
              <code class="text-xs font-bold" style="color: var(--vex-brand)">{{ eventLabels[d.event] ?? d.event }}</code>
              <span class="text-[11px]" style="color: var(--vex-text-faint)">{{ d.origin }}</span>
              <span class="text-[11px]" style="color: var(--vex-text-muted)">HTTP {{ d.httpStatus ?? '—' }}</span>
              <span class="text-[11px]" style="color: var(--vex-text-muted)">{{ d.attempts }} tentativa(s)</span>
              <span class="ml-auto text-[11px]" style="color: var(--vex-text-faint)">{{ formatDate(d.createdAt) }}</span>
              <UIcon :name="expandedId === d.id ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" class="size-4" />
            </button>

            <div v-if="expandedId === d.id" class="border-t px-3 py-3" style="border-color: var(--vex-border-subtle)">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <p class="text-xs font-bold" style="color: var(--vex-text-muted)">Payload enviado</p>
                <UButton
                  icon="i-lucide-send"
                  size="xs"
                  color="primary"
                  variant="soft"
                  label="Reenviar"
                  title="Reenvia esta entrega (mesmo payload) ao endpoint configurado"
                  :loading="redeliveringId === d.id"
                  @click="redeliver(d.id)"
                />
              </div>
              <pre class="mt-2 max-h-72 overflow-auto rounded-lg p-3 text-[11px] leading-relaxed" style="background: var(--vex-bg); color: var(--vex-text); border: 1px solid var(--vex-border-subtle)">{{ prettyPayload(d.payload) }}</pre>

              <p class="mt-3 text-xs font-bold" style="color: var(--vex-text-muted)">Resposta do seu endpoint</p>
              <pre class="mt-2 max-h-48 overflow-auto rounded-lg p-3 text-[11px]" style="background: var(--vex-bg); color: var(--vex-text); border: 1px solid var(--vex-border-subtle)">{{ d.responseBody || d.errorMessage || '(sem corpo)' }}</pre>
            </div>
            </div>
          </div>

          <!-- Pagination -->
          <div class="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs" style="color: var(--vex-text-muted)">
            <div class="flex items-center gap-2">
              <span>{{ total }} entrega(s)</span>
              <USelect
                v-model="limit"
                :items="limitOptions"
                value-key="value"
                size="xs"
                class="w-32"
                @update:model-value="changeLimit"
              />
            </div>
            <div class="flex items-center gap-2">
              <UButton icon="i-lucide-chevron-left" size="xs" color="neutral" variant="soft" :disabled="page <= 1" @click="changePage(page - 1)" />
              <span>{{ page }} / {{ totalPages }}</span>
              <UButton icon="i-lucide-chevron-right" size="xs" color="neutral" variant="soft" :disabled="page >= totalPages" @click="changePage(page + 1)" />
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

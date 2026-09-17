<script setup lang="ts">
definePageMeta({ layout: 'default' })

interface BettingHouse {
  id: string
  name: string
  slug: string
  apiBaseURL: string
  apiBasePath: string
  apiKey: string
  logoUrl: string
  active: boolean
  syncSchedule: string
  syncMode: 'AUTO' | 'MANUAL'
  withdrawalDay: number | null
  withdrawalDayEnd: number | null
  withdrawalDay2: number | null
  withdrawalDay2End: number | null
  withdrawalWeekday: number | null
  minCpaToWithdraw: number
  minAvgDepositPerCpa: number | string
  minWithdrawalAmount: number | string | null
  withdrawalEnabled: boolean
  lastSyncAt: string | null
  createdAt: string
  updatedAt: string
  // Cutover de SYNC por casa (ledger) — 'YYYY-MM-DD' ou null.
  cutoverDate?: string | null
  // Cutover de SALDO por casa — 'YYYY-MM-DD' ou null (vazio = ano todo).
  balanceCutoverDate?: string | null
}

interface ProviderAccount {
  id: string
  name: string
  provider: string
  apiBaseUrl: string
  emailMasked: string
  active: boolean
  lastUsedAt: string | null
  lastError: string | null
  houses: Array<{ bettingHouseSlug: string, bettingHouseName: string }>
}

const { authHeaders } = useAuth()
const apiBase = useApiBase()
const toast = useToast()

const loading = ref(false)
const houses = ref<BettingHouse[]>([])
const providersLoading = ref(false)
const providers = ref<ProviderAccount[]>([])
const syncingAll = ref(false)
const syncingHouses = ref<Set<string>>(new Set())
const runningHouses = ref<Set<string>>(new Set())
let statusPollTimer: ReturnType<typeof setInterval> | null = null

interface HouseHealth {
  house: string
  active: boolean
  lastSyncAt: string | null
  lagHours: number | null
  recentDays: Array<{ date: string; rows: number }>
  missingRecentDays: string[]
  ok: boolean
}
const healthByHouse = ref<Map<string, HouseHealth>>(new Map())

async function loadHealth() {
  try {
    const res = await $fetch<{ byHouse: HouseHealth[] }>(
      `${apiBase}/admin/sync/health`,
      { headers: authHeaders() }
    )
    const m = new Map<string, HouseHealth>()
    for (const h of res.byHouse) m.set(h.house, h)
    healthByHouse.value = m
  } catch (err) {
    console.error('[Houses] health fetch failed', err)
  }
}

function healthTooltip(h: HouseHealth | undefined): string {
  if (!h) return ''
  const parts: string[] = []
  if (h.lagHours !== null) parts.push(`Lag: ${h.lagHours}h`)
  if (h.missingRecentDays.length) parts.push(`Sem dado: ${h.missingRecentDays.join(', ')}`)
  if (h.recentDays.length) {
    parts.push('Recentes: ' + h.recentDays.map(d => `${d.date}=${d.rows}`).join(' | '))
  }
  return parts.join('  •  ')
}

const showFormModal = ref(false)
const showDeleteModal = ref(false)
const editing = ref<BettingHouse | null>(null)
const deleting = ref<BettingHouse | null>(null)
const submitting = ref(false)

const form = reactive({
  name: '',
  slug: '',
  apiBaseURL: '',
  apiBasePath: '',
  apiKey: '',
  logoUrl: '',
  syncSchedule: '',
  syncMode: 'AUTO' as 'AUTO' | 'MANUAL',
  withdrawalDay: null as number | null,
  withdrawalDayEnd: null as number | null,
  withdrawalDay2: null as number | null,
  withdrawalDay2End: null as number | null,
  withdrawalWeekday: null as number | null,
  minCpaToWithdraw: 0,
  minAvgDepositPerCpa: 70,
  minWithdrawalAmount: null as number | null,
  active: true,
  withdrawalEnabled: true,
  // Cutover de SYNC: o sync puxa dados só a partir desta data. '' = sem cutover.
  cutoverDate: '' as string,
  // Cutover de SALDO: o saldo conta ganhos/saques só a partir desta data.
  // '' = sem cutover (conta o ano todo).
  balanceCutoverDate: '' as string
})

const weekdayOptions = [
  { label: '— (sem restrição semanal)', value: null },
  { label: 'Domingo', value: 0 },
  { label: 'Segunda', value: 1 },
  { label: 'Terça', value: 2 },
  { label: 'Quarta', value: 3 },
  { label: 'Quinta', value: 4 },
  { label: 'Sexta', value: 5 },
  { label: 'Sábado', value: 6 }
]

const syncModeOptions = [
  { label: 'Automático', value: 'AUTO' },
  { label: 'Manual', value: 'MANUAL' }
]

const fmtDate = (value: string | null) =>
  value ? new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—'

function resetForm() {
  form.name = ''
  form.slug = ''
  form.apiBaseURL = ''
  form.apiBasePath = ''
  form.apiKey = ''
  form.logoUrl = ''
  form.syncSchedule = ''
  form.syncMode = 'AUTO'
  form.withdrawalDay = null
  form.withdrawalDayEnd = null
  form.withdrawalDay2 = null
  form.withdrawalDay2End = null
  form.withdrawalWeekday = null
  form.minCpaToWithdraw = 0
  form.minAvgDepositPerCpa = 70
  form.minWithdrawalAmount = null
  form.active = true
  form.withdrawalEnabled = true
  form.cutoverDate = ''
  form.balanceCutoverDate = ''
}

function openCreate() {
  editing.value = null
  resetForm()
  showFormModal.value = true
}

function openEdit(house: BettingHouse) {
  editing.value = house
  form.name = house.name
  form.slug = house.slug
  form.apiBaseURL = house.apiBaseURL
  form.apiBasePath = house.apiBasePath
  form.apiKey = house.apiKey
  form.logoUrl = house.logoUrl || ''
  form.syncSchedule = house.syncSchedule
  form.syncMode = house.syncMode
  form.withdrawalDay = house.withdrawalDay
  form.withdrawalDayEnd = house.withdrawalDayEnd
  form.withdrawalDay2 = house.withdrawalDay2
  form.withdrawalDay2End = house.withdrawalDay2End
  form.withdrawalWeekday = house.withdrawalWeekday
  form.minCpaToWithdraw = house.minCpaToWithdraw ?? 0
  form.minAvgDepositPerCpa = Number(house.minAvgDepositPerCpa ?? 70)
  form.minWithdrawalAmount = house.minWithdrawalAmount != null ? Number(house.minWithdrawalAmount) : null
  form.active = house.active
  form.withdrawalEnabled = house.withdrawalEnabled ?? true
  form.cutoverDate = house.cutoverDate ?? ''
  form.balanceCutoverDate = house.balanceCutoverDate ?? ''
  showFormModal.value = true
}

function openDelete(house: BettingHouse) {
  deleting.value = house
  showDeleteModal.value = true
}

async function loadHouses() {
  loading.value = true
  try {
    const res = await $fetch<{ data: BettingHouse[] }>(`${apiBase}/admin/houses`, {
      headers: authHeaders()
    })
    houses.value = res.data
  } finally {
    loading.value = false
  }
}

async function loadProviders() {
  providersLoading.value = true
  try {
    const res = await $fetch<ProviderAccount[]>(`${apiBase}/admin/provider-accounts`, {
      headers: authHeaders()
    })
    providers.value = res
  } finally {
    providersLoading.value = false
  }
}

async function submitForm() {
  submitting.value = true
  try {
    // Sanitiza minWithdrawalAmount: vazio/NaN → null (usa mínimo global)
    const mwRaw = form.minWithdrawalAmount
    const minWithdrawalAmount = mwRaw === null || mwRaw === undefined || (typeof mwRaw === 'string' && mwRaw === '') || (typeof mwRaw === 'number' && Number.isNaN(mwRaw))
      ? null
      : Number(mwRaw)
    const body = { ...form, minWithdrawalAmount }
    if (editing.value) {
      await $fetch(`${apiBase}/admin/houses/${editing.value.id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body
      })
      toast.add({ title: 'Casa atualizada com sucesso', color: 'success' })
    } else {
      await $fetch(`${apiBase}/admin/houses`, {
        method: 'POST',
        headers: authHeaders(),
        body
      })
      toast.add({ title: 'Casa criada com sucesso', color: 'success' })
    }
    showFormModal.value = false
    await loadHouses()
  } catch (err: unknown) {
    const e = err as { data?: { detail?: string; message?: string }; message?: string }
    const msg = e.data?.detail || e.data?.message || e.message || 'Erro ao salvar casa'
    toast.add({ title: 'Erro ao salvar casa', description: msg, color: 'error' })
  } finally {
    submitting.value = false
  }
}

async function confirmDelete() {
  if (!deleting.value) return
  submitting.value = true
  try {
    await $fetch(`${apiBase}/admin/houses/${deleting.value.id}`, {
      method: 'DELETE',
      headers: authHeaders()
    })
    toast.add({ title: 'Casa removida com sucesso', color: 'success' })
    showDeleteModal.value = false
    deleting.value = null
    await loadHouses()
  } catch (err: unknown) {
    const e = err as { data?: { detail?: string; message?: string }; message?: string }
    const msg = e.data?.detail || e.data?.message || e.message || 'Erro ao remover casa'
    toast.add({ title: 'Erro ao remover casa', description: msg, color: 'error' })
  } finally {
    submitting.value = false
  }
}

async function pollStatus() {
  try {
    const res = await $fetch<{ running: string[]; idle: boolean }>(
      `${apiBase}/admin/sync/status`,
      { headers: authHeaders() }
    )
    const next = new Set(res.running)
    runningHouses.value = next
    // When sync wraps, refresh lastSyncAt + health, then stop polling
    if (res.idle) {
      stopStatusPolling()
      await Promise.all([loadHouses(), loadHealth()])
    } else {
      // Keep health fresh during long runs
      await loadHealth()
    }
  } catch (err) {
    console.error('[Houses] status poll failed', err)
  }
}

function startStatusPolling() {
  if (statusPollTimer) return
  statusPollTimer = setInterval(pollStatus, 4000)
}

function stopStatusPolling() {
  if (statusPollTimer) {
    clearInterval(statusPollTimer)
    statusPollTimer = null
  }
}

const SHEET_METRICS_HOUSES = new Set(['betnacional', 'hiperbet'])

async function triggerSheetMetricsSync(slug: string): Promise<void> {
  try {
    await $fetch<{ triggered: true }>(
      `${apiBase}/v1/admin/${slug}/sync-metrics`,
      { method: 'POST', headers: authHeaders() }
    )
  } catch (err: unknown) {
    const e = err as { data?: { detail?: string; message?: string }; message?: string }
    const msg = e.data?.detail || e.data?.message || e.message || 'Erro'
    console.warn(`[Houses] sheet metrics sync failed for ${slug}: ${msg}`)
  }
}

async function triggerSync(slug?: string) {
  if (slug) {
    if (syncingHouses.value.has(slug) || runningHouses.value.has(slug)) return
    syncingHouses.value.add(slug)
  } else {
    if (syncingAll.value) return
    syncingAll.value = true
  }
  try {
    const triggerPromise = $fetch<{ accepted: boolean; target: string; runningHouses: string[] }>(
      `${apiBase}/admin/sync/trigger`,
      {
        method: 'POST',
        headers: authHeaders(),
        body: slug ? { bettingHouseSlug: slug } : {}
      }
    )

    const sheetTargets = slug
      ? (SHEET_METRICS_HOUSES.has(slug) ? [slug] : [])
      : Array.from(SHEET_METRICS_HOUSES)

    const [res] = await Promise.all([
      triggerPromise,
      ...sheetTargets.map((s) => triggerSheetMetricsSync(s))
    ])

    runningHouses.value = new Set(res.runningHouses)
    toast.add({
      title: slug ? `Sync iniciada — ${slug}` : 'Sync iniciada para todas as casas',
      description: 'Acompanhe o progresso na coluna "Último Sync".',
      color: 'success'
    })
    loadHealth()
    startStatusPolling()
  } catch (err: unknown) {
    const e = err as { data?: { detail?: string; message?: string }; message?: string }
    const msg = e.data?.detail || e.data?.message || e.message || 'Erro ao iniciar sync'
    toast.add({ title: 'Falha ao iniciar sync', description: msg, color: 'error' })
  } finally {
    if (slug) syncingHouses.value.delete(slug)
    else syncingAll.value = false
  }
}

onMounted(() => {
  loadHouses()
  loadProviders()
  loadHealth()
  pollStatus().then(() => {
    if (runningHouses.value.size > 0) startStatusPolling()
  })
})

onBeforeUnmount(() => {
  stopStatusPolling()
})
</script>

<template>
  <div class="admin-page space-y-5">
    <!-- Header -->
    <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h1 class="text-2xl font-black text-highlighted">
          Casas de Apostas
        </h1>
        <p class="text-sm text-muted">
          Gerenciamento de casas e contas de provedor criptografadas.
        </p>
      </div>
      <div class="flex flex-col gap-2 sm:flex-row">
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="soft"
          :loading="loading"
          @click="loadHouses()"
        >
          Atualizar
        </UButton>
        <UButton
          icon="i-lucide-zap"
          color="success"
          variant="soft"
          :loading="syncingAll"
          :disabled="syncingAll || runningHouses.size > 0"
          @click="triggerSync()"
        >
          Sincronizar todas
        </UButton>
        <UButton
          icon="i-lucide-plus"
          @click="openCreate"
        >
          Nova Casa
        </UButton>
      </div>
    </div>

    <!-- Houses Table -->
    <section class="admin-section overflow-hidden">
      <!-- Desktop table -->
      <div class="table-scroll desk-only">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Slug</th>
              <th>Sync Mode</th>
              <th>Dia Saque</th>
              <th>Status</th>
              <th>Último Sync</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td
                colspan="7"
                class="text-muted"
              >
                Carregando casas...
              </td>
            </tr>
            <tr v-else-if="!houses.length">
              <td
                colspan="7"
                class="text-muted"
              >
                Nenhuma casa cadastrada.
              </td>
            </tr>
            <tr
              v-for="house in houses"
              v-else
              :key="house.id"
            >
              <td>
                <div class="flex items-center gap-3">
                  <img
                    v-if="house.logoUrl"
                    :src="house.logoUrl"
                    :alt="house.name"
                    class="rounded-md object-contain shrink-0"
                    style="width: 36px; height: 36px; background: var(--color-surface-elevated); border: 1px solid var(--color-border); padding: 4px"
                    @error="(e: Event) => { const t = e.currentTarget as HTMLImageElement; t.style.display = 'none' }"
                  >
                  <div
                    v-else
                    class="grid place-items-center rounded-md font-extrabold shrink-0"
                    :style="{ width: '36px', height: '36px', background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', fontSize: '13px' }"
                    :aria-label="`Logo da casa ${house.name}`"
                  >
                    {{ (house.name || house.slug || '??').slice(0, 2).toUpperCase() }}
                  </div>
                  <div class="min-w-0">
                    <p class="font-bold text-highlighted truncate">
                      {{ house.name }}
                    </p>
                    <p class="text-xs text-muted truncate">
                      {{ house.apiBaseURL }}
                    </p>
                  </div>
                </div>
              </td>
              <td class="font-mono text-xs">
                {{ house.slug }}
              </td>
              <td>
                <UBadge
                  :color="house.syncMode === 'AUTO' ? 'primary' : 'neutral'"
                  variant="soft"
                >
                  {{ house.syncMode === 'AUTO' ? 'Automático' : 'Manual' }}
                </UBadge>
              </td>
              <td class="text-muted">
                {{ house.withdrawalDay }}{{ house.withdrawalDayEnd ? ` - ${house.withdrawalDayEnd}` : '' }}
              </td>
              <td>
                <UBadge
                  :color="house.active ? 'success' : 'error'"
                  variant="soft"
                >
                  {{ house.active ? 'Ativo' : 'Inativo' }}
                </UBadge>
              </td>
              <td class="text-xs text-muted">
                <div class="flex flex-col gap-1">
                  <span>{{ fmtDate(house.lastSyncAt) }}</span>
                  <UBadge
                    v-if="runningHouses.has(house.slug)"
                    color="warning"
                    variant="soft"
                    size="sm"
                  >
                    <UIcon name="i-lucide-loader-2" class="size-3 animate-spin" />
                    Sincronizando
                  </UBadge>
                  <UBadge
                    v-else-if="healthByHouse.get(house.slug) && !healthByHouse.get(house.slug)!.ok"
                    color="error"
                    variant="soft"
                    size="sm"
                    :title="healthTooltip(healthByHouse.get(house.slug))"
                  >
                    <UIcon name="i-lucide-triangle-alert" class="size-3" />
                    {{ (healthByHouse.get(house.slug)!.missingRecentDays.length > 0)
                      ? `Faltam ${healthByHouse.get(house.slug)!.missingRecentDays.length}d`
                      : `Lag ${healthByHouse.get(house.slug)!.lagHours ?? '?'}h` }}
                  </UBadge>
                  <UBadge
                    v-else-if="healthByHouse.get(house.slug)?.ok"
                    color="success"
                    variant="soft"
                    size="sm"
                    :title="healthTooltip(healthByHouse.get(house.slug))"
                  >
                    <UIcon name="i-lucide-check-circle" class="size-3" />
                    OK
                  </UBadge>
                </div>
              </td>
              <td>
                <div class="flex flex-wrap gap-2">
                  <UButton
                    size="xs"
                    icon="i-lucide-zap"
                    color="success"
                    variant="soft"
                    :loading="syncingHouses.has(house.slug)"
                    :disabled="syncingHouses.has(house.slug) || runningHouses.has(house.slug)"
                    @click="triggerSync(house.slug)"
                  >
                    Sync
                  </UButton>
                  <UButton
                    size="xs"
                    icon="i-lucide-pencil"
                    color="primary"
                    variant="soft"
                    @click="openEdit(house)"
                  >
                    Editar
                  </UButton>
                  <UButton
                    size="xs"
                    icon="i-lucide-trash-2"
                    color="error"
                    variant="soft"
                    @click="openDelete(house)"
                  >
                    Excluir
                  </UButton>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Mobile card list -->
      <div class="mob-only">
        <div
          v-if="loading"
          style="text-align: center; padding: 24px; color: var(--color-text-muted); font-size: 13px"
        >
          Carregando casas...
        </div>
        <div
          v-else-if="!houses.length"
          style="text-align: center; padding: 32px; color: var(--color-text-muted); font-size: 13px"
        >
          Nenhuma casa cadastrada.
        </div>
        <div
          v-for="house in houses"
          v-else
          :key="house.id + '-mob'"
          class="mob-card"
        >
          <div class="mob-card-row mb-2">
            <div class="flex items-center gap-2.5 min-w-0">
              <img
                v-if="house.logoUrl"
                :src="house.logoUrl"
                :alt="house.name"
                class="rounded-md object-contain shrink-0"
                style="width: 32px; height: 32px; background: var(--color-surface-elevated); border: 1px solid var(--color-border); padding: 3px"
                @error="(e: Event) => { const t = e.currentTarget as HTMLImageElement; t.style.display = 'none' }"
              >
              <div
                v-else
                class="grid place-items-center rounded-md font-extrabold shrink-0"
                :style="{ width: '32px', height: '32px', background: 'var(--color-surface-elevated)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', fontSize: '12px' }"
              >
                {{ (house.name || house.slug || '??').slice(0, 2).toUpperCase() }}
              </div>
              <div class="min-w-0">
                <div style="font-weight: 700; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
                  {{ house.name }}
                </div>
                <div style="font-size: 10.5px; color: var(--color-text-muted)">
                  {{ house.slug }}
                </div>
              </div>
            </div>
            <UBadge
              :color="house.active ? 'success' : 'error'"
              variant="soft"
            >
              {{ house.active ? 'Ativo' : 'Inativo' }}
            </UBadge>
          </div>
          <div class="mob-card-row" style="font-size: 11px; color: var(--color-text-muted); margin-bottom: 6px">
            <span>{{ house.syncMode === 'AUTO' ? 'Automático' : 'Manual' }} · Dia {{ house.withdrawalDay }}{{ house.withdrawalDayEnd ? `-${house.withdrawalDayEnd}` : '' }}</span>
            <span>{{ fmtDate(house.lastSyncAt) }}</span>
          </div>
          <div
            v-if="runningHouses.has(house.slug) || healthByHouse.get(house.slug)"
            style="margin-bottom: 6px; display: flex; gap: 6px; flex-wrap: wrap"
          >
            <UBadge
              v-if="runningHouses.has(house.slug)"
              color="warning"
              variant="soft"
              size="sm"
            >
              <UIcon name="i-lucide-loader-2" class="size-3 animate-spin" />
              Sincronizando
            </UBadge>
            <UBadge
              v-else-if="healthByHouse.get(house.slug) && !healthByHouse.get(house.slug)!.ok"
              color="error"
              variant="soft"
              size="sm"
              :title="healthTooltip(healthByHouse.get(house.slug))"
            >
              <UIcon name="i-lucide-triangle-alert" class="size-3" />
              {{ (healthByHouse.get(house.slug)!.missingRecentDays.length > 0)
                ? `Faltam ${healthByHouse.get(house.slug)!.missingRecentDays.length}d`
                : `Lag ${healthByHouse.get(house.slug)!.lagHours ?? '?'}h` }}
            </UBadge>
            <UBadge
              v-else-if="healthByHouse.get(house.slug)?.ok"
              color="success"
              variant="soft"
              size="sm"
              :title="healthTooltip(healthByHouse.get(house.slug))"
            >
              <UIcon name="i-lucide-check-circle" class="size-3" />
              OK
            </UBadge>
          </div>
          <div class="mob-card-actions">
            <UButton
              size="xs"
              icon="i-lucide-zap"
              color="success"
              variant="soft"
              :loading="syncingHouses.has(house.slug)"
              :disabled="syncingHouses.has(house.slug) || runningHouses.has(house.slug)"
              @click="triggerSync(house.slug)"
            >
              Sync
            </UButton>
            <UButton
              size="xs"
              icon="i-lucide-pencil"
              color="primary"
              variant="soft"
              @click="openEdit(house)"
            >
              Editar
            </UButton>
            <UButton
              size="xs"
              icon="i-lucide-trash-2"
              color="error"
              variant="soft"
              @click="openDelete(house)"
            >
              Excluir
            </UButton>
          </div>
        </div>
      </div>
    </section>

    <!-- Provider Accounts Section -->
    <div>
      <div class="flex items-center justify-between mb-3">
        <div>
          <h2 class="text-xl font-bold text-highlighted">
            Contas de Provedor
          </h2>
          <p class="text-sm text-muted">
            Contas de API cadastradas e seus vínculos com as casas.
          </p>
        </div>
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="soft"
          size="xs"
          :loading="providersLoading"
          @click="loadProviders()"
        >
          Atualizar
        </UButton>
      </div>

      <section class="admin-section overflow-hidden">
        <div class="table-scroll">
          <table class="admin-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Provedor</th>
              <th>E-mail</th>
              <th>Status</th>
              <th>Casas Vinculadas</th>
              <th>Último Uso</th>
              <th>Último Erro</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="providersLoading">
              <td
                colspan="7"
                class="text-muted"
              >
                Carregando contas de provedor...
              </td>
            </tr>
            <tr v-else-if="!providers.length">
              <td
                colspan="7"
                class="text-muted"
              >
                Nenhuma conta de provedor encontrada.
              </td>
            </tr>
            <tr
              v-for="provider in providers"
              v-else
              :key="provider.id"
            >
              <td class="font-bold text-highlighted">
                {{ provider.name }}
              </td>
              <td class="font-mono text-xs">
                {{ provider.provider }}
              </td>
              <td class="text-xs text-muted">
                {{ provider.emailMasked }}
              </td>
              <td>
                <UBadge
                  :color="provider.active ? 'success' : 'error'"
                  variant="soft"
                >
                  {{ provider.active ? 'Ativo' : 'Inativo' }}
                </UBadge>
              </td>
              <td>
                <div class="flex flex-wrap gap-1">
                  <UBadge
                    v-for="house in provider.houses"
                    :key="house.bettingHouseSlug"
                    color="neutral"
                    variant="outline"
                  >
                    {{ house.bettingHouseName }}
                  </UBadge>
                  <span
                    v-if="!provider.houses.length"
                    class="text-muted"
                  >Sem vínculos</span>
                </div>
              </td>
              <td class="text-xs text-muted">
                {{ fmtDate(provider.lastUsedAt) }}
              </td>
              <td class="text-xs max-w-48 truncate">
                <span
                  v-if="provider.lastError"
                  class="text-error"
                >{{ provider.lastError }}</span>
                <span
                  v-else
                  class="text-muted"
                >—</span>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
      </section>
    </div>

    <!-- Create / Edit Modal -->
    <UModal
      v-model:open="showFormModal"
      :title="editing ? 'Editar Casa' : 'Nova Casa'"
    >
      <template #body>
        <div class="space-y-4">
          <div
            class="flex items-center justify-between rounded-lg border border-muted"
            style="padding: 12px 14px"
          >
            <div>
              <div style="font-size: 13px; font-weight: 700">
                Casa ativa
              </div>
              <div style="font-size: 11.5px; color: var(--color-text-muted); margin-top: 2px">
                Desativar pausa a sincronização desta casa e a esconde dos saques.
              </div>
            </div>
            <USwitch v-model="form.active" />
          </div>
          <UFormField label="Nome">
            <UInput
              v-model="form.name"
              placeholder="Ex: Betano"
            />
          </UFormField>
          <UFormField label="Slug">
            <UInput
              v-model="form.slug"
              placeholder="Ex: betano"
              :disabled="!!editing"
            />
          </UFormField>
          <UFormField label="API Base URL">
            <UInput
              v-model="form.apiBaseURL"
              placeholder="https://api.example.com"
            />
          </UFormField>
          <UFormField label="API Base Path">
            <UInput
              v-model="form.apiBasePath"
              placeholder="/v1"
            />
          </UFormField>
          <UFormField label="API Key">
            <UInput
              v-model="form.apiKey"
              type="password"
              placeholder="Chave de API"
            />
          </UFormField>
          <UFormField label="URL do Logo">
            <UInput
              v-model="form.logoUrl"
              placeholder="https://exemplo.com/logo.png"
            />
            <div
              v-if="form.logoUrl"
              class="mt-2 flex items-center gap-2"
            >
              <img
                :src="form.logoUrl"
                alt="Preview"
                class="size-8 rounded object-contain border border-muted"
              >
              <span class="text-xs text-muted">Preview</span>
            </div>
          </UFormField>
          <UFormField label="Sync Schedule (cron)">
            <UInput
              v-model="form.syncSchedule"
              placeholder="0 */6 * * *"
            />
          </UFormField>
          <UFormField label="Modo de Sincronização">
            <USelect
              v-model="form.syncMode"
              :items="syncModeOptions"
              value-key="value"
            />
          </UFormField>
          <UFormField label="Dia da Semana (cadência semanal — sobrescreve janelas mensais)">
            <USelect
              v-model="form.withdrawalWeekday"
              :items="weekdayOptions"
              value-key="value"
            />
          </UFormField>
          <div class="grid grid-cols-2 gap-4">
            <UFormField label="Janela 1 — início (dia do mês)">
              <UInput
                v-model.number="form.withdrawalDay"
                type="number"
                :min="1"
                :max="31"
                placeholder="ex: 1"
              />
            </UFormField>
            <UFormField label="Janela 1 — fim">
              <UInput
                v-model.number="form.withdrawalDayEnd"
                type="number"
                :min="1"
                :max="31"
                placeholder="ex: 2"
              />
            </UFormField>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <UFormField label="Janela 2 — início (opcional, quinzenal)">
              <UInput
                v-model.number="form.withdrawalDay2"
                type="number"
                :min="1"
                :max="31"
                placeholder="ex: 15"
              />
            </UFormField>
            <UFormField label="Janela 2 — fim">
              <UInput
                v-model.number="form.withdrawalDay2End"
                type="number"
                :min="1"
                :max="31"
                placeholder="ex: 16"
              />
            </UFormField>
          </div>
          <p class="text-xs text-gray-500">
            Cadência: dia da semana &gt; janelas mensais (1 ou 2) &gt; sem restrição (diário).
          </p>
          <UFormField label="Mínimo de CPAs qualificados para sacar">
            <UInput
              v-model.number="form.minCpaToWithdraw"
              type="number"
              :min="0"
              placeholder="0 = sem mínimo"
            />
          </UFormField>
          <p class="text-xs text-gray-500">
            Afiliado precisa ter pelo menos esse número de CPAs qualificados nessa casa para sacar. 0 = sem exigência.
          </p>
          <UFormField label="Média mínima de depósito por CPA (R$)">
            <UInput
              v-model.number="form.minAvgDepositPerCpa"
              type="number"
              :min="0"
              :step="0.01"
              placeholder="ex: 70"
            />
          </UFormField>
          <p class="text-xs text-gray-500">
            Média de depósito por CPA exigida NESTA casa para liberar saque. Network heads são isentos. 0 = sem exigência.
          </p>
          <UFormField label="Valor mínimo de saque NESTA casa (R$)">
            <UInput
              v-model.number="form.minWithdrawalAmount"
              type="number"
              :min="0"
              :step="0.01"
              placeholder="vazio = usa mínimo global"
            />
          </UFormField>
          <p class="text-xs text-gray-500">
            Saldo mínimo para sacar desta casa. Deixe vazio para usar o mínimo global (min_withdrawal_amount). Bônus ignora este campo.
          </p>
          <div
            class="flex items-center justify-between rounded-lg border border-muted"
            style="padding: 12px 14px"
          >
            <div>
              <div style="font-size: 13px; font-weight: 700">
                Saque liberado
              </div>
              <div style="font-size: 11.5px; color: var(--color-text-muted); margin-top: 2px">
                Desligado bloqueia novos saques desta casa (independe da cadência).
              </div>
            </div>
            <USwitch v-model="form.withdrawalEnabled" />
          </div>

          <!-- Cutover de sync por casa -->
          <UFormField label="Cutover de sync">
            <UInput v-model="form.cutoverDate" type="date" class="w-full" />
          </UFormField>
          <p class="text-xs text-gray-500">
            O sync/cron desta casa passa a puxar dados só a partir desta data — datas anteriores não são buscadas nem gravadas. Vazio = sem cutover (puxa o mês todo). Requer deploy do backend.
          </p>

          <!-- Cutover de saldo por casa (independente do sync) -->
          <UFormField label="Cutover de saldo">
            <UInput v-model="form.balanceCutoverDate" type="date" class="w-full" />
          </UFormField>
          <p class="text-xs text-gray-500">
            O SALDO desta casa passa a contar ganhos e saques só a partir desta data — o histórico anterior fica liquidado (não conta e não pode ser sacado de novo). Independente do cutover de sync. Vazio = sem cutover (conta o ano todo). Requer deploy do backend.
          </p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="showFormModal = false"
          >
            Cancelar
          </UButton>
          <UButton
            :loading="submitting"
            @click="submitForm"
          >
            {{ editing ? 'Salvar' : 'Criar' }}
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Delete Confirmation Modal -->
    <UModal
      v-model:open="showDeleteModal"
      title="Confirmar Exclusão"
    >
      <template #body>
        <div class="space-y-3">
          <p>
            Tem certeza que deseja excluir a casa
            <strong class="text-highlighted">{{ deleting?.name }}</strong>?
          </p>
          <p class="text-sm text-muted">
            Esta ação não pode ser desfeita. Todos os dados vinculados a esta casa serão removidos.
          </p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="showDeleteModal = false"
          >
            Cancelar
          </UButton>
          <UButton
            color="error"
            :loading="submitting"
            @click="confirmDelete"
          >
            Excluir
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>

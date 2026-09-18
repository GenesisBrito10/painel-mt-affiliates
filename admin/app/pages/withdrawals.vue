<script setup lang="ts">
definePageMeta({ layout: 'default' })

interface WithdrawalItem {
  id: string
  userId: string
  userName: string
  userEmail: string
  amount: number
  originalAmount: number
  withdrawalFee: number
  bettingHouse: string
  pixKeyType: string
  pixKey: string
  accountHolder: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
  requestNote: string
  adminNote: string
  gatewayFailureReason?: string | null
  approvedAt: string | null
  approvedByName: string | null
  createdAt: string
  gatewayId?: string | null
  gatewayStatus?: string | null
  gatewayEndToEnd?: string | null
  gatewayCompletedAt?: string | null
  hasReceipt?: boolean
  refundedAmount?: number | null
  refundState?: 'NONE' | 'PARTIAL' | 'FULL'
}

// Gateway ativo é configurável no backend (env PAYMENT_GATEWAY). ATENÇÃO ao
// modelo de taxa: Vorexy paga o `value` cheio ao destinatário (taxa cobrada à
// parte, da empresa); HeartPay DESCONTA a taxa do valor enviado (destinatário
// recebe menos). Verificar antes de trocar de gateway.

const { authHeaders } = useAuth()
const apiBase = useApiBase()
const toast = useToast()

interface StatsBucket { count: number; amount: number }
interface StatsResponse { pending: StatsBucket; approved: StatsBucket; paid: StatsBucket }

const STATE_KEY = 'admin-withdrawals-state'

const loading = ref(false)
const items = ref<WithdrawalItem[]>([])
const total = ref(0)
const page = ref(1)
const limit = ref(20)
const status = ref('PENDING')
const search = ref('')
const houseFilter = ref('') // slug; '' = todas
const startDate = ref('')
const endDate = ref('')
const panelFilter = ref('')
type ReceiptFilter = '' | 'yes' | 'no'
const receiptFilter = ref<ReceiptFilter>('')
type RefundFilter = '' | 'none' | 'any' | 'partial' | 'full'
const refundFilter = ref<RefundFilter>('')
interface PanelOption { id: string; name: string; provider: string; active: boolean }
const availablePanels = ref<PanelOption[]>([])
const stats = ref<StatsResponse>({
  pending: { count: 0, amount: 0 },
  approved: { count: 0, amount: 0 },
  paid: { count: 0, amount: 0 }
})
const statsLoading = ref(false)
const selected = ref<WithdrawalItem | null>(null)
const action = ref<'approved' | 'rejected'>('approved')
const adminNote = ref('')
const submitting = ref(false)
const showActionModal = ref(false)
const showManualPayModal = ref(false)
const manualPayNote = ref('')
const manualPaySubmitting = ref(false)
const showDetailsModal = ref(false)
const detailsTarget = ref<WithdrawalItem | null>(null)
const breakdown = ref<Record<string, unknown> | null>(null)
const breakdownLoading = ref(false)

function openDetails(item: WithdrawalItem) {
  detailsTarget.value = item
  showDetailsModal.value = true
}

const statusOptions = [
  { label: 'Pendentes', value: 'PENDING' },
  { label: 'Processando', value: 'PROCESSING' },
  { label: 'Concluídos', value: 'COMPLETED' },
  { label: 'Falhou', value: 'FAILED' },
  { label: 'Aprovados', value: 'APPROVED' },
  { label: 'Rejeitados', value: 'REJECTED' },
  { label: 'Todos', value: 'all' }
]

interface HouseOption {
  id: string
  name: string
  slug: string
  logoUrl?: string
}

const availableHouses = ref<HouseOption[]>([])

function houseName(slug: string) {
  if (!slug) return '-'
  const h = availableHouses.value.find(h => h.slug === slug || h.id === slug)
  return h ? h.name : slug
}

const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0)

function refundBadgeLabel(item: WithdrawalItem): string | null {
  if (!item.refundState || item.refundState === 'NONE') return null
  const amount = item.refundedAmount ?? 0
  return item.refundState === 'FULL'
    ? `Estornado ${money(amount)}`
    : `Estorno parcial ${money(amount)}`
}
const date = (value: string) => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

const gatewayPayload = computed(() => {
  // Enviamos exatamente o net (bruto − 6% withdrawalFee) ao gateway. Sob Vorexy
  // o destinatário recebe o net cheio (taxa do gateway é da empresa). Sob
  // HeartPay a taxa do gateway é descontada deste valor — destinatário recebe
  // menos. O modelo depende do gateway ativo (env PAYMENT_GATEWAY).
  if (!selected.value) return { net: 0, total: 0, cents: 0 }
  const original = Number(selected.value.originalAmount || 0)
  const fee = Number(selected.value.withdrawalFee || 0)
  const net = Math.max(0, original - fee)
  return { net, total: net, cents: Math.round(net * 100) }
})

function buildQuery() {
  return {
    page: page.value,
    limit: limit.value,
    status: status.value === 'all' ? undefined : status.value,
    search: search.value || undefined,
    startDate: startDate.value || undefined,
    endDate: endDate.value || undefined,
    providerAccountId: panelFilter.value || undefined,
    bettingHouse: houseFilter.value || undefined,
    hasReceipt: receiptFilter.value || undefined,
    refundState: refundFilter.value || undefined
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function saveState() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      sessionStorage.setItem(STATE_KEY, JSON.stringify({
        status: status.value,
        search: search.value,
        startDate: startDate.value,
        endDate: endDate.value,
        panelFilter: panelFilter.value,
        houseFilter: houseFilter.value,
        receiptFilter: receiptFilter.value,
        refundFilter: refundFilter.value,
        page: page.value,
        scrollY: window.scrollY
      }))
    } catch { /* sessionStorage may be unavailable */ }
  }, 80)
}

function restoreState(): number {
  try {
    const raw = sessionStorage.getItem(STATE_KEY)
    if (!raw) return 0
    const s = JSON.parse(raw) as Partial<{
      status: string; search: string; startDate: string; endDate: string;
      panelFilter: string; houseFilter: string; receiptFilter: ReceiptFilter; refundFilter: RefundFilter; page: number; scrollY: number
    }>
    if (s.status) status.value = s.status
    if (typeof s.search === 'string') search.value = s.search
    if (typeof s.startDate === 'string') startDate.value = s.startDate
    if (typeof s.endDate === 'string') endDate.value = s.endDate
    if (typeof s.panelFilter === 'string') panelFilter.value = s.panelFilter
    if (typeof s.houseFilter === 'string') houseFilter.value = s.houseFilter
    if (s.receiptFilter === 'yes' || s.receiptFilter === 'no' || s.receiptFilter === '') receiptFilter.value = s.receiptFilter
    if (['', 'none', 'any', 'partial', 'full'].includes(s.refundFilter ?? '')) refundFilter.value = (s.refundFilter ?? '') as RefundFilter
    if (typeof s.page === 'number' && s.page >= 1) page.value = s.page
    return typeof s.scrollY === 'number' ? s.scrollY : 0
  } catch { return 0 }
}

watch(status, (next) => {
  if (next !== 'COMPLETED') receiptFilter.value = ''
})

watch([status, search, startDate, endDate, panelFilter, houseFilter, receiptFilter, refundFilter], () => {
  load(1)
  fetchStats()
})

async function loadPanels() {
  try {
    const res = await $fetch<PanelOption[]>(`${apiBase}/v1/withdrawals/panels`, {
      headers: authHeaders()
    })
    availablePanels.value = res
  } catch (err) {
    console.error('[Withdrawals] panels fetch failed', err)
  }
}

async function fetchStats() {
  statsLoading.value = true
  try {
    const { page: _p, limit: _l, status: _s, ...statsQuery } = buildQuery()
    const res = await $fetch<StatsResponse>(`${apiBase}/v1/withdrawals/stats`, {
      headers: authHeaders(),
      query: statsQuery
    })
    stats.value = res
  } catch (err) {
    console.error('[Withdrawals] stats fetch failed', err)
  } finally {
    statsLoading.value = false
  }
}

async function load(nextPage = page.value) {
  loading.value = true
  page.value = nextPage
  try {
    const res = await $fetch<{ data: WithdrawalItem[], total: number }>(`${apiBase}/v1/withdrawals`, {
      headers: authHeaders(),
      query: buildQuery()
    })
    items.value = res.data
    total.value = res.total
  } finally {
    loading.value = false
    saveState()
  }
}

async function openBreakdown(item: WithdrawalItem) {
  selected.value = item
  breakdownLoading.value = true
  breakdown.value = null
  try {
    breakdown.value = await $fetch<Record<string, unknown>>(`${apiBase}/v1/withdrawals/balance-breakdown/${item.userId}`, {
      headers: authHeaders()
    })
  } finally {
    breakdownLoading.value = false
  }
}

function openManualPay(item: WithdrawalItem) {
  selected.value = item
  manualPayNote.value = ''
  showManualPayModal.value = true
}

// ─── Receipt modal (comprovante PNG base64 gerado localmente) ─────────────────────────
const showReceiptModal = ref(false)
const receiptLoading = ref(false)
const receiptError = ref<string | null>(null)
const receiptBase64 = ref<string | null>(null)
const receiptFormat = ref<string>('png')
const receiptEndToEnd = ref<string | null>(null)
const receiptTarget = ref<WithdrawalItem | null>(null)

const receiptDataUrl = computed(() =>
  receiptBase64.value ? `data:image/${receiptFormat.value};base64,${receiptBase64.value}` : null,
)

async function openReceipt(item: WithdrawalItem) {
  if (item.status !== 'COMPLETED' && item.status !== 'FAILED') return
  receiptTarget.value = item
  receiptBase64.value = null
  receiptError.value = null
  receiptEndToEnd.value = null
  showReceiptModal.value = true
  receiptLoading.value = true
  try {
    const res = await $fetch<{ format: string; base64: string; endToEndId?: string }>(
      `${apiBase}/v1/withdrawals/${item.id}/receipt`,
      { headers: authHeaders() },
    )
    receiptBase64.value = res.base64
    receiptFormat.value = res.format || 'png'
    receiptEndToEnd.value = res.endToEndId ?? null
  } catch (err: unknown) {
    const e = err as { data?: { message?: string }; message?: string }
    receiptError.value = e?.data?.message ?? e?.message ?? 'Falha ao obter comprovante.'
  } finally {
    receiptLoading.value = false
  }
}

function downloadReceipt() {
  if (!receiptDataUrl.value) return
  const a = document.createElement('a')
  a.href = receiptDataUrl.value
  a.download = `comprovante-${receiptTarget.value?.id ?? 'saque'}.${receiptFormat.value}`
  document.body.appendChild(a)
  a.click()
  a.remove()
}

async function submitManualPay() {
  if (!selected.value) return
  manualPaySubmitting.value = true
  try {
    await $fetch(`${apiBase}/v1/withdrawals/${selected.value.id}/mark-paid`, {
      method: 'POST',
      headers: authHeaders(),
      body: { adminNote: manualPayNote.value.trim() || undefined }
    })
    toast.add({ title: 'Saque marcado como pago', description: `Pagamento manual registrado para ${selected.value.userName}.`, color: 'success' })
    showManualPayModal.value = false
    await Promise.all([load(), fetchStats()])
  } catch (err: unknown) {
    const data = (err as { data?: Record<string, unknown> })?.data
    const message = (data?.['detail'] as string)
      ?? (data?.['message'] as string)
      ?? (err as { message?: string })?.message
      ?? 'Erro inesperado.'
    toast.add({ title: 'Falha ao registrar pagamento manual', description: message, color: 'error' })
  } finally {
    manualPaySubmitting.value = false
  }
}

function openAction(item: WithdrawalItem, nextAction: 'approved' | 'rejected') {
  selected.value = item
  action.value = nextAction
  adminNote.value = ''
  showActionModal.value = true
}

async function submitAction() {
  if (!selected.value) return
  submitting.value = true
  try {
    if (action.value === 'approved') {
      await $fetch(`${apiBase}/v1/withdrawals/${selected.value.id}/approve`, {
        method: 'POST',
        headers: authHeaders(),
        body: {
          confirmAmount: Number(selected.value.originalAmount),
          adminNote: adminNote.value.trim() || undefined
        }
      })
      toast.add({
        title: 'Saque enviado ao gateway',
        description: `Pagamento de ${money(gatewayPayload.value.net)} despachado via PIX.`,
        color: 'success'
      })
    } else {
      await $fetch(`${apiBase}/v1/withdrawals/${selected.value.id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: {
          status: 'rejected',
          adminNote: adminNote.value.trim() || undefined
        }
      })
      toast.add({ title: 'Saque rejeitado', color: 'error' })
    }
    showActionModal.value = false
    await Promise.all([load(), fetchStats()])
  } catch (err: unknown) {
    const data = (err as { data?: Record<string, unknown> })?.data
    const message = (data?.['detail'] as string)
      ?? (data?.['message'] as string)
      ?? (err as { message?: string })?.message
      ?? 'Erro inesperado ao processar saque.'
    toast.add({ title: 'Falha ao processar saque', description: message, color: 'error' })
  } finally {
    submitting.value = false
  }
}

function onScroll() { saveState() }

onMounted(async () => {
  const scrollY = restoreState()
  try {
    const res = await $fetch<{ data: HouseOption[] }>(`${apiBase}/v1/link-requests/houses`, { headers: authHeaders() })
    availableHouses.value = res.data || []
  } catch (err) {
    console.error('[Withdrawals] Failed to load houses', err)
  }
  await Promise.all([load(page.value), fetchStats(), loadPanels()])
  await nextTick()
  if (scrollY > 0) window.scrollTo({ top: scrollY, behavior: 'auto' })
  window.addEventListener('scroll', onScroll, { passive: true })
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  saveState()
})
</script>

<template>
  <div class="page-wrap fade-up">
    <!-- Stats summary -->
    <div class="card-vex mb-3.5 grid grid-cols-1 gap-3 p-4 sm:grid-cols-3 sm:gap-3.5">
      <div class="min-w-0">
        <span class="label-kicker">Pendentes</span>
        <div
          class="mono truncate text-lg font-extrabold leading-tight sm:text-xl"
          style="color: #FBBF24"
          :style="{ opacity: statsLoading ? 0.5 : 1 }"
        >
          {{ money(stats.pending.amount) }}
        </div>
        <div style="font-size: 11px; color: var(--color-text-muted); margin-top: 2px">
          {{ stats.pending.count }} solicitaç{{ stats.pending.count === 1 ? 'ão' : 'ões' }}
        </div>
      </div>
      <div
        class="min-w-0 border-t pt-3 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-3.5"
        style="border-color: var(--color-border)"
      >
        <span class="label-kicker">Aprovados</span>
        <div
          class="mono truncate text-lg font-extrabold leading-tight sm:text-xl"
          style="color: #A78BFA"
          :style="{ opacity: statsLoading ? 0.5 : 1 }"
        >
          {{ money(stats.approved.amount) }}
        </div>
        <div style="font-size: 11px; color: var(--color-text-muted); margin-top: 2px">
          {{ stats.approved.count }} saque{{ stats.approved.count === 1 ? '' : 's' }}
        </div>
      </div>
      <div
        class="min-w-0 border-t pt-3 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-3.5"
        style="border-color: var(--color-border)"
      >
        <span class="label-kicker">Pago</span>
        <div
          class="mono truncate text-lg font-extrabold leading-tight sm:text-xl"
          style="color: #4ADE80"
          :style="{ opacity: statsLoading ? 0.5 : 1 }"
        >
          {{ money(stats.paid.amount) }}
        </div>
        <div style="font-size: 11px; color: var(--color-text-muted); margin-top: 2px">
          {{ stats.paid.count }} concluído{{ stats.paid.count === 1 ? '' : 's' }}
        </div>
      </div>
    </div>

    <!-- Filter card -->
    <div
      class="card-vex mb-3.5 flex flex-wrap items-center gap-2.5"
      style="padding: 14px"
    >
      <div
        class="relative"
        style="flex: 1; min-width: 0"
      >
        <UIcon
          name="i-lucide-search"
          class="absolute size-3.5"
          style="left: 12px; top: 50%; transform: translateY(-50%); color: var(--color-text-muted)"
        />
        <input
          v-model="search"
          class="vex-input"
          placeholder="Buscar por afiliado..."
          style="padding-left: 36px"
        >
      </div>
      <div
        class="flex gap-1"
        style="background: var(--color-surface-2); border: 1px solid var(--color-border); padding: 3px; border-radius: 10px; overflow-x: auto; flex-shrink: 0; max-width: 100%"
      >
        <button
          v-for="opt in statusOptions"
          :key="opt.value"
          class="font-semibold transition-colors shrink-0"
          :style="{
            padding: '6px 12px',
            fontSize: '12px',
            borderRadius: '7px',
            background: status === opt.value ? 'var(--color-surface-elevated)' : 'transparent',
            color: status === opt.value ? '#fff' : 'var(--color-text-secondary)'
          }"
          @click="status = opt.value"
        >
          {{ opt.label }}
        </button>
      </div>
      <div class="flex items-center gap-1.5 flex-shrink-0">
        <input
          v-model="startDate"
          type="date"
          class="vex-input"
          style="padding: 6px 8px; font-size: 12px; height: 32px; width: 140px"
          title="Data inicial"
        >
        <span style="color: var(--color-text-muted); font-size: 11px">até</span>
        <input
          v-model="endDate"
          type="date"
          class="vex-input"
          style="padding: 6px 8px; font-size: 12px; height: 32px; width: 140px"
          title="Data final"
        >
      </div>
      <select
        v-model="panelFilter"
        class="vex-input flex-shrink-0"
        style="padding: 6px 10px; font-size: 12px; height: 32px; min-width: 170px"
        title="Filtrar por painel (conta de provedor)"
      >
        <option value="">
          Todos os painéis
        </option>
        <option value="__none__">
          Cabeças de rede
        </option>
        <option
          v-for="p in availablePanels"
          :key="p.id"
          :value="p.id"
          :disabled="!p.active"
        >
          {{ p.name }}{{ p.active ? '' : ' (inativo)' }}
        </option>
      </select>
      <select
        v-model="houseFilter"
        class="vex-input flex-shrink-0"
        style="padding: 6px 10px; font-size: 12px; height: 32px; min-width: 150px"
        title="Filtrar por casa"
      >
        <option value="">
          Todas as casas
        </option>
        <option value="bonus">
          Bônus
        </option>
        <option
          v-for="h in availableHouses"
          :key="h.slug"
          :value="h.slug"
        >
          {{ h.name }}
        </option>
      </select>
      <select
        v-if="status === 'COMPLETED'"
        v-model="receiptFilter"
        class="vex-input flex-shrink-0"
        style="padding: 6px 10px; font-size: 12px; height: 32px; min-width: 170px"
        title="Filtrar por comprovante"
      >
        <option value="">
          Todos os comprovantes
        </option>
        <option value="yes">
          Com comprovante
        </option>
        <option value="no">
          Sem comprovante
        </option>
      </select>
      <select
        v-model="refundFilter"
        class="vex-input flex-shrink-0"
        style="padding: 6px 10px; font-size: 12px; height: 32px; min-width: 160px"
        title="Filtrar por estorno"
      >
        <option value="">
          Todos (estorno)
        </option>
        <option value="none">
          Sem estorno
        </option>
        <option value="any">
          Com estorno
        </option>
        <option value="partial">
          Estorno parcial
        </option>
        <option value="full">
          Estorno total
        </option>
      </select>
      <button
        class="btn btn-ghost btn-sm"
        :disabled="loading"
        @click="load(); fetchStats()"
      >
        <UIcon
          name="i-lucide-refresh-cw"
          class="size-3.5"
        />
        Atualizar
      </button>
    </div>

    <!-- Table -->
    <div
      class="card-vex"
      style="overflow: hidden"
    >
      <!-- Desktop table (md+) -->
      <div class="table-scroll desk-only">
        <table class="tbl">
          <thead>
            <tr>
              <th>Afiliado</th>
              <th>Casa</th>
              <th>Chave PIX</th>
              <th style="text-align: right">
                Valor
              </th>
              <th>Solicitado em</th>
              <th>Aprovado por</th>
              <th>Status</th>
              <th style="text-align: right">
                Ações
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading && !items.length">
              <td
                colspan="8"
                style="text-align: center; padding: 32px; color: var(--color-text-muted)"
              >
                Carregando saques...
              </td>
            </tr>
            <tr v-else-if="!items.length">
              <td
                colspan="8"
                style="text-align: center; padding: 56px"
              >
                <div class="flex flex-col items-center gap-2">
                  <UIcon
                    name="i-lucide-wallet"
                    class="size-10"
                    style="color: var(--color-text-muted); opacity: 0.4"
                  />
                  <p style="color: var(--color-text-secondary); font-size: 13px; font-weight: 600">
                    Nenhum saque encontrado
                  </p>
                  <p style="color: var(--color-text-muted); font-size: 12px">
                    Ajuste os filtros para ver mais resultados.
                  </p>
                </div>
              </td>
            </tr>
            <tr
              v-for="item in items"
              v-else
              :key="item.id"
            >
              <td>
                <div class="flex items-center gap-2.5">
                  <Avatar
                    :name="item.userName"
                    :size="28"
                  />
                  <div>
                    <div style="font-weight: 600; font-size: 13px" class="flex items-center gap-1.5">
                      {{ item.userName }}
                      <UBadge
                        v-if="item.bettingHouse === 'bonus'"
                        color="warning"
                        variant="soft"
                        size="xs"
                      >
                        Bônus
                      </UBadge>
                    </div>
                    <div style="font-size: 11px; color: var(--color-text-muted)">
                      {{ item.userEmail }}
                    </div>
                  </div>
                </div>
              </td>
              <td>
                <span
                  v-if="item.bettingHouse === 'bonus'"
                  style="font-weight: 600; font-size: 12px; color: var(--color-warning, #d97706)"
                >Bônus</span>
                <span
                  v-else
                  style="font-weight: 600; font-size: 12px; color: var(--color-text-secondary)"
                >{{ houseName(item.bettingHouse) }}</span>
              </td>
              <td style="max-width: 200px">
                <div
                  class="mono"
                  style="font-size: 13px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px"
                  :title="item.pixKey"
                >
                  {{ item.pixKey }}
                </div>
                <div style="font-size: 10.5px; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.04em; margin-top: 2px">
                  {{ item.pixKeyType }}
                </div>
              </td>
              <td style="text-align: right">
                <div
                  class="mono"
                  style="font-size: 14px; font-weight: 800; color: var(--color-gold)"
                >
                  {{ money(item.amount) }}
                </div>
                <div style="font-size: 10.5px; color: var(--color-text-muted); margin-top: 2px">
                  Bruto {{ money(item.originalAmount || item.amount) }}
                </div>
              </td>
              <td
                class="mono"
                style="font-size: 11.5px; color: var(--color-text-muted); white-space: nowrap"
              >
                {{ date(item.createdAt) }}
              </td>
              <td style="white-space: nowrap">
                <template v-if="item.approvedAt && item.status !== 'PENDING'">
                  <div
                    style="display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; color: var(--color-text-secondary)"
                  >
                    <UIcon
                      name="i-lucide-user-check"
                      class="size-3.5"
                      :style="{ color: item.status === 'REJECTED' ? '#F87171' : '#4ADE80' }"
                    />
                    {{ item.approvedByName || '—' }}
                  </div>
                  <div
                    class="mono"
                    style="font-size: 10.5px; color: var(--color-text-muted); margin-top: 2px"
                  >
                    {{ date(item.approvedAt) }}
                  </div>
                </template>
                <span
                  v-else
                  style="color: var(--color-text-muted); font-size: 11px"
                >—</span>
              </td>
              <td>
                <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-start">
                  <StatusBadge :status="item.status" />
                  <span
                    v-if="refundBadgeLabel(item)"
                    :title="`Estorno via gateway — endToEnd PIX preservado`"
                    :style="{
                      padding: '2px 8px',
                      borderRadius: '999px',
                      fontSize: '10.5px',
                      fontWeight: 700,
                      letterSpacing: '0.02em',
                      background: item.refundState === 'FULL' ? 'rgba(248,113,113,0.12)' : 'rgba(251,146,60,0.12)',
                      color: item.refundState === 'FULL' ? '#F87171' : '#FB923C',
                      border: `1px solid ${item.refundState === 'FULL' ? 'rgba(248,113,113,0.4)' : 'rgba(251,146,60,0.4)'}`
                    }"
                  >
                    {{ refundBadgeLabel(item) }}
                  </span>
                </div>
              </td>
              <td style="text-align: right">
                <div
                  class="inline-flex"
                  style="gap: 4px"
                >
                  <IconBtn
                    title="Detalhes"
                    color="purple"
                    icon="i-lucide-eye"
                    @click="openDetails(item)"
                  />
                  <IconBtn
                    title="Saldo"
                    color="gray"
                    icon="i-lucide-pie-chart"
                    @click="openBreakdown(item)"
                  />
                  <IconBtn
                    v-if="item.status === 'PENDING'"
                    title="Aprovar"
                    color="green"
                    icon="i-lucide-check"
                    @click="openAction(item, 'approved')"
                  />
                  <IconBtn
                    v-if="item.status === 'PENDING'"
                    title="Rejeitar"
                    color="red"
                    icon="i-lucide-x"
                    @click="openAction(item, 'rejected')"
                  />
                  <IconBtn
                    v-if="['PENDING', 'APPROVED', 'PROCESSING'].includes(item.status)"
                    title="Pagar manualmente"
                    color="yellow"
                    icon="i-lucide-hand-coins"
                    @click="openManualPay(item)"
                  />
                  <IconBtn
                    v-if="item.hasReceipt"
                    title="Ver comprovante"
                    color="purple"
                    icon="i-lucide-file-text"
                    @click="openReceipt(item)"
                  />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Mobile card list -->
      <div class="mob-only">
        <div
          v-if="loading && !items.length"
          style="text-align: center; padding: 32px; color: var(--color-text-muted); font-size: 13px"
        >
          Carregando saques...
        </div>
        <div
          v-else-if="!items.length"
          class="flex flex-col items-center gap-2"
          style="padding: 40px 16px"
        >
          <UIcon
            name="i-lucide-wallet"
            class="size-10"
            style="color: var(--color-text-muted); opacity: 0.4"
          />
          <p style="color: var(--color-text-secondary); font-size: 13px; font-weight: 600">
            Nenhum saque encontrado
          </p>
        </div>
        <div
          v-for="item in items"
          v-else
          :key="item.id + '-mob'"
          class="mob-card"
        >
          <div class="mob-card-row mb-2">
            <div class="flex items-center gap-2.5 min-w-0">
              <Avatar
                :name="item.userName"
                :size="28"
              />
              <div class="min-w-0">
                <div class="flex items-center gap-1.5 min-w-0">
                  <span style="font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
                    {{ item.userName }}
                  </span>
                  <UBadge
                    v-if="item.bettingHouse === 'bonus'"
                    color="warning"
                    variant="soft"
                    size="xs"
                  >
                    Bônus
                  </UBadge>
                  <UBadge
                    v-else
                    color="neutral"
                    variant="subtle"
                    size="xs"
                  >
                    {{ houseName(item.bettingHouse) }}
                  </UBadge>
                </div>
                <div style="font-size: 11px; color: var(--color-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
                  {{ item.userEmail }}
                </div>
              </div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-end">
              <StatusBadge :status="item.status" />
              <span
                v-if="refundBadgeLabel(item)"
                :style="{
                  padding: '2px 8px',
                  borderRadius: '999px',
                  fontSize: '10px',
                  fontWeight: 700,
                  background: item.refundState === 'FULL' ? 'rgba(248,113,113,0.12)' : 'rgba(251,146,60,0.12)',
                  color: item.refundState === 'FULL' ? '#F87171' : '#FB923C',
                  border: `1px solid ${item.refundState === 'FULL' ? 'rgba(248,113,113,0.4)' : 'rgba(251,146,60,0.4)'}`
                }"
              >
                {{ refundBadgeLabel(item) }}
              </span>
            </div>
          </div>
          <div class="mob-card-row mb-1">
            <div>
              <div class="mob-card-label">Valor líquido</div>
              <div
                class="mono"
                style="font-size: 15px; font-weight: 800; color: var(--color-gold)"
              >
                {{ money(item.amount) }}
              </div>
              <div style="font-size: 10.5px; color: var(--color-text-muted)">
                Bruto {{ money(item.originalAmount || item.amount) }}
              </div>
            </div>
            <div style="text-align: right">
              <div class="mob-card-label">PIX</div>
              <div
                class="mono"
                style="font-size: 12px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 150px"
                :title="item.pixKey"
              >
                {{ item.pixKey }}
              </div>
              <div style="font-size: 10.5px; color: var(--color-text-muted); text-transform: uppercase; letter-spacing: 0.04em; margin-top: 2px">
                {{ item.pixKeyType }}
              </div>
            </div>
          </div>
          <div class="mob-card-row" style="font-size: 11px; color: var(--color-text-muted); flex-direction: column; align-items: flex-start; gap: 2px">
            <span>Solicitado: {{ date(item.createdAt) }}</span>
            <span
              v-if="item.approvedAt && item.status !== 'PENDING'"
              style="display: flex; align-items: center; gap: 4px"
            >
              <UIcon
                name="i-lucide-check-circle"
                class="size-3"
                :style="{ color: item.status === 'REJECTED' ? '#F87171' : '#4ADE80' }"
              />
              {{ item.status === 'REJECTED' ? 'Rejeitado' : 'Aprovado' }} por
              <strong style="color: var(--color-text-secondary)">{{ item.approvedByName || '—' }}</strong>
              em {{ date(item.approvedAt) }}
            </span>
          </div>
          <div class="mob-card-actions">
            <IconBtn
              title="Detalhes"
              color="purple"
              icon="i-lucide-eye"
              @click="openDetails(item)"
            />
            <IconBtn
              title="Saldo"
              color="gray"
              icon="i-lucide-pie-chart"
              @click="openBreakdown(item)"
            />
            <IconBtn
              v-if="item.status === 'PENDING'"
              title="Aprovar"
              color="green"
              icon="i-lucide-check"
              @click="openAction(item, 'approved')"
            />
            <IconBtn
              v-if="item.status === 'PENDING'"
              title="Rejeitar"
              color="red"
              icon="i-lucide-x"
              @click="openAction(item, 'rejected')"
            />
            <IconBtn
              v-if="['PENDING', 'APPROVED', 'PROCESSING'].includes(item.status)"
              title="Pagar manualmente"
              color="yellow"
              icon="i-lucide-hand-coins"
              @click="openManualPay(item)"
            />
            <IconBtn
              v-if="item.hasReceipt"
              title="Ver comprovante"
              color="purple"
              icon="i-lucide-file-text"
              @click="openReceipt(item)"
            />
          </div>
        </div>
      </div>

      <div
        class="flex items-center justify-between"
        style="padding: 14px 18px; border-top: 1px solid var(--color-border); font-size: 12px; color: var(--color-text-muted)"
      >
        <div>Mostrando {{ items.length }} de {{ total }} saques</div>
        <UPagination
          v-model:page="page"
          :total="total"
          :items-per-page="limit"
          @update:page="load($event)"
        />
      </div>
    </div>


    <UCard v-if="selected && (breakdown || breakdownLoading)">
      <template #header>
        <div class="flex items-center justify-between">
          <div>
            <h2 class="font-bold">
              Análise Financeira — {{ selected.userName }}
            </h2>
            <div
              class="flex items-center gap-1.5 mt-1"
              style="font-size: 11px; color: var(--color-text-muted)"
            >
              <UIcon name="i-lucide-layers" class="size-3" />
              Somatório all-time de todas as casas — sem filtro por casa
            </div>
          </div>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            @click="breakdown = null; selected = null"
          />
        </div>
      </template>
      <div v-if="breakdownLoading" class="text-sm text-muted py-6 text-center">
        Calculando saldo...
      </div>
      <template v-else>
        <!-- BLOCO 1: Saldo principal -->
        <div class="grid gap-3 mb-4" style="grid-template-columns: repeat(auto-fill, minmax(155px, 1fr))">
          <div class="rounded-xl p-4" style="background: rgba(250,189,0,0.08); border: 1px solid rgba(250,189,0,0.25)">
            <div class="label-kicker mb-1" style="color: var(--color-gold)">Saldo disponível</div>
            <div class="mono" style="font-size: 22px; font-weight: 900; color: var(--color-gold)">
              {{ money(Math.max(0, Number(breakdown?.balance || 0))) }}
            </div>
            <div style="font-size: 10px; color: var(--color-text-muted); margin-top: 2px">após saques e deduções</div>
          </div>
          <div class="rounded-xl p-4" style="background: var(--color-surface-2); border: 1px solid var(--color-border)">
            <div class="label-kicker mb-1">Saldo bruto</div>
            <div class="mono" style="font-size: 18px; font-weight: 800">{{ money(Number(breakdown?.grossBalance || 0)) }}</div>
            <div style="font-size: 10px; color: var(--color-text-muted); margin-top: 2px">comissões − fraudes</div>
          </div>
          <div class="rounded-xl p-4" style="background: var(--color-surface-2); border: 1px solid var(--color-border)">
            <div class="label-kicker mb-1">Total ganhos brutos</div>
            <div class="mono" style="font-size: 18px; font-weight: 800">{{ money(Number(breakdown?.baseGross || 0)) }}</div>
            <div style="font-size: 10px; color: var(--color-text-muted); margin-top: 2px">CPA + Rev + rede + bônus</div>
          </div>
          <div class="rounded-xl p-4" style="background: rgba(248,113,113,0.06); border: 1px solid rgba(248,113,113,0.2)">
            <div class="label-kicker mb-1" style="color: #F87171">Total sacado</div>
            <div class="mono" style="font-size: 18px; font-weight: 800; color: #F87171">{{ money(Number(breakdown?.approvedWithdrawals || 0)) }}</div>
            <div style="font-size: 10px; color: var(--color-text-muted); margin-top: 2px">aprovados + pendentes</div>
          </div>
        </div>

        <!-- BLOCO 2: Fontes de receita -->
        <div class="rounded-xl p-4 mb-4" style="background: var(--color-surface-2); border: 1px solid var(--color-border)">
          <div class="label-kicker mb-3">Fontes de receita (all-time)</div>
          <div class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(130px, 1fr))">
            <div>
              <div style="font-size: 11px; color: var(--color-text-muted)">CPA próprio</div>
              <div class="mono" style="font-size: 15px; font-weight: 700; margin-top: 2px">{{ money(Number(breakdown?.cpa || 0)) }}</div>
            </div>
            <div>
              <div style="font-size: 11px; color: var(--color-text-muted)">Rev-share próprio</div>
              <div class="mono" style="font-size: 15px; font-weight: 700; margin-top: 2px">{{ money(Number(breakdown?.rev || 0)) }}</div>
            </div>
            <div>
              <div style="font-size: 11px; color: var(--color-text-muted)">CPA da rede</div>
              <div class="mono" style="font-size: 15px; font-weight: 700; margin-top: 2px">{{ money(Number(breakdown?.networkCpa || 0)) }}</div>
            </div>
            <div>
              <div style="font-size: 11px; color: var(--color-text-muted)">Rev-share da rede</div>
              <div class="mono" style="font-size: 15px; font-weight: 700; margin-top: 2px">{{ money(Number(breakdown?.networkRev || 0)) }}</div>
            </div>
            <div>
              <div style="font-size: 11px; color: var(--color-text-muted)">Saldo bônus</div>
              <div class="mono" style="font-size: 15px; font-weight: 700; margin-top: 2px">{{ money(Number(breakdown?.bonusBalance || 0)) }}</div>
            </div>
            <div>
              <div style="font-size: 11px; color: var(--color-text-muted)">Total rede</div>
              <div class="mono" style="font-size: 15px; font-weight: 700; margin-top: 2px">{{ money(Number(breakdown?.networkTotal || 0)) }}</div>
            </div>
          </div>
        </div>

        <!-- BLOCO 3: Deduções -->
        <div class="rounded-xl p-4 mb-4" style="background: rgba(248,113,113,0.04); border: 1px solid rgba(248,113,113,0.15)">
          <div class="label-kicker mb-3" style="color: #F87171">Deduções e saques</div>
          <div class="grid gap-x-6 gap-y-2" style="grid-template-columns: 1fr 1fr; font-size: 12.5px">
            <div class="flex justify-between">
              <span style="color: var(--color-text-muted)">Fraudes (próprias)</span>
              <span class="mono" style="font-weight: 700; color: #F87171">−{{ money(Number(breakdown?.fraudDeduction || 0)) }}</span>
            </div>
            <div class="flex justify-between">
              <span style="color: var(--color-text-muted)">Fraudes (rede)</span>
              <span class="mono" style="font-weight: 700; color: #F87171">−{{ money(Number(breakdown?.networkFraudDeduction || 0)) }}</span>
            </div>
            <div class="flex justify-between">
              <span style="color: var(--color-text-muted)">Saques aprovados</span>
              <span class="mono" style="font-weight: 700; color: #F87171">−{{ money(Number(breakdown?.withdrawalsApproved || 0)) }}</span>
            </div>
            <div class="flex justify-between">
              <span style="color: var(--color-text-muted)">Saques pendentes</span>
              <span class="mono" style="font-weight: 700; color: #FBBF24">−{{ money(Number(breakdown?.withdrawalsPending || 0)) }}</span>
            </div>
            <div class="flex justify-between" style="grid-column: span 2; border-top: 1px solid rgba(248,113,113,0.2); padding-top: 8px; margin-top: 4px">
              <span style="font-weight: 700">Total deduzido</span>
              <span class="mono" style="font-weight: 800; color: #F87171">
                −{{ money(Number(breakdown?.totalFraudDeduction || 0) + Number(breakdown?.approvedWithdrawals || 0)) }}
              </span>
            </div>
          </div>
        </div>

        <!-- BLOCO 4: Por casa -->
        <div
          v-if="Array.isArray(breakdown?.perHouse) && (breakdown?.perHouse as any[]).length > 0"
          class="rounded-xl p-4 mb-4"
          style="background: var(--color-surface-2); border: 1px solid var(--color-border)"
        >
          <div class="label-kicker mb-3">Detalhamento por casa</div>
          <div class="table-scroll">
            <table class="tbl" style="font-size: 12px">
              <thead>
                <tr>
                  <th>Casa</th>
                  <th style="text-align:right">CPA</th>
                  <th style="text-align:right">Rev</th>
                  <th style="text-align:right">Rede CPA</th>
                  <th style="text-align:right">Rede Rev</th>
                  <th style="text-align:right">Fraudes</th>
                  <th style="text-align:right">Ganhos líquidos</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="h in (breakdown?.perHouse as any[])" :key="h.house">
                  <td>
                    <span style="font-weight:600;">{{ houseName(h.house) }}</span>
                  </td>
                  <td style="text-align:right" class="mono">{{ money(h.cpa || 0) }}</td>
                  <td style="text-align:right" class="mono">{{ money(h.rev || 0) }}</td>
                  <td style="text-align:right" class="mono">{{ money(h.networkCpa || 0) }}</td>
                  <td style="text-align:right" class="mono">{{ money(h.networkRev || 0) }}</td>
                  <td style="text-align:right; color:#F87171" class="mono">{{ money((h.fraudDeduction || 0) + (h.networkFraudDeduction || 0)) }}</td>
                  <td
                    style="text-align:right; font-weight:700"
                    class="mono"
                    :style="{ color: h.total >= 0 ? 'var(--color-gold)' : '#F87171' }"
                  >{{ money(h.total || 0) }}</td>
                </tr>
              </tbody>
              <tfoot>
                <tr style="border-top: 2px solid var(--color-border)">
                  <td style="font-weight:700">Total</td>
                  <td style="text-align:right; font-weight:700" class="mono">{{ money(Number(breakdown?.cpa || 0)) }}</td>
                  <td style="text-align:right; font-weight:700" class="mono">{{ money(Number(breakdown?.rev || 0)) }}</td>
                  <td style="text-align:right; font-weight:700" class="mono">{{ money(Number(breakdown?.networkCpa || 0)) }}</td>
                  <td style="text-align:right; font-weight:700" class="mono">{{ money(Number(breakdown?.networkRev || 0)) }}</td>
                  <td style="text-align:right; font-weight:700; color:#F87171" class="mono">{{ money(Number(breakdown?.totalFraudDeduction || 0)) }}</td>
                  <td style="text-align:right; font-weight:900; color:var(--color-gold)" class="mono">{{ money((breakdown?.perHouse as any[]).reduce((s: number, h: any) => s + (h.total || 0), 0)) }}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div style="font-size: 10.5px; color: var(--color-text-muted); margin-top: 8px; display: flex; align-items: center; gap: 4px">
            <UIcon name="i-lucide-info" class="size-3 shrink-0" />
            Ganhos líquidos = comissões menos fraudes por casa. Saques são deduzidos globalmente no bloco acima (podem ser de qualquer casa).
          </div>
        </div>

        <!-- BLOCO 5: Fraudes -->
        <div
          v-if="Array.isArray(breakdown?.fraudDetails) && (breakdown?.fraudDetails as any[]).length > 0"
          class="rounded-xl p-4 mb-4"
          style="background: rgba(248,113,113,0.04); border: 1px solid rgba(248,113,113,0.2)"
        >
          <div class="label-kicker mb-3" style="color: #F87171">Detalhamento de fraudes</div>
          <div class="grid gap-2">
            <div
              v-for="fd in (breakdown?.fraudDetails as any[])"
              :key="fd.bettingHouse + fd.source"
              class="flex items-center justify-between"
              style="font-size: 12px"
            >
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-alert-triangle" class="size-3.5" style="color:#F87171" />
                <span style="font-weight:600">{{ houseName(fd.bettingHouse) }}</span>
                <span style="color: var(--color-text-muted)">({{ fd.source === 'direct' ? 'própria' : 'rede' }})</span>
              </div>
              <div class="flex items-center gap-3">
                <span style="color: var(--color-text-muted)">{{ fd.fraudCount }} fraude{{ fd.fraudCount !== 1 ? 's' : '' }}</span>
                <span class="mono" style="font-weight:700; color:#F87171">−{{ money(fd.deduction) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- BLOCO 6: Conformidade de depósito -->
        <div
          v-if="breakdown?.depositInfo"
          class="rounded-xl p-4 mb-4"
          :style="(breakdown?.depositInfo as any)?.belowMinimum
            ? 'background: rgba(248,113,113,0.06); border: 1px solid rgba(248,113,113,0.25)'
            : 'background: rgba(52,211,153,0.06); border: 1px solid rgba(52,211,153,0.2)'"
        >
          <div
            class="label-kicker mb-3"
            :style="(breakdown?.depositInfo as any)?.belowMinimum ? 'color:#F87171' : 'color:#34D399'"
          >
            Conformidade de depósito
          </div>
          <div class="grid gap-x-6 gap-y-2" style="grid-template-columns: repeat(auto-fill, minmax(130px,1fr)); font-size: 12px">
            <div>
              <div style="color: var(--color-text-muted)">Média depósito/CPA</div>
              <div class="mono" style="font-weight:700; font-size:14px; margin-top:2px">{{ money((breakdown?.depositInfo as any)?.avgDepositPerCpa || 0) }}</div>
            </div>
            <div>
              <div style="color: var(--color-text-muted)">Mínimo exigido</div>
              <div class="mono" style="font-weight:700; font-size:14px; margin-top:2px">{{ money((breakdown?.depositInfo as any)?.minAvgDeposit || 0) }}</div>
            </div>
            <div>
              <div style="color: var(--color-text-muted)">Total depositado</div>
              <div class="mono" style="font-weight:700; font-size:14px; margin-top:2px">{{ money((breakdown?.depositInfo as any)?.totalDeposit || 0) }}</div>
            </div>
            <div>
              <div style="color: var(--color-text-muted)">CPAs qualificados</div>
              <div class="mono" style="font-weight:700; font-size:14px; margin-top:2px">{{ (breakdown?.depositInfo as any)?.totalCpaQualified || 0 }}</div>
            </div>
            <div>
              <div style="color: var(--color-text-muted)">Isento (networkHead)</div>
              <div style="font-weight:700; font-size:13px; margin-top:2px">{{ (breakdown?.depositInfo as any)?.exemptByNetworkHead ? 'Sim' : 'Não' }}</div>
            </div>
            <div>
              <div style="color: var(--color-text-muted)">Status</div>
              <div
                style="font-weight:800; font-size:13px; margin-top:2px"
                :style="(breakdown?.depositInfo as any)?.belowMinimum ? 'color:#F87171' : 'color:#34D399'"
              >{{ (breakdown?.depositInfo as any)?.belowMinimum ? '⚠ Abaixo do mínimo' : '✓ Conforme' }}</div>
            </div>
          </div>
        </div>

        <div class="rounded-xl p-4" style="background: var(--color-surface-2); border: 1px solid var(--color-border)">
          <div class="label-kicker mb-3">Resumo — este saque</div>
          <div class="space-y-2" style="font-size: 12.5px">
            <div class="flex justify-between">
              <span style="color: var(--color-text-muted)">Valor bruto solicitado</span>
              <span class="mono" style="font-weight:700">{{ money(selected?.originalAmount || 0) }}</span>
            </div>
            <div class="flex justify-between">
              <span style="color: var(--color-text-muted)">
                Taxa ({{ Math.round(Number(breakdown?.withdrawalFeeRate || 0.06) * 100) }}%)
              </span>
              <span class="mono" style="font-weight:700; color:#F87171">−{{ money(selected?.withdrawalFee || 0) }}</span>
            </div>
            <div class="flex justify-between" style="border-top: 1px solid var(--color-border); padding-top: 8px; margin-top: 4px">
              <span style="font-weight:700">Líquido a pagar ao afiliado</span>
              <span class="mono" style="font-weight:900; color:var(--color-gold); font-size:15px">{{ money(selected?.amount || 0) }}</span>
            </div>
            <div class="flex justify-between" style="padding-top: 4px">
              <span style="color: var(--color-text-muted)">Ganhos remanescentes (após este saque)</span>
              <span
                class="mono"
                style="font-weight:700"
                :style="{ color: Math.max(0, Number(breakdown?.grossBalance || 0)) - (selected?.originalAmount || 0) >= 0 ? '#34D399' : '#F87171' }"
              >
                {{ money(Math.max(0, Number(breakdown?.grossBalance || 0)) - (selected?.originalAmount || 0)) }}
              </span>
            </div>
            <div style="font-size: 10.5px; color: var(--color-text-muted); margin-top: 6px; display: flex; align-items: center; gap: 4px">
              <UIcon name="i-lucide-info" class="size-3 shrink-0" />
              Saques pendentes já estão deduzidos do saldo disponível exibido no topo.
            </div>
          </div>
        </div>
      </template>
    </UCard>

    <UModal
      v-model:open="showActionModal"
      :title="action === 'approved' ? 'Confirmar pagamento via PIX' : 'Confirmar rejeição de saque'"
    >
      <template #body>
        <div class="space-y-4">

          <!-- Affiliate info -->
          <div
            class="flex items-center gap-3 rounded-lg p-3"
            style="background: var(--color-surface-2); border: 1px solid var(--color-border)"
          >
            <Avatar
              :name="selected?.userName"
              :size="36"
            />
            <div class="min-w-0">
              <div style="font-weight: 700; font-size: 14px">
                {{ selected?.userName }}
              </div>
              <div style="font-size: 12px; color: var(--color-text-muted)">
                {{ selected?.userEmail }}
              </div>
            </div>
          </div>

          <!-- Financial breakdown -->
          <div
            class="rounded-lg p-4 space-y-3"
            style="background: var(--color-surface-2); border: 1px solid var(--color-border)"
          >
            <div class="label-kicker mb-2">
              Detalhamento financeiro
            </div>

            <!-- Bruto -->
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <UIcon
                  name="i-lucide-banknote"
                  class="size-3.5"
                  style="color: var(--color-text-muted)"
                />
                <span style="font-size: 13px; color: var(--color-text-secondary)">Valor bruto solicitado</span>
              </div>
              <span
                class="mono"
                style="font-size: 15px; font-weight: 700"
              >{{ money(selected?.originalAmount || 0) }}</span>
            </div>

            <!-- Taxa -->
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <UIcon
                  name="i-lucide-percent"
                  class="size-3.5"
                  style="color: #F87171"
                />
                <span style="font-size: 13px; color: var(--color-text-secondary)">Taxa de saque (6%)</span>
              </div>
              <span
                class="mono"
                style="font-size: 14px; font-weight: 600; color: #F87171"
              >−{{ money(selected?.withdrawalFee || 0) }}</span>
            </div>

            <!-- Divider -->
            <div style="border-top: 1px solid var(--color-border)" />

            <!-- Líquido — valor a pagar -->
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <UIcon
                  name="i-lucide-circle-dollar-sign"
                  class="size-4"
                  style="color: var(--color-gold)"
                />
                <span style="font-size: 14px; font-weight: 700; color: var(--color-text)">Valor a pagar ao afiliado</span>
              </div>
              <span
                class="mono"
                style="font-size: 18px; font-weight: 800; color: var(--color-gold)"
              >{{ money(selected?.amount || 0) }}</span>
            </div>

            <!-- Gateway breakdown — only for approval -->
            <template v-if="action === 'approved'">
              <div style="border-top: 1px dashed var(--color-border); margin-top: 8px; padding-top: 8px">
                <div class="label-kicker mb-2" style="color: var(--color-text-muted)">
                  Gateway (PIX)
                </div>
                <div class="flex items-center justify-between" style="font-size: 12px">
                  <span style="color: var(--color-text-muted)">Valor enviado ao gateway</span>
                  <span class="mono" style="color: var(--color-gold)">{{ money(gatewayPayload.net) }}</span>
                </div>
                <div style="font-size: 11px; color: var(--color-text-muted); margin-top: 4px">
                  Valor líquido (bruto − 6%) enviado ao gateway.
                </div>
              </div>
            </template>
          </div>

          <!-- PIX destination -->
          <div
            class="rounded-lg px-4 py-3"
            style="background: var(--color-surface-2); border: 1px solid var(--color-border)"
          >
            <div class="label-kicker mb-2">
              Destino do pagamento (PIX)
            </div>
            <div
              class="grid gap-x-4 gap-y-1.5"
              style="grid-template-columns: auto 1fr; font-size: 12px"
            >
              <span style="color: var(--color-text-muted)">Tipo</span>
              <span
                class="mono"
                style="font-weight: 600; text-transform: uppercase"
              >{{ selected?.pixKeyType }}</span>
              <span style="color: var(--color-text-muted)">Chave</span>
              <span
                class="mono"
                style="font-weight: 700; word-break: break-all"
              >{{ selected?.pixKey }}</span>
              <span style="color: var(--color-text-muted)">Titular</span>
              <span style="font-weight: 600; font-size: 12px">{{ selected?.accountHolder || '—' }}</span>
            </div>
          </div>

          <!-- Admin note -->
          <UFormField label="Observação visível ao afiliado (opcional)">
            <UTextarea
              v-model="adminNote"
              :rows="3"
              :maxlength="1000"
              :placeholder="action === 'approved'
                ? 'Ex: Saque aprovado. Processamento em até 24h úteis.'
                : 'Ex: Saque recusado por inconsistência nos dados cadastrais.'"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="showActionModal = false"
          >
            Cancelar
          </UButton>
          <UButton
            :color="action === 'approved' ? 'success' : 'error'"
            :loading="submitting"
            @click="submitAction"
          >
            <UIcon
              :name="action === 'approved' ? 'i-lucide-check' : 'i-lucide-x'"
              class="size-4"
            />
            {{ action === 'approved' ? `Confirmar pagamento ${money(gatewayPayload.net)}` : 'Rejeitar saque' }}
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Manual Payment Modal -->
    <UModal
      v-model:open="showManualPayModal"
      title="Pagamento manual (gateway offline)"
    >
      <template #body>
        <div class="space-y-4">
          <div
            class="rounded-lg p-3 flex items-center gap-2"
            style="background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.3)"
          >
            <UIcon name="i-lucide-triangle-alert" class="size-4 shrink-0" style="color:#FBBF24" />
            <span style="font-size: 12.5px; color: var(--color-text-secondary)">
              Use apenas quando o gateway estiver offline. O saque será marcado como <strong>CONCLUÍDO</strong> sem passar pelo gateway.
            </span>
          </div>
          <div
            class="flex items-center gap-3 rounded-lg p-3"
            style="background: var(--color-surface-2); border: 1px solid var(--color-border)"
          >
            <Avatar :name="selected?.userName" :size="36" />
            <div class="min-w-0">
              <div style="font-weight: 700; font-size: 14px">{{ selected?.userName }}</div>
              <div style="font-size: 12px; color: var(--color-text-muted)">{{ selected?.userEmail }}</div>
            </div>
            <div class="ml-auto text-right">
              <div class="mono" style="font-size: 18px; font-weight: 800; color: var(--color-gold)">{{ money(selected?.amount || 0) }}</div>
              <div style="font-size: 10.5px; color: var(--color-text-muted)">{{ selected?.pixKeyType }} · {{ selected?.pixKey }}</div>
            </div>
          </div>
          <UFormField label="Observação (opcional)">
            <UTextarea
              v-model="manualPayNote"
              :rows="3"
              :maxlength="1000"
              placeholder="Ex: Pago manualmente em 12/05/2026. Comprovante enviado via WhatsApp."
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton color="neutral" variant="ghost" @click="showManualPayModal = false">
            Cancelar
          </UButton>
          <UButton
            color="warning"
            :loading="manualPaySubmitting"
            @click="submitManualPay"
          >
            <UIcon name="i-lucide-hand-coins" class="size-4" />
            Confirmar pagamento manual
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Details Modal — full withdrawal information -->
    <UModal
      v-model:open="showDetailsModal"
      title="Detalhes do saque"
    >
      <template #body>
        <div
          v-if="detailsTarget"
          class="space-y-4"
        >
          <!-- Summary header -->
          <div
            class="flex items-start justify-between gap-3 p-4 rounded-lg"
            style="background: var(--color-surface-2); border: 1px solid var(--color-border)"
          >
            <div class="flex items-center gap-3">
              <Avatar
                :name="detailsTarget.userName"
                :size="40"
              />
              <div>
                <div style="font-weight: 700; font-size: 14px">
                  {{ detailsTarget.userName }}
                </div>
                <div style="font-size: 12px; color: var(--color-text-muted)">
                  {{ detailsTarget.userEmail }}
                </div>
              </div>
            </div>
            <StatusBadge :status="detailsTarget.status" />
          </div>

          <!-- Amounts -->
          <div
            class="grid gap-3"
            style="grid-template-columns: repeat(3, 1fr)"
          >
            <div>
              <div class="label-kicker">
                Valor solicitado
              </div>
              <div
                class="mono"
                style="font-size: 18px; font-weight: 800; margin-top: 2px"
              >
                {{ money(detailsTarget.originalAmount) }}
              </div>
            </div>
            <div>
              <div class="label-kicker">
                Taxa
              </div>
              <div
                class="mono"
                style="font-size: 16px; font-weight: 700; margin-top: 2px; color: #F87171"
              >
                -{{ money(detailsTarget.withdrawalFee) }}
              </div>
            </div>
            <div>
              <div class="label-kicker">
                Líquido
              </div>
              <div
                class="mono"
                style="font-size: 18px; font-weight: 800; margin-top: 2px; color: var(--color-gold)"
              >
                {{ money(detailsTarget.amount) }}
              </div>
            </div>
          </div>

          <!-- Identifiers + dates -->
          <div
            class="grid gap-3"
            style="grid-template-columns: 1fr 1fr"
          >
            <div>
              <div class="label-kicker">
                Request ID
              </div>
              <code
                class="mono"
                style="font-size: 11px; padding: 2px 8px; background: var(--color-surface-elevated); border-radius: 6px; color: var(--color-text-secondary); display: inline-block; margin-top: 4px"
              >{{ detailsTarget.id }}</code>
            </div>
            <div>
              <div class="label-kicker">
                Saldo
              </div>
              <div
                style="font-size: 11px; margin-top: 4px; color: var(--color-text-muted); display: flex; align-items: center; gap: 4px"
              >
                <UIcon
                  name="i-lucide-layers"
                  class="size-3"
                />
                Somatório de todas as casas
              </div>
            </div>
            <div>
              <div class="label-kicker">
                Solicitado em
              </div>
              <div
                class="mono"
                style="font-size: 12px; margin-top: 4px"
              >
                {{ date(detailsTarget.createdAt) }}
              </div>
            </div>
            <div v-if="detailsTarget.approvedAt && detailsTarget.status !== 'PENDING'">
              <div class="label-kicker">
                {{ detailsTarget.status === 'REJECTED' ? 'Rejeitado em' : 'Aprovado em' }}
              </div>
              <div
                class="mono"
                style="font-size: 12px; margin-top: 4px"
              >
                {{ date(detailsTarget.approvedAt) }}
              </div>
            </div>
            <div v-if="detailsTarget.approvedByName && detailsTarget.status !== 'PENDING'">
              <div class="label-kicker">
                Admin responsável
              </div>
              <div
                style="font-size: 12px; margin-top: 4px; font-weight: 600"
              >
                {{ detailsTarget.approvedByName }}
              </div>
            </div>
          </div>

          <!-- PIX info -->
          <div
            class="p-3 rounded-lg"
            style="background: var(--color-surface-2); border: 1px solid var(--color-border)"
          >
            <div class="label-kicker">
              Dados de pagamento (PIX)
            </div>
            <div
              class="grid gap-2 mt-2"
              style="grid-template-columns: 120px 1fr; font-size: 12px"
            >
              <div style="color: var(--color-text-muted)">
                Tipo
              </div>
              <div
                class="mono"
                style="font-weight: 600"
              >
                {{ detailsTarget.pixKeyType }}
              </div>
              <div style="color: var(--color-text-muted)">
                Chave
              </div>
              <div
                class="mono"
                style="font-weight: 600; word-break: break-all"
              >
                {{ detailsTarget.pixKey }}
              </div>
              <div style="color: var(--color-text-muted)">
                Titular
              </div>
              <div style="font-weight: 600">
                {{ detailsTarget.accountHolder }}
              </div>
            </div>
          </div>

          <!-- Notes -->
          <div
            v-if="detailsTarget.requestNote"
            class="p-3 rounded-lg"
            style="background: var(--color-surface-2); border: 1px solid var(--color-border)"
          >
            <div class="label-kicker">
              Observação do afiliado
            </div>
            <p
              style="font-size: 12.5px; margin-top: 6px; white-space: pre-line"
            >
              {{ detailsTarget.requestNote }}
            </p>
          </div>
          <div
            v-if="detailsTarget.adminNote"
            class="p-3 rounded-lg"
            style="background: rgba(124,58,237,0.08); border: 1px solid var(--color-purple-border)"
          >
            <div class="label-kicker">
              Nota do admin / motivo
            </div>
            <p
              style="font-size: 12.5px; margin-top: 6px; white-space: pre-line"
            >
              {{ detailsTarget.adminNote }}
            </p>
          </div>
          <div
            v-if="detailsTarget.gatewayFailureReason"
            class="p-3 rounded-lg"
            style="background: rgba(220,38,38,0.08); border: 1px solid rgba(220,38,38,0.35)"
          >
            <div class="label-kicker" style="color: var(--color-red-500, #dc2626)">
              Motivo da falha (gateway)
            </div>
            <p
              style="font-size: 12.5px; margin-top: 6px; white-space: pre-line"
            >
              {{ detailsTarget.gatewayFailureReason }}
            </p>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <button
            class="btn btn-ghost btn-sm"
            @click="showDetailsModal = false"
          >
            Fechar
          </button>
          <button
            v-if="detailsTarget"
            class="btn btn-ghost btn-sm"
            @click="showDetailsModal = false; openBreakdown(detailsTarget)"
          >
            <UIcon
              name="i-lucide-pie-chart"
              class="size-3.5"
            />
            Ver breakdown de saldo
          </button>
        </div>
      </template>
    </UModal>

    <!-- Receipt modal — comprovante PIX gerado localmente (MT Affiliates) -->
    <UModal
      v-model:open="showReceiptModal"
      title="Comprovante do saque"
      description="Comprovante PIX gerado pela MT Affiliates"
      :ui="{ content: 'max-w-2xl' }"
    >
      <template #body>
        <div class="space-y-3">
          <div
            v-if="receiptTarget"
            style="font-size: 12px; color: var(--color-text-muted); display: flex; gap: 12px; flex-wrap: wrap;"
          >
            <span><strong>Afiliado:</strong> {{ receiptTarget.userName }}</span>
            <span><strong>Valor:</strong> R$ {{ Number(receiptTarget.amount).toFixed(2) }}</span>
            <span><strong>Status:</strong> {{ receiptTarget.status }}</span>
          </div>
          <div
            v-if="receiptLoading"
            style="display: flex; align-items: center; justify-content: center; padding: 40px 0;"
          >
            <UIcon
              name="i-lucide-loader-circle"
              class="size-6 animate-spin"
              style="color: var(--color-primary)"
            />
          </div>
          <div
            v-else-if="receiptError"
            style="padding: 12px; font-size: 12px; color: #F87171; background: rgba(248, 113, 113, 0.1); border: 1px solid rgba(248, 113, 113, 0.3); border-radius: 8px;"
          >
            {{ receiptError }}
          </div>
          <div
            v-else-if="receiptDataUrl"
            style="display: flex; flex-direction: column; align-items: center; gap: 10px;"
          >
            <img
              :src="receiptDataUrl"
              alt="Comprovante PIX"
              style="max-width: 100%; border-radius: 8px; border: 1px solid var(--color-border); background: white;"
            />
            <p
              v-if="receiptEndToEnd"
              style="font-size: 11px; font-family: monospace; color: var(--color-text-muted)"
            >
              EndToEnd: {{ receiptEndToEnd }}
            </p>
          </div>
        </div>
      </template>
      <template #footer>
        <div style="display: flex; gap: 8px; justify-content: flex-end; width: 100%;">
          <button
            class="btn btn-ghost btn-sm"
            @click="showReceiptModal = false"
          >
            Fechar
          </button>
          <button
            class="btn btn-primary btn-sm"
            :disabled="!receiptDataUrl"
            @click="downloadReceipt"
          >
            <UIcon name="i-lucide-download" class="size-3.5" />
            Baixar PNG
          </button>
        </div>
      </template>
    </UModal>
  </div>
</template>

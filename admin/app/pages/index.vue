<script setup lang="ts">
definePageMeta({ layout: 'default' })

interface AffiliateKpis {
  total: number
  pending: number
  approved: number
  noLink: number
  cpaMonth?: number
  cpaCountMonth?: number
  withdrawalVolumeMonth?: number
  withdrawalsPendingCount?: number
  linkRequestsPendingCount?: number
}

interface WithdrawalItem {
  id: string
  userName: string
  userEmail: string
  amount: number
  originalAmount: number
  status: string
  createdAt: string
}

interface SyncLog {
  id: string
  bettingHouse: string
  status: string
  recordsProcessed?: number
  totalRecords?: number
  createdAt: string
}

interface AuditLog {
  id: string
  userName: string
  userEmail: string
  action: string
  resource: string
  method: string
  statusCode: number
  createdAt: string
}

interface ChartPoint {
  date: string
  cpa: number
  withdrawalVolume: number
}

interface PendingByHouseItem {
  slug: string
  houseName: string
  logoUrl: string | null
  pendingCount: number
}

interface CpaByHouseItem {
  slug: string
  houseName: string
  logoUrl: string | null
  cpa: number
}

const { authHeaders } = useAuth()
const apiBase = useApiBase()
const loading = ref(true)
const kpis = ref<AffiliateKpis>({
  total: 0,
  pending: 0,
  approved: 0,
  noLink: 0,
  cpaMonth: 0,
  cpaCountMonth: 0,
  withdrawalVolumeMonth: 0,
  withdrawalsPendingCount: 0,
  linkRequestsPendingCount: 0
})
const pendingWithdrawals = ref<WithdrawalItem[]>([])
const pendingLinks = ref(0)
const pendingByHouse = ref<PendingByHouseItem[]>([])
const cpaByHouse = ref<CpaByHouseItem[]>([])
const auditLogs = ref<AuditLog[]>([])
const syncLogs = ref<SyncLog[]>([])
const chartData = ref<ChartPoint[]>([])
const chartTooltip = ref<{ visible: boolean; x: number; y: number; point: ChartPoint | null }>({
  visible: false, x: 0, y: 0, point: null
})

// ─── Filtro de data personalizado (De/Até) ───
const customStart = ref('')
const customEnd = ref('')
const customOpen = ref(false)
const activeRange = ref<{ startDate: string; endDate: string } | null>(null)

// Pré-preenche os inputs ao reabrir o popover.
watch(customOpen, (open) => {
  if (open && activeRange.value) {
    customStart.value = activeRange.value.startDate
    customEnd.value = activeRange.value.endDate
  }
})

const brDate = (s: string) => s.split('-').reverse().join('/')
const rangeLabel = computed(() =>
  activeRange.value
    ? `${brDate(activeRange.value.startDate)} – ${brDate(activeRange.value.endDate)}`
    : 'Últimos 30 dias'
)
const periodWord = computed(() => (activeRange.value ? 'período' : 'mês'))
const cpaKpiLabel = computed(() => (activeRange.value ? 'CPA Geral (período)' : 'CPA Geral (mês)'))
const withdrawalKpiLabel = computed(() => (activeRange.value ? 'Volume saques (período)' : 'Volume saques (mês)'))

function applyRange() {
  if (!customStart.value || !customEnd.value) return
  let start = customStart.value
  let end = customEnd.value
  if (start > end) [start, end] = [end, start]
  activeRange.value = { startDate: start, endDate: end }
  customOpen.value = false
  load()
}

function clearRange() {
  activeRange.value = null
  customOpen.value = false
  load()
}

const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0)
const num = (value: number) => new Intl.NumberFormat('pt-BR').format(value || 0)
const dateRel = (value: string) => {
  const diffMs = Date.now() - new Date(value).getTime()
  const m = Math.floor(diffMs / 60000)
  if (m < 1) return 'agora'
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h}h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'ontem'
  return `há ${d} dias`
}

// kept for potential reuse — derived from pending list, no formula change
const _pendingVolume = computed(() =>
  pendingWithdrawals.value.reduce((sum, w) => sum + (w.originalAmount || w.amount || 0), 0)
)

// ─── Chart computation ────────────────────────────────────────────────────────
const W = 700
const H = 220
const PAD = { top: 16, right: 20, bottom: 32, left: 48 }

const chartMetrics = computed(() => {
  const pts = chartData.value
  if (!pts.length) return null

  const maxCpa = Math.max(...pts.map(p => p.cpa), 1)
  const maxVol = Math.max(...pts.map(p => p.withdrawalVolume), 1)
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  const xPos = (i: number) => PAD.left + (i / (pts.length - 1 || 1)) * innerW
  const yCpa = (v: number) => PAD.top + (1 - v / maxCpa) * innerH
  const yVol = (v: number) => PAD.top + (1 - v / maxVol) * innerH

  const cpaPath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xPos(i)},${yCpa(p.cpa)}`).join(' ')
  const volPath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xPos(i)},${yVol(p.withdrawalVolume)}`).join(' ')

  // Fill paths (close down to baseline)
  const base = PAD.top + innerH
  const cpaFill = `${cpaPath} L${xPos(pts.length - 1)},${base} L${PAD.left},${base} Z`
  const volFill = `${volPath} L${xPos(pts.length - 1)},${base} L${PAD.left},${base} Z`

  // X-axis labels: show ~6 evenly spaced dates
  const labelStep = Math.max(1, Math.floor(pts.length / 6))
  const xLabels = pts
    .filter((_, i) => i % labelStep === 0 || i === pts.length - 1)
    .map((p, _idx, arr) => {
      const origIdx = pts.indexOf(p)
      return {
        x: xPos(origIdx),
        label: new Date(p.date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
      }
    })

  // Y-axis ticks (left = CPA, valor em R$)
  const cpaTicks = [0, 0.25, 0.5, 0.75, 1].map(f => ({
    y: PAD.top + (1 - f) * innerH,
    label: Math.round(f * maxCpa).toString()
  }))

  return { cpaPath, volPath, cpaFill, volFill, xLabels, cpaTicks, pts, xPos, yCpa, yVol }
})

function onChartMouseMove(e: MouseEvent) {
  if (!chartMetrics.value) return
  const svg = (e.currentTarget as SVGElement).getBoundingClientRect()
  const mouseX = e.clientX - svg.left
  const innerW = W - PAD.left - PAD.right
  const pts = chartData.value
  const idx = Math.round(((mouseX - PAD.left) / innerW) * (pts.length - 1))
  const clamped = Math.max(0, Math.min(idx, pts.length - 1))
  const pt = pts[clamped]
  if (!pt) return
  chartTooltip.value = {
    visible: true,
    x: chartMetrics.value.xPos(clamped),
    y: chartMetrics.value.yCpa(pt.cpa),
    point: pt
  }
}

function onChartMouseLeave() {
  chartTooltip.value.visible = false
}

async function load() {
  loading.value = true
  try {
    // Single consolidated request — avoids 7 parallel HTTP calls that were
    // saturating the backend PostgreSQL connection pool and causing 500s.
    const dash = await $fetch<{
      kpis: AffiliateKpis
      withdrawals: WithdrawalItem[]
      pendingByHouse: PendingByHouseItem[]
      cpaByHouse: CpaByHouseItem[]
      auditLogs: AuditLog[]
      syncLogs: SyncLog[]
      chart: ChartPoint[]
    }>(`${apiBase}/v1/admin/dashboard`, {
      headers: authHeaders(),
      credentials: 'include',
      query: activeRange.value
        ? { startDate: activeRange.value.startDate, endDate: activeRange.value.endDate }
        : {},
    })
    kpis.value = dash.kpis
    pendingWithdrawals.value = dash.withdrawals
    pendingLinks.value = dash.kpis.linkRequestsPendingCount ?? 0
    pendingByHouse.value = dash.pendingByHouse || []
    cpaByHouse.value = dash.cpaByHouse || []
    auditLogs.value = dash.auditLogs || []
    syncLogs.value = dash.syncLogs || []
    chartData.value = dash.chart || []
  }
  finally {
    loading.value = false
  }
}

const auditDotColor = (action: string) => {
  if (action.includes('approve') || action.includes('aprovado') || action.includes('create')) return '#4ADE80'
  if (action.includes('reject') || action.includes('block') || action.includes('rejeitado')) return '#F87171'
  if (action.includes('sync') || action.includes('sistema')) return '#A78BFA'
  return 'var(--color-gold)'
}

const auditDescribe = (a: AuditLog) => {
  const verb = a.action.split('.').pop()?.replace(/_/g, ' ') || a.action
  return verb
}

onMounted(load)
</script>

<template>
  <div class="page-wrap fade-up">
    <!-- Toolbar: título + filtro de data personalizado -->
    <div class="flex items-center justify-between gap-2 flex-wrap mb-4">
      <div>
        <div style="font-size: 18px; font-weight: 800; letter-spacing: -0.02em">Visão geral</div>
        <div class="label-kicker">{{ rangeLabel }}</div>
      </div>
      <div class="flex items-center gap-2">
        <UButton
          v-if="activeRange"
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-x"
          label="Limpar"
          @click="clearRange"
        />
        <UPopover v-model:open="customOpen" :content="{ side: 'bottom', align: 'end', sideOffset: 8 }">
          <button
            class="relative group rounded-md inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-default text-highlighted ring ring-inset ring-accented focus:outline-none focus:ring-2 focus:ring-primary transition-colors"
            :class="activeRange ? 'ring-primary' : ''"
          >
            <UIcon name="i-lucide-calendar-range" class="size-4 opacity-70 shrink-0" />
            <span>{{ activeRange ? rangeLabel : 'Data' }}</span>
            <UIcon name="i-lucide-chevron-down" class="size-3 opacity-50 shrink-0" />
          </button>
          <template #content>
            <div class="p-3 min-w-[16rem] space-y-3">
              <div class="space-y-1">
                <label class="block text-[11px] font-semibold" style="color: var(--color-text-secondary)">De</label>
                <input
                  v-model="customStart"
                  type="date"
                  class="w-full px-2 py-1.5 rounded-md text-xs bg-default text-highlighted ring ring-inset ring-accented focus:outline-none focus:ring-2 focus:ring-primary"
                  style="color-scheme: dark"
                >
              </div>
              <div class="space-y-1">
                <label class="block text-[11px] font-semibold" style="color: var(--color-text-secondary)">Até</label>
                <input
                  v-model="customEnd"
                  type="date"
                  class="w-full px-2 py-1.5 rounded-md text-xs bg-default text-highlighted ring ring-inset ring-accented focus:outline-none focus:ring-2 focus:ring-primary"
                  style="color-scheme: dark"
                >
              </div>
              <UButton
                size="xs"
                color="primary"
                block
                label="Aplicar"
                :disabled="!customStart || !customEnd"
                @click="applyRange"
              />
            </div>
          </template>
        </UPopover>
      </div>
    </div>

    <!-- KPI grid (5 cards) -->
    <div
      class="grid gap-3 mb-4"
      style="grid-template-columns: repeat(auto-fit, minmax(150px, 1fr))"
    >
      <KpiCard
        label="Afiliados Ativos"
        :value="num(kpis.approved)"
        icon="i-lucide-users"
        tone="gold"
        :hint="`${num(kpis.total)} cadastrados`"
        to="/affiliates"
      />
      <KpiCard
        label="Pendentes aprovação"
        :value="num(kpis.pending)"
        icon="i-lucide-alert-triangle"
        tone="red"
        :alert="kpis.pending > 0"
        :hint="kpis.pending > 0 ? 'Ação necessária' : 'Em dia'"
        to="/affiliates"
      />
      <KpiCard
        :label="cpaKpiLabel"
        :value="money(kpis.cpaMonth || 0)"
        icon="i-lucide-dollar-sign"
        tone="green"
        :hint="`${num(kpis.cpaCountMonth || 0)} CPAs no ${periodWord}`"
      />
      <KpiCard
        :label="withdrawalKpiLabel"
        :value="money(kpis.withdrawalVolumeMonth || 0)"
        icon="i-lucide-wallet"
        tone="gold"
        :glow="true"
        :hint="`${kpis.withdrawalsPendingCount || pendingWithdrawals.length} pendentes`"
        to="/withdrawals"
      />
      <KpiCard
        label="Atividades pendentes"
        :value="num((kpis.withdrawalsPendingCount || 0) + (kpis.linkRequestsPendingCount || 0) + kpis.pending)"
        icon="i-lucide-bell-ring"
        tone="purple"
        :alert="((kpis.withdrawalsPendingCount || 0) + (kpis.linkRequestsPendingCount || 0) + kpis.pending) > 0"
        hint="Saques + links + cadastros"
      />
    </div>

    <!-- Chart + Alerts panel -->
    <div
      class="grid gap-4 mb-4 chart-alerts-grid"
    >
      <!-- Chart -->
      <section
        class="card-vex"
        style="padding: 20px"
      >
        <div class="flex items-center justify-between mb-3.5">
          <div>
            <div class="label-kicker">
              Rede global · {{ rangeLabel }}
            </div>
            <div
              class="mt-1"
              style="font-size: 18px; font-weight: 800; letter-spacing: -0.02em"
            >
              CPA e Volume de Saques
            </div>
          </div>
          <div
            class="flex gap-3.5"
            style="font-size: 11px"
          >
            <div class="flex items-center gap-1.5">
              <span
                class="inline-block rounded"
                :style="{ width: '10px', height: '2px', background: 'var(--color-gold)' }"
              />
              <span style="color: var(--color-text-secondary)">CPA</span>
            </div>
            <div class="flex items-center gap-1.5">
              <span
                class="inline-block rounded"
                :style="{ width: '10px', height: '2px', background: 'var(--color-purple)' }"
              />
              <span style="color: var(--color-text-secondary)">Volume saques</span>
            </div>
          </div>
        </div>
        <!-- SVG Chart -->
        <div
          v-if="loading && !chartData.length"
          class="skel"
          style="height: 230px; border-radius: 10px"
        />
        <div
          v-else-if="!chartData.length"
          class="flex items-center justify-center"
          style="height: 230px; border: 1px dashed var(--color-border); border-radius: 10px; color: var(--color-text-muted); font-size: 12px"
        >
          Sem dados no período ({{ rangeLabel }})
        </div>
        <div
          v-else
          style="position: relative; overflow: hidden; border-radius: 10px"
          @mouseleave="onChartMouseLeave"
        >
          <svg
            :viewBox="`0 0 ${700} ${220}`"
            preserveAspectRatio="xMidYMid meet"
            style="width: 100%; height: auto; display: block; max-height: 230px"
            @mousemove="onChartMouseMove"
          >
            <defs>
              <linearGradient id="grad-cpa" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--color-gold)" stop-opacity="0.25" />
                <stop offset="100%" stop-color="var(--color-gold)" stop-opacity="0" />
              </linearGradient>
              <linearGradient id="grad-vol" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="var(--color-purple)" stop-opacity="0.18" />
                <stop offset="100%" stop-color="var(--color-purple)" stop-opacity="0" />
              </linearGradient>
            </defs>

            <!-- Grid lines -->
            <template v-if="chartMetrics">
              <line
                v-for="tick in chartMetrics.cpaTicks"
                :key="tick.y"
                :x1="48"
                :y1="tick.y"
                :x2="680"
                :y2="tick.y"
                stroke="var(--color-border)"
                stroke-width="0.5"
                stroke-dasharray="4 4"
              />

              <!-- Y-axis labels (CPA left, R$) -->
              <text
                v-for="tick in chartMetrics.cpaTicks"
                :key="`y-${tick.y}`"
                :x="44"
                :y="tick.y + 4"
                text-anchor="end"
                font-size="9"
                fill="var(--color-text-muted)"
              >
                {{ tick.label }}
              </text>

              <!-- X-axis date labels -->
              <text
                v-for="lbl in chartMetrics.xLabels"
                :key="lbl.x"
                :x="lbl.x"
                :y="220 - 4"
                text-anchor="middle"
                font-size="9"
                fill="var(--color-text-muted)"
              >
                {{ lbl.label }}
              </text>

              <!-- Fill areas -->
              <path :d="chartMetrics.volFill" fill="url(#grad-vol)" />
              <path :d="chartMetrics.cpaFill" fill="url(#grad-cpa)" />

              <!-- Lines -->
              <path
                :d="chartMetrics.volPath"
                fill="none"
                stroke="var(--color-purple)"
                stroke-width="2"
                stroke-linejoin="round"
                stroke-linecap="round"
              />
              <path
                :d="chartMetrics.cpaPath"
                fill="none"
                stroke="var(--color-gold)"
                stroke-width="2"
                stroke-linejoin="round"
                stroke-linecap="round"
              />

              <!-- Tooltip indicator -->
              <template v-if="chartTooltip.visible && chartTooltip.point">
                <line
                  :x1="chartTooltip.x"
                  :y1="16"
                  :x2="chartTooltip.x"
                  y2="188"
                  stroke="var(--color-border)"
                  stroke-width="1"
                  stroke-dasharray="3 3"
                />
                <circle
                  :cx="chartTooltip.x"
                  :cy="chartMetrics.yCpa(chartTooltip.point.cpa)"
                  r="4"
                  fill="var(--color-gold)"
                  stroke="var(--color-surface)"
                  stroke-width="2"
                />
                <circle
                  :cx="chartTooltip.x"
                  :cy="chartMetrics.yVol(chartTooltip.point.withdrawalVolume)"
                  r="4"
                  fill="var(--color-purple)"
                  stroke="var(--color-surface)"
                  stroke-width="2"
                />
              </template>
            </template>
          </svg>

          <!-- Tooltip popup -->
          <Transition name="fade">
            <div
              v-if="chartTooltip.visible && chartTooltip.point"
              style="
                position: absolute;
                top: 12px;
                right: 12px;
                background: var(--color-surface-elevated);
                border: 1px solid var(--color-border);
                border-radius: 8px;
                padding: 8px 12px;
                font-size: 11px;
                pointer-events: none;
                min-width: 140px;
              "
            >
              <div style="color: var(--color-text-muted); margin-bottom: 4px">
                {{ new Date(chartTooltip.point.date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) }}
              </div>
              <div class="flex justify-between gap-3" style="margin-bottom: 2px">
                <span style="color: var(--color-gold)">CPA</span>
                <span class="mono" style="font-weight: 700">{{ money(chartTooltip.point.cpa) }}</span>
              </div>
              <div class="flex justify-between gap-3">
                <span style="color: var(--color-purple)">Saques</span>
                <span class="mono" style="font-weight: 700">{{ money(chartTooltip.point.withdrawalVolume) }}</span>
              </div>
            </div>
          </Transition>
        </div>
      </section>

      <!-- Alerts panel -->
      <section
        class="card-vex"
        style="padding: 20px"
      >
        <div
          class="label-kicker"
          style="margin-bottom: 12px"
        >
          Alertas de urgência
        </div>
        <NuxtLink
          v-if="pendingWithdrawals.length > 0"
          to="/withdrawals"
          class="flex items-center gap-3 p-3.5 mb-2.5 transition-colors"
          style="border: 1px solid rgba(248,113,113,0.2); background: rgba(248,113,113,0.04); border-radius: 10px; text-align: left"
        >
          <div
            class="grid place-items-center"
            style="width: 36px; height: 36px; border-radius: 10px; background: rgba(248,113,113,0.15); color: #F87171"
          >
            <UIcon
              name="i-lucide-clock"
              class="size-4"
            />
          </div>
          <div class="flex-1">
            <div style="font-size: 12.5px; font-weight: 600">
              Saques pendentes
            </div>
            <div
              style="font-size: 11px; margin-top: 2px"
              :style="{ color: 'var(--color-text-muted)' }"
            >
              Clique para revisar
            </div>
          </div>
          <span
            class="mono"
            style="font-size: 20px; font-weight: 900; color: #F87171"
          >{{ pendingWithdrawals.length }}</span>
        </NuxtLink>
        <NuxtLink
          v-if="pendingLinks > 0"
          to="/links"
          class="flex items-center gap-3 p-3.5 mb-2.5 transition-colors"
          style="border: 1px solid var(--color-gold-border); background: var(--color-gold-soft); border-radius: 10px; text-align: left"
        >
          <div
            class="grid place-items-center"
            style="width: 36px; height: 36px; border-radius: 10px; background: var(--color-gold-soft); color: var(--color-gold)"
          >
            <UIcon
              name="i-lucide-link"
              class="size-4"
            />
          </div>
          <div class="flex-1">
            <div style="font-size: 12.5px; font-weight: 600">
              Link requests sem resposta
            </div>
            <div
              style="font-size: 11px; margin-top: 2px"
              :style="{ color: 'var(--color-text-muted)' }"
            >
              Clique para revisar
            </div>
          </div>
          <span
            class="mono"
            style="font-size: 20px; font-weight: 900; color: var(--color-gold)"
          >{{ pendingLinks }}</span>
        </NuxtLink>

        <!-- Per-house pending deal request alerts -->
        <NuxtLink
          v-for="house in pendingByHouse"
          :key="house.slug"
          to="/links"
          class="flex items-center gap-3 p-3.5 mb-2.5 transition-colors"
          style="border: 1px solid var(--color-gold-border); background: var(--color-gold-soft); border-radius: 10px; text-align: left"
        >
          <div
            class="grid place-items-center flex-shrink-0 overflow-hidden"
            style="width: 36px; height: 36px; border-radius: 10px; background: var(--color-gold-soft); color: var(--color-gold)"
          >
            <img
              v-if="house.logoUrl"
              :src="house.logoUrl"
              :alt="house.houseName"
              style="width: 28px; height: 28px; object-fit: contain; border-radius: 6px"
            >
            <UIcon
              v-else
              name="i-lucide-store"
              class="size-4"
            />
          </div>
          <div class="flex-1 min-w-0">
            <div style="font-size: 12.5px; font-weight: 600; line-height: 1.3">
              Solicitações pendentes · {{ house.houseName }}
            </div>
            <div
              style="font-size: 11px; margin-top: 2px"
              :style="{ color: 'var(--color-text-muted)' }"
            >
              Clique para revisar deals
            </div>
          </div>
          <span
            class="mono flex-shrink-0"
            style="font-size: 20px; font-weight: 900; color: var(--color-gold)"
          >{{ house.pendingCount }}</span>
        </NuxtLink>

        <NuxtLink
          v-if="kpis.pending > 0"
          to="/affiliates"
          class="flex items-center gap-3 p-3.5 mb-2.5 transition-colors"
          style="border: 1px solid var(--color-gold-border); background: var(--color-gold-soft); border-radius: 10px; text-align: left"
        >
          <div
            class="grid place-items-center"
            style="width: 36px; height: 36px; border-radius: 10px; background: var(--color-gold-soft); color: var(--color-gold)"
          >
            <UIcon
              name="i-lucide-user-check"
              class="size-4"
            />
          </div>
          <div class="flex-1">
            <div style="font-size: 12.5px; font-weight: 600">
              Afiliados aguardando aprovação
            </div>
            <div
              style="font-size: 11px; margin-top: 2px"
              :style="{ color: 'var(--color-text-muted)' }"
            >
              Clique para revisar
            </div>
          </div>
          <span
            class="mono"
            style="font-size: 20px; font-weight: 900; color: var(--color-gold)"
          >{{ kpis.pending }}</span>
        </NuxtLink>
        <div
          v-if="!loading && pendingWithdrawals.length === 0 && pendingLinks === 0 && pendingByHouse.length === 0 && kpis.pending === 0"
          class="text-center py-6"
          style="color: var(--color-text-muted); font-size: 12.5px"
        >
          Nenhum alerta — operação tranquila.
        </div>
      </section>
    </div>

    <!-- CPA por casa (mês) -->
    <section
      v-if="cpaByHouse.length"
      class="card-vex mb-4"
      style="padding: 20px"
    >
      <div class="mb-3.5">
        <div class="label-kicker">
          Rede global · mês
        </div>
        <div
          class="mt-1"
          style="font-size: 18px; font-weight: 800; letter-spacing: -0.02em"
        >
          CPA por casa
        </div>
      </div>
      <div
        class="grid gap-3"
        style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr))"
      >
        <div
          v-for="house in cpaByHouse"
          :key="house.slug"
          class="flex items-center gap-3 p-3.5"
          style="border: 1px solid var(--color-border); background: var(--color-surface-elevated); border-radius: 10px"
        >
          <div
            class="grid place-items-center flex-shrink-0 overflow-hidden"
            style="width: 36px; height: 36px; border-radius: 10px; background: var(--color-gold-soft); color: var(--color-gold)"
          >
            <img
              v-if="house.logoUrl"
              :src="house.logoUrl"
              :alt="house.houseName"
              style="width: 28px; height: 28px; object-fit: contain; border-radius: 6px"
            >
            <UIcon
              v-else
              name="i-lucide-store"
              class="size-4"
            />
          </div>
          <div class="flex-1 min-w-0">
            <div
              style="font-size: 12px; line-height: 1.3"
              :style="{ color: 'var(--color-text-muted)' }"
            >
              {{ house.houseName }}
            </div>
            <div
              class="mono"
              style="font-size: 18px; font-weight: 800; color: var(--color-gold)"
            >
              {{ money(house.cpa) }}
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Recent activity -->
    <section
      class="card-vex"
      style="padding: 20px"
    >
      <div class="flex items-center justify-between mb-3">
        <div style="font-size: 16px; font-weight: 800">
          Atividade recente
        </div>
        <NuxtLink
          to="/audit"
          class="btn btn-ghost btn-sm"
        >
          Ver auditoria completa
          <UIcon
            name="i-lucide-arrow-right"
            class="size-3"
          />
        </NuxtLink>
      </div>
      <div v-if="loading && !auditLogs.length">
        <div
          v-for="i in 4"
          :key="i"
          class="skel"
          :style="{ height: '20px', marginBottom: '12px' }"
        />
      </div>
      <div
        v-else-if="!auditLogs.length"
        class="text-center py-8"
        style="color: var(--color-text-muted); font-size: 13px"
      >
        Nenhuma atividade recente.
      </div>
      <div
        v-for="(a, idx) in auditLogs"
        v-else
        :key="a.id"
        class="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3"
        :style="{
          padding: '12px 0',
          borderBottom: idx < auditLogs.length - 1 ? '1px solid var(--color-border)' : 0
        }"
      >
        <div class="flex items-center justify-between w-full sm:w-auto">
          <div class="flex items-center gap-2 sm:gap-3">
            <span
              class="dot"
              :style="{ background: auditDotColor(a.action), boxShadow: `0 0 8px ${auditDotColor(a.action)}80` }"
            />
            <code
              class="mono"
              style="font-size: 11.5px; padding: 2px 8px; background: var(--color-surface-elevated); border-radius: 6px; color: var(--color-purple)"
            >{{ auditDescribe(a) }}</code>
          </div>
          <span
            class="mob-only"
            style="font-size: 11px; color: var(--color-text-muted); white-space: nowrap"
          >
            {{ dateRel(a.createdAt) }}
          </span>
        </div>
        <span
          class="mono desk-only"
          style="color: var(--color-text-muted); font-size: 11px; width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
        >
          {{ a.userEmail }}
        </span>
        <span
          style="color: var(--color-text-secondary); font-size: 12.5px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap"
        >
          {{ a.resource }}
        </span>
        <span
          class="desk-only"
          style="font-size: 11px; color: var(--color-text-muted); white-space: nowrap"
        >
          {{ dateRel(a.createdAt) }}
        </span>
      </div>
    </section>
  </div>
</template>

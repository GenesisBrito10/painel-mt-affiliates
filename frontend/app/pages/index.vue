<script setup lang="ts">
import type { DashboardScope, DailyDataPoint } from '~/types/dashboard'
import { aggregatePinbetKpis } from '~/utils/pinbet-kpis'

definePageMeta({ layout: 'default' })

const { user } = useAuth()
const {
  balance,
  summary,
  previousSummary,
  dailyData,
  filterOptions,
  pinbetMetrics,
  pending,
  error,
  loadDashboard,
  refetchScoped,
  customRange,
} = useDashboard()

// ─── Filters ───
const ALL_HOUSES = '__all__'
const kpiViewMode = ref<DashboardScope>('all')
const presets = ['Hoje', '7 dias', '30 dias', 'Este Mês', 'Mês Passado', 'Todo o tempo']
const activePreset = ref('7 dias')
const { selectedSlug: selectedHouseSlug } = useHouseFilter()

const houseOptions = computed(() => {
  const base = [{ label: 'Todas as Casas', value: ALL_HOUSES, logoUrl: '' }]
  if (!filterOptions.value?.bettingHouses) return base
  return [
    ...base,
    ...filterOptions.value.bettingHouses.map((h) => ({
      label: h.name,
      value: h.slug,
      logoUrl: h.logoUrl || '',
    })),
  ]
})

const selectedHouseOption = computed(() =>
  houseOptions.value.find(h => h.value === selectedHouseSlug.value),
)

const hasSuperbetHouse = computed(() =>
  !!filterOptions.value?.bettingHouses?.some(h => h.slug === 'superbet'),
)

const showSuperbetInactivityNotice = computed(() =>
  user.value?.role === 'affiliate' && hasSuperbetHouse.value,
)

// ─── Initial Load ───
const initialized = ref(false)
onMounted(async () => {
  await loadDashboard(activePreset.value)
  initialized.value = true
})

const resolvedHouseSlug = computed(() =>
  selectedHouseSlug.value === ALL_HOUSES ? undefined : selectedHouseSlug.value,
)

// ─── Reactive refetch on filter changes ───
watch(
  [activePreset, selectedHouseSlug, kpiViewMode],
  ([preset, _house, scope]) => {
    if (!initialized.value) return
    refetchScoped(preset, resolvedHouseSlug.value, scope)
  },
)

// ─── Custom date range ("Personalizado") ───
const customStart = ref('')
const customEnd = ref('')
const customOpen = ref(false)

// Se já houver um intervalo salvo, pré-preenche os inputs ao abrir.
watch(customOpen, (open) => {
  if (open && customRange.value) {
    customStart.value = customRange.value.startDate
    customEnd.value = customRange.value.endDate
  }
})

function applyCustomRange() {
  if (!customStart.value || !customEnd.value) return
  // Garante início <= fim (troca se o usuário inverter).
  let start = customStart.value
  let end = customEnd.value
  if (start > end) [start, end] = [end, start]

  customRange.value = { startDate: start, endDate: end }
  customOpen.value = false

  if (activePreset.value === 'Personalizado') {
    // Preset não muda → o watcher não dispara; refaz a busca manualmente.
    refetchScoped('Personalizado', resolvedHouseSlug.value, kpiViewMode.value)
  } else {
    activePreset.value = 'Personalizado'
  }
}

// Rótulo do chip: mostra o intervalo quando for personalizado.
const activePresetLabel = computed(() => {
  if (activePreset.value === 'Personalizado' && customRange.value) {
    const br = (s: string) => s.split('-').reverse().join('/')
    return `${br(customRange.value.startDate)} – ${br(customRange.value.endDate)}`
  }
  return activePreset.value
})

// ─── Formatters ───
const formatNumber = (val: number) =>
  new Intl.NumberFormat('pt-BR').format(val)

const formatCurrency = (val: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(val)

function formatDateOnly(date: string) {
  const [year, month, day] = date.split('-')
  if (!year || !month || !day) return date
  return `${day}/${month}/${year}`
}

// ─── Balance computed ───
// Quando há filtro de casa, deriva TUDO de perHouse[slug] — que é totalmente
// escopado por casa no backend. Os campos globais (balance, totalFraudDeduction,
// bonusBalance, balanceAdjustment) NÃO são escopados por casa, então usá-los sob
// filtro mostraria o saldo total. Bônus/ajuste/saques são globais (não atrelados
// a uma casa) e por isso ficam ocultos quando uma casa específica está filtrada.
const isHouseFiltered = computed(() => !!resolvedHouseSlug.value)
const activeHouse = computed(() =>
  resolvedHouseSlug.value
    ? balance.value?.perHouse.find((h) => h.house === resolvedHouseSlug.value) ?? null
    : null,
)
const directEarnings = computed(() => {
  if (activeHouse.value) return activeHouse.value.cpa + activeHouse.value.rev
  return balance.value ? balance.value.cpa + balance.value.rev : 0
})
const networkEarnings = computed(() => {
  if (activeHouse.value) return activeHouse.value.networkCpa + activeHouse.value.networkRev
  return balance.value?.networkTotal ?? 0
})
// Bônus é global (não atrelado a casa) → oculto sob filtro de casa.
// Bônus DISPONÍVEL (concedido − saques de bônus), não o concedido cheio.
const bonusBalance = computed(() => balance.value?.bonusAvailable ?? 0)
const hasBonus = computed(() => !isHouseFiltered.value && bonusBalance.value > 0)
// Ajuste manual agora é POR CASA: sob filtro mostra o da casa; sem filtro, a soma.
const balanceAdjustment = computed(() =>
  activeHouse.value ? activeHouse.value.adjustment : balance.value?.balanceAdjustment ?? 0,
)
const hasAdjustment = computed(() => balanceAdjustment.value !== 0)
// Saldo financeiro disponível, antes das regras específicas de saque.
const totalBalance = computed(() => {
  if (activeHouse.value) return Math.max(0, activeHouse.value.total)
  return Math.max(0, balance.value?.balance ?? 0)
})
const baseGross = computed(() => {
  if (activeHouse.value) return directEarnings.value + networkEarnings.value
  return balance.value?.baseGross ?? 0
})
const directPercentage = computed(() => {
  const gross = baseGross.value
  return gross > 0 ? (directEarnings.value / gross) * 100 : 50
})

// ─── Fraud computed ───
const directFraud = computed(() =>
  activeHouse.value ? activeHouse.value.fraudDeduction : balance.value?.fraudDeduction ?? 0,
)
const networkFraud = computed(() =>
  activeHouse.value ? activeHouse.value.networkFraudDeduction : balance.value?.networkFraudDeduction ?? 0,
)
const totalFraud = computed(() =>
  activeHouse.value
    ? activeHouse.value.fraudDeduction + activeHouse.value.networkFraudDeduction
    : balance.value?.totalFraudDeduction ?? 0,
)
const hasFraud = computed(() => totalFraud.value > 0)
const grossBalance = computed(() => balance.value?.grossBalance ?? 0)

// ─── Withdrawals computed ───
const withdrawalsApproved = computed(() => balance.value?.withdrawalsApproved ?? 0)
const withdrawalsPending = computed(() => balance.value?.withdrawalsPending ?? 0)
const hasWithdrawals = computed(() => withdrawalsApproved.value > 0 || withdrawalsPending.value > 0)
const withdrawalFeePercentLabel = computed(() => {
  const rate = balance.value?.withdrawalFeeRate ?? 0.06
  const percent = rate * 100
  return Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(2).replace('.', ',')}%`
})

// ─── Trend Calculation ───
function calculateTrend(
  current: number,
  previous: number,
): { direction: 'up' | 'down'; label: string } | null {
  if (previous === 0) {
    return current > 0 ? { direction: 'up', label: 'Novo' } : null
  }
  const delta = ((current - previous) / previous) * 100
  return {
    direction: delta >= 0 ? 'up' : 'down',
    label: `${delta >= 0 ? '+' : ''}${delta.toFixed(0)}%`,
  }
}

// ─── KPI Cards ───
const operationalKpis = computed(() =>
  aggregatePinbetKpis(pinbetMetrics.value.houses, resolvedHouseSlug.value),
)

const kpis = computed(() => {
  if (!summary.value) return []
  const s = summary.value
  const p = previousSummary.value

  return [
    {
      label: 'Cliques',
      value: formatNumber(s.clicks),
      icon: 'i-lucide-mouse-pointer-click',
      trend: calculateTrend(s.clicks, p?.clicks ?? 0),
    },
    {
      label: 'Cadastros',
      value: formatNumber(s.registrations),
      icon: 'i-lucide-user-plus',
      trend: calculateTrend(s.registrations, p?.registrations ?? 0),
    },
    {
      label: 'FTD',
      value: formatNumber(s.ftds),
      icon: 'i-lucide-user-check',
      trend: calculateTrend(s.ftds, p?.ftds ?? 0),
    },
    {
      label: 'Depósitos',
      value: formatCurrency(s.deposit),
      icon: 'i-lucide-arrow-down-to-line',
      trend: null,
    },
    {
      label: 'Net P&L',
      value: operationalKpis.value.netPl === null
        ? 'Sincronizando'
        : formatCurrency(operationalKpis.value.netPl),
      icon: 'i-lucide-activity',
      trend: null,
      valueColor: operationalKpis.value.netPl !== null && operationalKpis.value.netPl < 0
        ? 'var(--vex-negative)'
        : 'var(--vex-text)',
    },
    {
      label: 'Saques',
      value: formatCurrency(operationalKpis.value.withdrawalTotal),
      icon: 'i-lucide-arrow-up-from-line',
      trend: null,
    },
    {
      label: 'Volume',
      value: formatCurrency(s.volume),
      icon: 'i-lucide-chart-no-axes-combined',
      trend: null,
    },
    {
      label: 'RevShare',
      value: formatCurrency(s.revShare),
      icon: 'i-lucide-pie-chart',
      trend: calculateTrend(s.revShare, p?.revShare ?? 0),
    },
    {
      label: 'CPA Qualif.',
      value: formatNumber(s.cpaQualified),
      icon: 'i-lucide-award',
      trend: calculateTrend(s.cpaQualified, p?.cpaQualified ?? 0),
    },
  ]
})

// ─── Daily Table ───
interface DailyTableRow extends DailyDataPoint {
  commission: number
}

const tableRows = computed<DailyTableRow[]>(() =>
  dailyData.value
    .map((row) => ({
      ...row,
      commission: row.cpaValue + row.revShare,
    }))
    .sort((a, b) => b.date.localeCompare(a.date)),
)

const page = ref(1)
const pageSize = 10
const paginatedData = computed(() => {
  const start = (page.value - 1) * pageSize
  return tableRows.value.slice(start, start + pageSize)
})

const columns = [
  { accessorKey: 'date', header: 'Data' },
  { accessorKey: 'clicks', header: 'Cliques' },
  { accessorKey: 'registrations', header: 'Cadastros' },
  { accessorKey: 'ftds', header: 'FTD' },
  { accessorKey: 'deposit', header: 'Depósitos' },
  { accessorKey: 'volume', header: 'Volume apostado' },
  { accessorKey: 'revShare', header: 'RevShare' },
  { accessorKey: 'cpaQualified', header: 'CPA Qual.' },
  { accessorKey: 'commission', header: 'Comissão' },
]

// Reset page when data changes
watch(dailyData, () => {
  page.value = 1
})
</script>

<template>
  <div class="min-h-full flex flex-col">
    <!-- ─── PAGE HEADER ─── -->
    <header class="vex-page-header">
      <div class="flex items-center gap-3">
        <h1 class="text-base font-bold vex-title">Dashboard</h1>
        <span
          class="vex-shell-chip hidden md:inline-block text-[11px] font-medium px-2 py-0.5 rounded-md"
        >
          {{ activePresetLabel }}
        </span>
      </div>

      <div class="flex items-center gap-2">
        <UPopover class="hidden md:block">
          <button
            class="vex-shell-control flex items-center gap-1.5 px-3 rounded-lg text-[12px] font-semibold transition-all"
            style="height: 2rem; max-height: 2rem"
          >
            <img
              v-if="selectedHouseOption?.logoUrl"
              :src="selectedHouseOption.logoUrl"
              :alt="selectedHouseOption.label"
              style="height: 22px; width: auto; max-width: 120px; object-fit: contain; display: block; flex-shrink: 0"
            >
            <template v-else>
              <UIcon name="i-lucide-building" class="size-5 opacity-60 shrink-0" />
              <span>{{ selectedHouseOption?.label || 'Todas as Casas' }}</span>
            </template>
            <UIcon name="i-lucide-chevron-down" class="size-3 opacity-50 ml-1 shrink-0" />
          </button>
          <template #content>
            <div class="p-2 min-w-[15rem]">
              <button
                v-for="opt in houseOptions"
                :key="opt.value"
                class="flex items-center gap-3 w-full px-4 py-3 rounded-lg text-[14px] font-semibold transition-all"
                :style="opt.value === selectedHouseSlug
                  ? 'background: var(--vex-brand-light); color: var(--vex-brand)'
                  : 'color: var(--vex-text)'"
                @click="selectedHouseSlug = opt.value"
              >
                <img
                  v-if="opt.logoUrl"
                  :src="opt.logoUrl"
                  :alt="opt.label"
                  class="h-6 max-w-[9rem] object-contain"
                >
                <span v-else>{{ opt.label }}</span>
              </button>
            </div>
          </template>
        </UPopover>
        <div
          class="vex-shell-segmented hidden md:flex items-center p-0.5 rounded-xl"
        >
          <button
            v-for="preset in presets"
            :key="preset"
            class="vex-shell-tab px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all duration-150"
            :class="activePreset === preset ? 'is-active' : ''"
            @click="activePreset = preset"
          >
            {{ preset }}
          </button>
        </div>

        <!-- Filtro de data personalizado (desktop + mobile) -->
        <UPopover v-model:open="customOpen" :content="{ side: 'bottom', align: 'end', sideOffset: 8 }">
          <div class="inline-flex">
            <!-- gatilho desktop -->
            <button
              class="vex-shell-control hidden md:flex items-center gap-1.5 px-3 rounded-lg text-[12px] font-semibold transition-all"
              :class="activePreset === 'Personalizado' ? 'is-active' : ''"
              style="height: 2rem; max-height: 2rem"
            >
              <UIcon name="i-lucide-calendar-range" class="size-4 opacity-70 shrink-0" />
              <span>{{ activePreset === 'Personalizado' ? 'Personalizado' : 'Data' }}</span>
              <UIcon name="i-lucide-chevron-down" class="size-3 opacity-50 shrink-0" />
            </button>
            <!-- gatilho mobile (mesmo visual do USelect de períodos) -->
            <button
              class="relative group rounded-md inline-flex items-center focus:outline-none disabled:cursor-not-allowed disabled:opacity-75 transition-colors px-2.5 py-1.5 text-xs gap-1.5 text-highlighted bg-default ring ring-inset ring-accented focus:ring-2 focus:ring-inset focus:ring-primary ps-8 pe-8 w-32 md:hidden"
              :class="activePreset === 'Personalizado' ? 'ring-primary' : ''"
            >
              <UIcon name="i-lucide-calendar-range" class="absolute start-2 size-4 opacity-70" />
              <span class="truncate">{{ activePreset === 'Personalizado' ? 'Personalizado' : 'Data' }}</span>
              <UIcon name="i-lucide-chevron-down" class="absolute end-2 size-3 opacity-50" />
            </button>
          </div>
          <template #content>
            <div class="p-3 min-w-[16rem] space-y-3">
              <div class="space-y-1">
                <label class="block text-[11px] font-semibold" style="color: var(--vex-text-faint)">De</label>
                <input
                  v-model="customStart"
                  type="date"
                  class="w-full px-2 py-1.5 rounded-md text-[13px] outline-none"
                  style="background: var(--vex-surface-strong); color: var(--vex-text); border: 1px solid var(--vex-border); color-scheme: dark"
                >
              </div>
              <div class="space-y-1">
                <label class="block text-[11px] font-semibold" style="color: var(--vex-text-faint)">Até</label>
                <input
                  v-model="customEnd"
                  type="date"
                  class="w-full px-2 py-1.5 rounded-md text-[13px] outline-none"
                  style="background: var(--vex-surface-strong); color: var(--vex-text); border: 1px solid var(--vex-border); color-scheme: dark"
                >
              </div>
              <button
                class="w-full py-1.5 rounded-md text-[12px] font-bold transition-all disabled:opacity-40"
                style="background: var(--vex-brand); color: #fff"
                :disabled="!customStart || !customEnd"
                @click="applyCustomRange"
              >
                Aplicar
              </button>
            </div>
          </template>
        </UPopover>

        <USelect v-model="activePreset" :items="presets" class="w-32 md:hidden" icon="i-lucide-calendar" size="sm" />
      </div>
    </header>

    <!-- ─── CONTENT ─── -->
    <div class="flex-1">
      <div class="py-5 space-y-5 w-full">

        <!-- ─── ERROR BANNER ─── -->
        <div
          v-if="error"
          class="flex items-center gap-3 px-4 py-3 rounded-lg"
          style="background: var(--vex-negative-light); border: 1px solid var(--vex-negative)"
        >
          <UIcon name="i-lucide-alert-triangle" class="size-5 shrink-0" style="color: var(--vex-negative)" />
          <span class="text-sm font-medium" style="color: var(--vex-negative)">{{ error }}</span>
          <button
            class="ml-auto text-xs font-bold underline"
            style="color: var(--vex-negative)"
            @click="loadDashboard(activePreset, resolvedHouseSlug, kpiViewMode)"
          >
            Tentar novamente
          </button>
        </div>

        <!--
        <div
          v-if="showSuperbetInactivityNotice"
          class="flex flex-col gap-2 rounded-lg border px-4 py-3 sm:flex-row sm:items-start"
          style="background: var(--vex-warning-soft-bg); border-color: var(--vex-warning-soft-border)"
        >
          <div class="flex size-8 shrink-0 items-center justify-center rounded-lg" style="background: var(--vex-warning-light)">
            <UIcon name="i-lucide-mail-warning" class="size-4" style="color: var(--vex-warning)" />
          </div>
          <div class="min-w-0">
            <p class="text-[12px] font-bold uppercase tracking-[0.08em]" style="color: var(--vex-warning)">
              Regra de atividade Superbet
            </p>
            <p class="mt-1 text-sm leading-relaxed" style="color: var(--vex-text)">
              Afiliados da Superbet precisam gerar ao menos 1 QFTD dentro do ciclo de 3 dias consecutivos. Caso não haja produção, o sistema envia avisos por email no 1º e 2º dia; no 3º dia sem QFTD, o link Superbet é removido e o acesso ao painel é bloqueado automaticamente.
            </p>
          </div>
        </div>
        -->

        <!-- Corrida dos Gigantes -->
        <!-- <DashboardGiantsRaceCard /> -->

        <!-- ═══════════════════════════════════════════
             BALANCE HERO — financial statement style
             ═══════════════════════════════════════════ -->
        <section class="vex-hero-card overflow-hidden">
          <div class="flex flex-col lg:flex-row items-stretch min-h-[200px]">

            <!-- LEFT: Dark brand panel — evokes a bank card / statement -->
            <div class="vex-shell-hero-panel flex-1 flex flex-col justify-between p-5 md:p-7 relative">
              <!-- Decorative background circles -->
              <div class="vex-shell-hero-orb--brand absolute top-0 right-0 w-56 h-56 rounded-full opacity-[0.06] pointer-events-none" style="transform: translate(30%, -30%)" />
              <div class="vex-shell-hero-orb--info absolute bottom-0 left-0 w-40 h-40 rounded-full opacity-[0.05] pointer-events-none" style="transform: translate(-30%, 30%)" />

              <!-- Top: label + status -->
              <div class="flex items-center justify-between relative">
                <div class="flex items-center gap-2">
                  <div class="size-7 rounded-lg flex items-center justify-center" style="background: var(--vex-brand-soft-bg-strong)">
                    <UIcon name="i-lucide-wallet" class="size-4" style="color: var(--vex-brand-soft-text)" />
                  </div>
                  <span class="text-[11px] font-bold tracking-[0.1em] uppercase" style="color: var(--vex-shell-dark-label)">Saldo Disponível</span>
                </div>
                <!-- Live indicator -->
                <div class="flex items-center gap-1.5">
                  <span class="size-1.5 rounded-full animate-pulse" style="background: var(--vex-brand-soft-text)" />
                  <span class="text-[10px] font-semibold" style="color: var(--vex-brand-soft-text-strong)">Atualizado</span>
                </div>
              </div>

              <!-- Center: the money -->
              <div class="relative my-4">
                <USkeleton v-if="pending" class="h-14 w-56" style="background: var(--vex-shell-dark-surface)" />
                <div v-else>
                  <p class="text-[11px] font-semibold mb-1" style="color: var(--vex-shell-dark-muted)">Total a receber</p>
                  <h2 class="vex-amount text-[3rem] md:text-[3.5rem] text-white leading-none">
                    {{ formatCurrency(totalBalance) }}
                  </h2>
                </div>
              </div>

              <!-- Bottom: CTA -->
              <div class="flex items-center gap-3 relative">
                <button
                  class="flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-bold transition-all duration-200 hover:opacity-90 active:scale-[0.98]"
                  style="background: var(--vex-brand-soft-text); color: #1c1917"
                  @click="navigateTo('/payments')"
                >
                  <UIcon name="i-lucide-banknote" class="size-4" />
                  Solicitar Saque
                </button>
                <span class="text-[11px]" style="color: var(--vex-shell-dark-subtle)">Processamento em até 48h</span>
              </div>
            </div>

            <!-- RIGHT: Revenue breakdown -->
            <div class="vex-hero-breakdown">
              <!-- Section title -->
              <div class="flex items-center justify-between mb-5">
                <p class="text-[10px] font-bold uppercase tracking-[0.14em] vex-breakdown-label">
                  Composição do Saldo
                </p>
                <span
                  class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold"
                  :style="resolvedHouseSlug
                    ? 'background: var(--vex-brand-soft-bg); color: var(--vex-brand)'
                    : 'background: var(--vex-bg-muted); color: var(--vex-text-faint)'"
                >
                  <img
                    v-if="selectedHouseOption?.logoUrl"
                    :src="selectedHouseOption.logoUrl"
                    :alt="selectedHouseOption.label"
                    class="h-3 max-w-[3rem] object-contain"
                  />
                  <template v-else>
                    <UIcon name="i-lucide-building" class="size-3" />
                    {{ selectedHouseOption?.label || 'Todas as Casas' }}
                  </template>
                </span>
              </div>

              <div class="space-y-4">
                <!-- Meus Dados -->
                <div>
                  <div class="flex items-center justify-between mb-2">
                    <div class="flex items-center gap-2">
                      <div class="vex-icon-badge vex-icon-badge--sm">
                        <UIcon name="i-lucide-user" class="size-3" />
                      </div>
                      <div>
                        <p class="text-[12px] font-semibold vex-breakdown-text">Meus Dados</p>
                        <p class="text-[10px] vex-breakdown-label">CPA + RevShare diretos</p>
                      </div>
                    </div>
                    <USkeleton v-if="pending" class="h-5 w-24" />
                    <span v-else class="vex-amount text-[15px] vex-breakdown-text">{{ formatCurrency(directEarnings) }}</span>
                  </div>
                  <div class="vex-progress-track vex-breakdown-track">
                    <div class="vex-progress-bar" :style="{ width: `${directPercentage}%` }" style="background: var(--vex-brand)" />
                  </div>
                </div>

                <!-- Minha Rede -->
                <div>
                  <div class="flex items-center justify-between mb-2">
                    <div class="flex items-center gap-2">
                      <div class="vex-icon-badge vex-icon-badge--sm vex-icon-badge--info">
                        <UIcon name="i-lucide-network" class="size-3" />
                      </div>
                      <div>
                        <p class="text-[12px] font-semibold vex-breakdown-text">Minha Rede</p>
                        <p class="text-[10px] vex-breakdown-label">Spread gerado pela equipe</p>
                      </div>
                    </div>
                    <USkeleton v-if="pending" class="h-5 w-24" />
                    <span v-else class="vex-amount text-[15px] vex-breakdown-text">{{ formatCurrency(networkEarnings) }}</span>
                  </div>
                  <div class="vex-progress-track vex-breakdown-track">
                    <div class="vex-progress-bar" :style="{ width: `${100 - directPercentage}%` }" style="background: var(--vex-info)" />
                  </div>
                </div>

                <!-- Bônus row -->
                <div v-if="hasBonus">
                  <div class="flex items-center justify-between mb-1.5">
                    <div class="flex items-center gap-2">
                      <div class="vex-icon-badge vex-icon-badge--sm" style="background: var(--vex-positive-soft-bg)">
                        <UIcon name="i-lucide-gift" class="size-3" style="color: var(--vex-positive)" />
                      </div>
                      <div>
                        <p class="text-[12px] font-semibold vex-breakdown-text">Bônus</p>
                        <p class="text-[10px] vex-breakdown-label">Créditos concedidos</p>
                      </div>
                    </div>
                    <USkeleton v-if="pending" class="h-5 w-24" />
                    <span v-else class="vex-amount text-[15px] font-bold" style="color: var(--vex-positive)">+{{ formatCurrency(bonusBalance) }}</span>
                  </div>
                </div>

                <!-- Ajuste manual row -->
                <div v-if="hasAdjustment">
                  <div class="flex items-center justify-between mb-1.5">
                    <div class="flex items-center gap-2">
                      <div class="vex-icon-badge vex-icon-badge--sm" :style="balanceAdjustment >= 0 ? 'background: var(--vex-positive-soft-bg)' : 'background: var(--vex-negative-soft-bg)'">
                        <UIcon name="i-lucide-sliders-horizontal" class="size-3" :style="balanceAdjustment >= 0 ? 'color: var(--vex-positive)' : 'color: var(--vex-negative)'" />
                      </div>
                      <div>
                        <p class="text-[12px] font-semibold vex-breakdown-text">Ajuste</p>
                        <p class="text-[10px] vex-breakdown-label">Ajuste manual de saldo</p>
                      </div>
                    </div>
                    <USkeleton v-if="pending" class="h-5 w-24" />
                    <span v-else class="vex-amount text-[15px] font-bold" :style="balanceAdjustment >= 0 ? 'color: var(--vex-positive)' : 'color: var(--vex-negative)'">{{ balanceAdjustment >= 0 ? '+' : '−' }}{{ formatCurrency(Math.abs(balanceAdjustment)) }}</span>
                  </div>
                </div>

                <!-- Fraud deduction row -->
                <div v-if="hasFraud">
                  <div class="flex items-center justify-between mb-1.5">
                    <div class="flex items-center gap-2">
                      <div class="vex-icon-badge vex-icon-badge--sm vex-icon-badge--danger" style="background: var(--vex-negative-soft-bg-strong)">
                        <UIcon name="i-lucide-shield-alert" class="size-3" style="color: var(--vex-negative)" />
                      </div>
                      <div>
                        <p class="text-[12px] font-semibold" style="color: var(--vex-negative)">Desconto por Fraude</p>
                        <p class="text-[10px] vex-breakdown-label">
                          Diretos: {{ formatCurrency(directFraud) }} · Rede: {{ formatCurrency(networkFraud) }}
                        </p>
                      </div>
                    </div>
                    <USkeleton v-if="pending" class="h-5 w-24" />
                    <span v-else class="vex-amount text-[15px] font-bold" style="color: var(--vex-negative)">−{{ formatCurrency(totalFraud) }}</span>
                  </div>
                </div>

                <!-- Withdrawals deduction rows -->
                <div v-if="hasWithdrawals">
                  <div v-if="withdrawalsApproved > 0" class="flex items-center justify-between mb-1.5">
                    <div class="flex items-center gap-2">
                      <div class="vex-icon-badge vex-icon-badge--sm" style="background: var(--vex-negative-soft-bg)">
                        <UIcon name="i-lucide-arrow-right-left" class="size-3" style="color: var(--vex-negative)" />
                      </div>
                      <div>
                        <p class="text-[12px] font-semibold" style="color: var(--vex-negative)">Saques Pagos</p>
                        <p class="text-[10px] vex-breakdown-label">Valores já aprovados (sem taxa)</p>
                      </div>
                    </div>
                    <USkeleton v-if="pending" class="h-5 w-24" />
                    <span v-else class="vex-amount text-[15px] font-bold" style="color: var(--vex-negative)">−{{ formatCurrency(withdrawalsApproved) }}</span>
                  </div>
                  <div v-if="withdrawalsPending > 0" class="flex items-center justify-between mb-1.5">
                    <div class="flex items-center gap-2">
                      <div class="vex-icon-badge vex-icon-badge--sm" style="background: var(--vex-warning-soft-bg)">
                        <UIcon name="i-lucide-clock" class="size-3" style="color: var(--vex-warning-soft-text)" />
                      </div>
                      <div>
                        <p class="text-[12px] font-semibold" style="color: var(--vex-warning-soft-text)">Saques Pendentes</p>
                        <p class="text-[10px] vex-breakdown-label">Aguardando aprovação (taxa {{ withdrawalFeePercentLabel }})</p>
                      </div>
                    </div>
                    <USkeleton v-if="pending" class="h-5 w-24" />
                    <span v-else class="vex-amount text-[15px] font-bold" style="color: var(--vex-warning-soft-text)">−{{ formatCurrency(withdrawalsPending) }}</span>
                  </div>
                </div>

                <!-- Total row -->
                <div class="pt-3 vex-breakdown-divider">
                  <div class="flex items-center justify-between">
                    <span class="text-[11px] font-bold uppercase tracking-wide vex-breakdown-label">Total disponível</span>
                    <USkeleton v-if="pending" class="h-5 w-28" />
                    <span v-else class="vex-amount text-[1.05rem]" style="color: var(--vex-positive)">{{ formatCurrency(totalBalance) }}</span>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </section>

        <!-- ═══════════════════════════════════════════
             VIEW SWITCHER & KPI GRID
             ═══════════════════════════════════════════ -->
        <div class="flex items-center justify-center pt-2 pb-1 relative z-10 w-full mb-2">
          <div class="inline-flex items-center p-1 rounded-lg" style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle)">
            <button
              class="px-3 sm:px-4 py-1.5 text-[11px] sm:text-[12px] font-bold rounded-md transition-all duration-200 flex items-center gap-1.5 sm:gap-2"
              :class="kpiViewMode === 'mine' ? 'bg-[var(--vex-brand)] text-[var(--vex-surface)] shadow-md' : 'text-[var(--vex-text-faint)] hover:text-[var(--vex-text)] hover:bg-[var(--vex-bg-muted)]'"
              @click="kpiViewMode = 'mine'"
            >
              <UIcon name="i-lucide-user" class="size-3.5" />
              <span>Meus Dados</span>
            </button>
            <button
              class="px-3 sm:px-4 py-1.5 text-[11px] sm:text-[12px] font-bold rounded-md transition-all duration-200 flex items-center gap-1.5 sm:gap-2"
              :class="kpiViewMode === 'network' ? 'bg-[var(--vex-brand)] text-[var(--vex-surface)] shadow-md' : 'text-[var(--vex-text-faint)] hover:text-[var(--vex-text)] hover:bg-[var(--vex-bg-muted)]'"
              @click="kpiViewMode = 'network'"
            >
              <UIcon name="i-lucide-network" class="size-3.5" />
              <span>Minha Rede</span>
            </button>
            <button
              class="px-3 sm:px-4 py-1.5 text-[11px] sm:text-[12px] font-bold rounded-md transition-all duration-200 flex items-center gap-1.5 sm:gap-2"
              :class="kpiViewMode === 'all' ? 'bg-[var(--vex-surface)] text-[var(--vex-text)] border border-transparent shadow-md' : 'text-[var(--vex-text-faint)] hover:text-[var(--vex-text)] hover:bg-[var(--vex-bg-muted)]'"
              :style="kpiViewMode === 'all' ? 'border-color: var(--vex-border)' : ''"
              @click="kpiViewMode = 'all'"
            >
              <UIcon name="i-lucide-layout-dashboard" class="size-3.5" />
              <span>Tudo</span>
            </button>

            <!-- Divisor + seletor de casa — mobile only -->
            <span class="md:hidden w-px h-5 mx-0.5 shrink-0" style="background: var(--vex-border-subtle)" />
            <UPopover class="md:hidden">
              <button
                class="px-3 py-1.5 text-[11px] font-bold rounded-md transition-all duration-200 flex items-center gap-1.5"
                :class="selectedHouseSlug !== '__all__' ? 'bg-[var(--vex-brand)] text-[var(--vex-surface)] shadow-md' : 'text-[var(--vex-text-faint)] hover:text-[var(--vex-text)] hover:bg-[var(--vex-bg-muted)]'"
              >
                <img
                  v-if="selectedHouseOption?.logoUrl"
                  :src="selectedHouseOption.logoUrl"
                  :alt="selectedHouseOption.label"
                  :style="selectedHouseSlug !== '__all__' ? 'height:14px;width:auto;max-width:60px;object-fit:contain;display:block;filter:brightness(0) invert(1)' : 'height:14px;width:auto;max-width:60px;object-fit:contain;display:block'"
                >
                <template v-else>
                  <UIcon name="i-lucide-building" class="size-3.5 shrink-0" />
                  <span class="max-w-[4.5rem] truncate">{{ selectedHouseOption?.label || 'Casa' }}</span>
                </template>
                <UIcon name="i-lucide-chevron-down" class="size-3 shrink-0 opacity-60" />
              </button>
              <template #content>
                <div class="p-2 min-w-[13rem]">
                  <button
                    v-for="opt in houseOptions"
                    :key="opt.value"
                    class="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-[13px] font-semibold transition-all"
                    :style="opt.value === selectedHouseSlug
                      ? 'background: var(--vex-brand-light); color: var(--vex-brand)'
                      : 'color: var(--vex-text)'"
                    @click="selectedHouseSlug = opt.value"
                  >
                    <img
                      v-if="opt.logoUrl"
                      :src="opt.logoUrl"
                      :alt="opt.label"
                      class="h-5 max-w-[6rem] object-contain"
                    >
                    <span v-else>{{ opt.label }}</span>
                  </button>
                </div>
              </template>
            </UPopover>
          </div>
        </div>

        <section class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3 vex-stagger">
          <article
            v-for="kpi in kpis"
            :key="kpi.label"
            class="vex-kpi-card group"
          >
            <!-- Icon top-right -->
            <div class="flex items-start justify-between mb-4">
              <span class="text-[11px] font-semibold uppercase tracking-wide leading-tight" style="color: var(--vex-text-faint)">
                {{ kpi.label }}
              </span>
              <div class="vex-icon-badge vex-icon-badge--sm">
                <UIcon :name="kpi.icon" class="size-3.5" />
              </div>
            </div>

            <!-- Value -->
            <div>
              <USkeleton v-if="pending" class="h-7 w-20 mb-2" />
              <p
                v-else
                class="vex-amount text-[1.5rem] leading-none"
                :style="{ color: kpi.valueColor ?? 'var(--vex-text)' }"
              >
                {{ kpi.value }}
              </p>
            </div>

            <!-- Trend -->
            <div class="mt-2.5 flex items-center gap-1">
              <USkeleton v-if="pending" class="h-3.5 w-14" />
              <template v-else-if="kpi.trend">
                <span
                  class="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded"
                  :style="{
                    color: kpi.trend.direction === 'up' ? 'var(--vex-positive)' : 'var(--vex-negative)',
                    background: kpi.trend.direction === 'up' ? 'var(--vex-positive-light)' : 'var(--vex-negative-light)'
                  }"
                >
                  <UIcon
                    :name="kpi.trend.direction === 'up' ? 'i-lucide-trending-up' : 'i-lucide-trending-down'"
                    class="size-3"
                  />
                  {{ kpi.trend.label }}
                </span>
                <span class="text-[10px] font-medium hidden sm:inline" style="color: var(--vex-text-faint)">
                  vs período ant.
                </span>
              </template>
            </div>
          </article>
        </section>

        <!-- ═══════════════════════════════════════════
             DAILY TABLE
             ═══════════════════════════════════════════ -->
        <section class="vex-card overflow-hidden">
          <div class="vex-table-header">
            <div>
              <h3 class="text-sm font-bold vex-title" style="color: var(--vex-text)">Desempenho Diário</h3>
              <p class="text-[11px] mt-0.5" style="color: var(--vex-text-faint)">Detalhamento por dia no período selecionado</p>
            </div>
            <div class="flex items-center gap-2 w-full sm:w-auto">
              <span class="text-[11px] font-medium" style="color: var(--vex-text-muted)">
                {{ tableRows.length }} registro{{ tableRows.length !== 1 ? 's' : '' }}
              </span>
            </div>
          </div>

          <div class="overflow-x-auto w-full">
            <template v-if="pending">
              <div class="p-4 space-y-3">
                <USkeleton v-for="i in 4" :key="i" class="h-10 w-full" />
              </div>
            </template>

            <template v-else-if="paginatedData.length === 0">
              <div class="py-16 flex flex-col items-center justify-center text-center">
                <div class="vex-icon-badge" style="width: 3rem; height: 3rem; margin-bottom: 1rem">
                  <UIcon name="i-lucide-file-bar-chart-2" class="size-6" />
                </div>
                <h3 class="text-sm font-bold" style="color: var(--vex-text)">Nenhum dado encontrado</h3>
                <p class="text-xs max-w-xs mt-1 mb-5" style="color: var(--vex-text-muted)">Não há registros para o período selecionado.</p>
                <UButton label="Limpar filtros" color="neutral" variant="outline" size="sm" @click="activePreset = '7 dias'" />
              </div>
            </template>

            <UTable v-else :columns="columns" :data="paginatedData">
              <template #date-cell="{ row }">
                <span class="font-medium text-[13px]" style="color: var(--vex-text)">{{ formatDateOnly(row.original.date) }}</span>
              </template>
              <template #deposit-cell="{ row }">
                <span class="font-money text-[13px] tabular-nums">{{ formatCurrency(row.original.deposit) }}</span>
              </template>
              <template #volume-cell="{ row }">
                <span class="font-money text-[13px] tabular-nums">{{ formatCurrency(row.original.volume) }}</span>
              </template>
              <template #revShare-cell="{ row }">
                <span class="font-money text-[13px] tabular-nums">{{ formatCurrency(row.original.revShare) }}</span>
              </template>
              <template #cpaQualified-cell="{ row }">
                <span class="text-[13px] tabular-nums">{{ row.original.cpaQualified }}</span>
              </template>
              <template #commission-cell="{ row }">
                <span class="font-money text-[13px] font-semibold tabular-nums" style="color: var(--vex-positive)">{{ formatCurrency(row.original.commission) }}</span>
              </template>
            </UTable>
          </div>

          <div class="vex-table-footer">
            <p class="text-[11px]" style="color: var(--vex-text-muted)">
              <template v-if="tableRows.length > 0">
                Exibindo
                <span class="font-bold" style="color: var(--vex-text)">{{ (page - 1) * pageSize + 1 }}</span>
                a
                <span class="font-bold" style="color: var(--vex-text)">{{ Math.min(page * pageSize, tableRows.length) }}</span>
                de
                <span class="font-bold" style="color: var(--vex-text)">{{ tableRows.length }}</span>
                registros
              </template>
            </p>
            <UPagination
              v-if="tableRows.length > pageSize"
              :page="page"
              :total="tableRows.length"
              :items-per-page="pageSize"
              @update:page="page = $event"
            />
          </div>
        </section>

      </div>
    </div>
  </div>
</template>

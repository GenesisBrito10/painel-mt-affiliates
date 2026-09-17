<script setup lang="ts">
interface DealEligibility {
  eligible: boolean
  required: boolean
  metricsHouseSlug: string
  windowDays: number
  minAvgDepositPerFtd: number
  minQualifiedFtd: number
  sumQualifiedFtd: number
  sumDeposit: number
  sumFtds: number
  avgDepositPerFtd: number | null
  reasons: string[]
}

interface DealItem {
  id: string
  name: string
  bettingHouseSlug: string
  houseName: string
  cpa: number
  revshare: number
  baseline: number
  exclusive: boolean
  featured: boolean
  newArrival: boolean
  logoUrl: string | null
  conditionsText: string | null
  paymentNotes: string | null
  trafficSources: string[]
  revenueType: string
  eligibility?: DealEligibility
  userStatus: 'PENDING' | 'FULFILLED' | 'REJECTED' | null
}

const props = defineProps<{ deal: DealItem; submitting?: boolean }>()
const emit = defineEmits<{ request: []; detail: [] }>()

function fmt(v: number) {
  return v > 0 ? `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : ''
}
function fmtPct(v: number) { return v > 0 ? `${v}%` : '' }
function fmtMetric(v: number | null | undefined) {
  const value = typeof v === 'number' ? v : 0
  return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const statusMap: Record<string, { label: string; ctaClass: string; icon: string; indicatorClass: string }> = {
  PENDING:   { label: 'Pendente',  ctaClass: 'vex-cta-status--pending',  icon: 'i-lucide-clock',        indicatorClass: 'vex-status-indicator--pending' },
  FULFILLED: { label: 'Aprovado',  ctaClass: 'vex-cta-status--approved', icon: 'i-lucide-check-circle', indicatorClass: 'vex-status-indicator--approved' },
  REJECTED:  { label: 'Recusado',  ctaClass: 'vex-cta-status--rejected', icon: 'i-lucide-x-circle',     indicatorClass: 'vex-status-indicator--rejected' },
}

const canRequest = computed(() => (!props.deal.userStatus || props.deal.userStatus === 'REJECTED') && (props.deal.eligibility?.eligible ?? true))
const isLockedByEligibility = computed(() => !props.deal.userStatus && props.deal.eligibility?.required && !props.deal.eligibility.eligible)

const cardClasses = computed(() => {
  const classes = ['vex-deal-card']
  if (props.deal.featured) classes.push('vex-deal-card--featured')
  if (props.deal.userStatus === 'FULFILLED') classes.push('vex-deal-card--applied')
  if (isLockedByEligibility.value) classes.push('vex-deal-card--locked')
  return classes.join(' ')
})

const hasBadges = computed(() => props.deal.featured || props.deal.newArrival || props.deal.exclusive)
</script>

<template>
  <div
    :class="cardClasses"
    @click="emit('detail')"
    tabindex="0"
    @keydown.enter="emit('detail')"
  >
    <!-- Header: Logo + Name + Status -->
    <div class="flex items-start gap-3">
      <div class="size-11 shrink-0 rounded-[10px] flex items-center justify-center overflow-hidden" style="background: var(--vex-bg-muted); border: 1px solid var(--vex-border-subtle)">
        <img v-if="deal.logoUrl" :src="deal.logoUrl" :alt="deal.houseName" class="size-full object-cover">
        <span v-else class="font-bold text-lg" style="color: var(--vex-brand)">{{ deal.houseName.charAt(0).toUpperCase() }}</span>
      </div>
      <div class="flex-1 min-w-0">
        <h4 class="font-bold vex-title truncate text-[14px] sm:text-[15px]" style="color: var(--vex-text)">{{ deal.houseName }}</h4>
        <span class="text-[11px] font-semibold uppercase tracking-wider" style="color: var(--vex-text-faint)">Sportsbook</span>
      </div>
      <!-- Status Corner Indicator -->
      <div
        v-if="deal.userStatus"
        :class="['vex-status-indicator', statusMap[deal.userStatus]?.indicatorClass]"
        :title="statusMap[deal.userStatus]?.label"
      >
        <UIcon :name="statusMap[deal.userStatus]?.icon ?? 'i-lucide-clock'" class="size-3.5" />
      </div>
      <div
        v-else
        :class="['vex-status-indicator', canRequest ? 'vex-status-indicator--available' : 'vex-status-indicator--pending']"
        :title="canRequest ? 'Disponível' : 'Requisito não atingido'"
      >
        <UIcon :name="canRequest ? 'i-lucide-circle-plus' : 'i-lucide-lock'" class="size-3.5" />
      </div>
    </div>

    <!-- CPA Hero Metric -->
    <div class="vex-metric-hero">
      <span class="vex-metric-label">CPA</span>
      <p v-if="deal.cpa > 0" class="vex-metric-value vex-metric-value--cpa">{{ fmt(deal.cpa) }}</p>
      <p v-else class="vex-metric-value vex-metric-value--empty">Sob consulta</p>
    </div>

    <!-- Secondary Metrics -->
    <div class="vex-metric-row">
      <div class="vex-metric-cell">
        <span class="vex-metric-label">RevShare</span>
        <p v-if="deal.revshare > 0" class="vex-metric-value vex-metric-value--revshare">{{ fmtPct(deal.revshare) }}</p>
        <p v-else class="vex-metric-value vex-metric-value--empty">—</p>
      </div>
      <div class="vex-metric-cell">
        <span class="vex-metric-label">Baseline</span>
        <p v-if="deal.baseline > 0" class="vex-metric-value vex-metric-value--baseline">{{ fmt(deal.baseline) }}</p>
        <p v-else class="vex-metric-value vex-metric-value--empty">—</p>
      </div>
    </div>

    <!-- Badges -->
    <div v-if="hasBadges" class="flex flex-wrap gap-1.5 mt-3">
      <span v-if="deal.featured" class="vex-badge vex-badge--featured">
        <UIcon name="i-lucide-star" class="size-2.5" /> Destaque
      </span>
      <span v-if="deal.newArrival" class="vex-badge vex-badge--new">
        <UIcon name="i-lucide-sparkles" class="size-2.5" /> Novo
      </span>
      <span v-if="deal.exclusive" class="vex-badge vex-badge--exclusive">
        <UIcon name="i-lucide-lock" class="size-2.5" /> Exclusivo
      </span>
    </div>

    <div
      v-if="deal.eligibility?.required"
      class="mt-3 rounded-lg px-3 py-2"
      style="background: var(--vex-bg-muted); border: 1px solid var(--vex-border-subtle)"
    >
      <div class="flex items-center justify-between gap-3">
        <span class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--vex-text-faint)">Qualidade Superbet</span>
        <span
          class="text-[11px] font-bold font-money tabular-nums"
          :style="{ color: deal.eligibility.eligible ? 'var(--vex-positive)' : 'var(--vex-warning)' }"
        >
          {{ deal.eligibility.sumQualifiedFtd }} CPA
        </span>
      </div>
      <div class="mt-1 text-[10px]" style="color: var(--vex-text-faint)">
        <template v-if="deal.eligibility.minAvgDepositPerFtd > 0">
          Mínimo {{ deal.eligibility.minQualifiedFtd }} CPAs e {{ fmtMetric(deal.eligibility.minAvgDepositPerFtd) }} méd./FTD em {{ deal.eligibility.windowDays }} dias
        </template>
        <template v-else>
          Mínimo {{ deal.eligibility.minQualifiedFtd }} CPA na Superbet em {{ deal.eligibility.windowDays }} dias
        </template>
      </div>
    </div>

    <!-- Spacer -->
    <div class="flex-1 min-h-3" />

    <!-- CTA Row -->
    <div class="mt-3.5">
      <button
        class="vex-cta-secondary w-full"
        @click.stop="emit('detail')"
      >
        <UIcon name="i-lucide-eye" class="size-3.5" />
        Ver Detalhes
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { NetworkMemberEarnings } from '~/types/earnings'

const props = defineProps<{
  member: NetworkMemberEarnings
}>()

const formatCurrency = (val: number) => {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0)
}

const formatInteger = (val: number) => {
  return new Intl.NumberFormat('pt-BR').format(val || 0)
}

const formatPercent = (val: number) => {
  return `${(val || 0).toFixed(1).replace('.', ',')}%`
}

const formatDate = (value: string) => {
  if (!value) return '-'
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value))
}

const grossEarnings = computed(() => props.member.grossEarnings || props.member.cpaEarnings + props.member.revshareEarnings)
const compositionBase = computed(() => Math.max(grossEarnings.value + props.member.fraudDeduction, 1))

const cpaShareWidth = computed(() => {
  if (props.member.cpaEarnings <= 0) return '0%'
  return `${Math.max(4, Math.min(100, (props.member.cpaEarnings / compositionBase.value) * 100))}%`
})

const revShareWidth = computed(() => {
  if (props.member.revshareEarnings <= 0) return '0%'
  return `${Math.max(4, Math.min(100, (props.member.revshareEarnings / compositionBase.value) * 100))}%`
})

const fraudShareWidth = computed(() => {
  if (props.member.fraudDeduction <= 0) return '0%'
  return `${Math.max(4, Math.min(100, (props.member.fraudDeduction / compositionBase.value) * 100))}%`
})

const qualificationRate = computed(() => {
  if (!props.member.registrations) return 0
  return (props.member.cpaQualified / props.member.registrations) * 100
})

const ftdRate = computed(() => {
  if (!props.member.registrations) return 0
  return (props.member.ftds / props.member.registrations) * 100
})

const netTone = computed(() => {
  if (props.member.totalEarnings > 0) {
    return {
      bg: 'var(--vex-positive-soft-bg)',
      border: 'var(--vex-positive-soft-border)',
      accent: 'var(--vex-positive-soft-text)',
      icon: 'i-lucide-trending-up',
      label: 'Ganho líquido positivo',
    }
  }

  if (props.member.fraudDeduction > 0) {
    return {
      bg: 'var(--vex-negative-soft-bg)',
      border: 'var(--vex-negative-soft-border)',
      accent: 'var(--vex-negative-soft-text)',
      icon: 'i-lucide-shield-alert',
      label: 'Impactado por fraude',
    }
  }

  return {
    bg: 'var(--vex-bg-muted)',
    border: 'var(--vex-border-subtle)',
    accent: 'var(--vex-text-muted)',
    icon: 'i-lucide-minus',
    label: 'Sem ganho no período',
  }
})

const metricCards = computed(() => [
  {
    label: 'CPA da rede',
    value: formatCurrency(props.member.cpaEarnings),
    detail: `${formatInteger(props.member.cpaQualified)} qualificados`,
    icon: 'i-lucide-badge-check',
    bg: 'var(--vex-positive-soft-bg)',
    accent: 'var(--vex-positive-soft-text)',
    border: 'var(--vex-positive-soft-border)',
  },
  {
    label: 'RevShare',
    value: formatCurrency(props.member.revshareEarnings),
    detail: `${formatCurrency(props.member.revShareGenerated)} gerado`,
    icon: 'i-lucide-percent',
    bg: 'var(--vex-info-soft-bg)',
    accent: 'var(--vex-info-soft-text)',
    border: 'var(--vex-info-soft-border)',
  },
  {
    label: 'Depósitos',
    value: formatCurrency(props.member.deposit),
    detail: `${formatInteger(props.member.ftds)} FTDs · ${formatPercent(ftdRate.value)}`,
    icon: 'i-lucide-arrow-down-to-line',
    bg: 'var(--vex-warning-soft-bg)',
    accent: 'var(--vex-warning-soft-text)',
    border: 'var(--vex-warning-soft-border)',
  },
  {
    label: 'Cadastros',
    value: formatInteger(props.member.registrations),
    detail: `${formatInteger(props.member.clicks)} cliques · ${formatPercent(qualificationRate.value)} CPA`,
    icon: 'i-lucide-user-plus',
    bg: 'var(--vex-brand-soft-bg)',
    accent: 'var(--vex-brand-soft-text)',
    border: 'var(--vex-brand-soft-border)',
  },
])
</script>

<template>
  <UCard
    class="overflow-hidden bg-white dark:bg-gray-900 transition-all hover:shadow-md"
    :ui="{ body: 'p-0 sm:p-0' }"
  >
    <div class="h-1.5" :style="{ background: member.totalEarnings > 0 ? 'var(--vex-positive)' : member.fraudDeduction > 0 ? 'var(--vex-negative)' : 'var(--vex-border)' }" />

    <div class="p-4 sm:p-5">
      <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div class="min-w-0">
          <div class="flex min-w-0 items-start gap-3">
            <div class="flex size-11 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white" style="background: linear-gradient(135deg, var(--vex-brand), var(--vex-info))">
              {{ member.memberName?.charAt(0)?.toUpperCase() || 'A' }}
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="truncate text-base font-bold text-gray-900 dark:text-white">{{ member.memberName }}</span>
                <UBadge color="info" variant="soft">Nível {{ member.level }}</UBadge>
                <EarningsStatusBadge :status="member.status" />
              </div>

              <div class="mt-1 truncate text-xs text-gray-500">{{ member.memberEmail }}</div>

              <div class="mt-3 flex flex-wrap gap-1.5">
                <span
                  v-for="house in member.houses"
                  :key="house"
                  class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold"
                  style="background: var(--vex-bg-muted); color: var(--vex-text-muted)"
                >
                  <HouseBadge :slug="house" size="xs" />
                </span>
                <span v-if="member.houses.length === 0" class="text-xs text-gray-400">Sem casa com resultado no período</span>
              </div>
            </div>
          </div>

          <div class="mt-4 grid gap-2 text-xs text-gray-600 dark:text-gray-400 md:grid-cols-3">
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-calendar-days" class="size-3.5 text-gray-400" />
              <span>Entrou em {{ formatDate(member.joinedAt) }}</span>
            </div>
            <div class="flex min-w-0 items-center gap-2">
              <UIcon name="i-lucide-network" class="size-3.5 shrink-0 text-gray-400" />
              <span class="truncate">{{ member.parentName ? `Indicado por ${member.parentName}` : 'Indicação direta' }}</span>
            </div>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-users" class="size-3.5 text-gray-400" />
              <span>{{ formatInteger(member.subReferrals) }} subindicados</span>
            </div>
          </div>
        </div>

        <div class="rounded-lg border p-4" :style="{ background: netTone.bg, borderColor: netTone.border }">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="text-[11px] font-bold uppercase tracking-wide" :style="{ color: netTone.accent }">
                Seu ganho líquido
              </div>
              <div class="mt-1 font-money text-2xl font-bold" style="color: var(--vex-text)">
                {{ formatCurrency(member.totalEarnings) }}
              </div>
            </div>
            <div class="flex size-10 items-center justify-center rounded-lg" style="background: var(--vex-surface-raised)">
              <UIcon :name="netTone.icon" class="size-5" :style="{ color: netTone.accent }" />
            </div>
          </div>

          <div class="mt-3 text-xs" style="color: var(--vex-text-muted)">
            {{ netTone.label }}
          </div>

          <div v-if="member.fraudDeduction > 0" class="mt-2 flex items-center gap-1.5 text-xs font-semibold" style="color: var(--vex-negative)">
            <UIcon name="i-lucide-shield-alert" class="size-3.5" />
            -{{ formatCurrency(member.fraudDeduction) }} em {{ formatInteger(member.fraudCount) }} fraude(s)
          </div>
        </div>
      </div>

      <div class="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div
          v-for="metric in metricCards"
          :key="metric.label"
          class="rounded-lg border p-3"
          :style="{ background: metric.bg, borderColor: metric.border }"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="text-[11px] font-semibold uppercase tracking-wide" :style="{ color: metric.accent }">{{ metric.label }}</div>
              <div class="mt-1 truncate font-money text-lg font-bold" style="color: var(--vex-text)">{{ metric.value }}</div>
              <div class="mt-1 text-[11px]" style="color: var(--vex-text-muted)">{{ metric.detail }}</div>
            </div>
            <div class="flex size-8 shrink-0 items-center justify-center rounded-md" style="background: var(--vex-surface-raised)">
              <UIcon :name="metric.icon" class="size-4" :style="{ color: metric.accent }" />
            </div>
          </div>
        </div>
      </div>

      <div class="mt-5 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div class="text-xs font-bold uppercase tracking-wide text-gray-500">Composição do ganho</div>
          <div class="text-xs text-gray-500">Bruto: {{ formatCurrency(grossEarnings) }}</div>
        </div>

        <div class="flex h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
          <div class="h-full bg-emerald-500" :style="{ width: cpaShareWidth }" />
          <div class="h-full" :style="{ width: revShareWidth, background: 'var(--vex-info)' }" />
          <div class="h-full bg-red-500" :style="{ width: fraudShareWidth }" />
        </div>

        <div class="mt-3 grid gap-2 text-[11px] text-gray-600 dark:text-gray-400 sm:grid-cols-3">
          <div class="flex items-center gap-1.5">
            <span class="size-2 rounded-full bg-emerald-500" />
            CPA: {{ formatCurrency(member.cpaEarnings) }}
          </div>
          <div class="flex items-center gap-1.5">
            <span class="size-2 rounded-full" :style="{ background: 'var(--vex-info)' }" />
            RevShare: {{ formatCurrency(member.revshareEarnings) }}
          </div>
          <div class="flex items-center gap-1.5">
            <span class="size-2 rounded-full bg-red-500" />
            Fraude: -{{ formatCurrency(member.fraudDeduction) }}
          </div>
        </div>
      </div>

      <div v-if="member.houseBreakdown.length" class="mt-5">
        <div class="mb-2 flex items-center justify-between gap-3">
          <h4 class="text-sm font-semibold text-gray-900 dark:text-white">Detalhe por casa</h4>
          <span class="text-xs text-gray-500">{{ member.houseBreakdown.length }} casa(s)</span>
        </div>

        <div class="grid gap-2">
          <div
            v-for="house in member.houseBreakdown"
            :key="house.house"
            class="rounded-lg border border-gray-200 p-3 dark:border-gray-800"
          >
            <div class="grid gap-3 lg:grid-cols-[minmax(120px,0.8fr)_1fr_1fr_minmax(120px,0.7fr)] lg:items-center">
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <!-- <span class="flex size-7 shrink-0 items-center justify-center rounded-md" style="background: var(--vex-brand-muted); color: var(--vex-brand)">
                    <HouseBadge :slug="house.house" size="xs" />
                  </span> -->
                  <div class="min-w-0">
                    <div class="truncate text-sm font-bold text-gray-900 dark:text-white"><HouseBadge :slug="house.house" size="sm" /></div>
                    <div class="text-[11px] text-gray-500">{{ house.clicks }} cliques</div>
                  </div>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div class="text-gray-500">Margem CPA</div>
                  <div class="font-money font-bold" style="color: var(--vex-positive)">{{ formatCurrency(house.cpaMargin) }}</div>
                </div>
                <div>
                  <div class="text-gray-500">Margem Rev</div>
                  <div class="font-money font-bold" style="color: var(--vex-info)">{{ formatPercent(house.revshareMargin) }}</div>
                </div>
              </div>

              <div class="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div class="text-gray-500">Cad.</div>
                  <div class="font-semibold text-gray-900 dark:text-white">{{ formatInteger(house.registrations) }}</div>
                </div>
                <div>
                  <div class="text-gray-500">CPA</div>
                  <div class="font-semibold text-gray-900 dark:text-white">{{ formatInteger(house.cpaQualified) }}</div>
                </div>
                <div>
                  <div class="text-gray-500">Depósito</div>
                  <div class="font-money font-semibold text-gray-900 dark:text-white">{{ formatCurrency(house.deposit) }}</div>
                </div>
              </div>

              <div
                class="rounded-md border px-3 py-2 text-left lg:text-right"
                :style="house.netEarnings > 0
                  ? { background: 'var(--vex-positive-soft-bg)', borderColor: 'var(--vex-positive-soft-border)' }
                  : { background: 'var(--vex-bg-muted)', borderColor: 'var(--vex-border-subtle)' }"
              >
                <div class="text-[11px] font-semibold" style="color: var(--vex-text-muted)">Ganho líquido</div>
                <div class="font-money text-base font-bold" :style="{ color: house.netEarnings > 0 ? 'var(--vex-positive-soft-text)' : 'var(--vex-text)' }">
                  {{ formatCurrency(house.netEarnings) }}
                </div>
                <div v-if="house.fraudDeduction > 0" class="text-[11px] font-semibold" style="color: var(--vex-negative)">
                  -{{ formatCurrency(house.fraudDeduction) }} fraude
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </UCard>
</template>

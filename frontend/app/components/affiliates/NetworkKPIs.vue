<script setup lang="ts">
/**
 * NetworkKPIs — Compact horizontal strip of 4 KPI metrics.
 */
const props = defineProps<{
  total: number
  approved: number
  pending: number
  rejected: number
}>()

const kpis = computed(() => [
  { label: 'Na Rede', value: props.total, icon: 'i-lucide-users', color: 'var(--vex-text)', badgeClass: '' },
  { label: 'Aprovados', value: props.approved, icon: 'i-lucide-check-circle', color: 'var(--vex-positive)', badgeClass: 'vex-icon-badge--positive' },
  { label: 'Pendentes', value: props.pending, icon: 'i-lucide-clock', color: 'var(--vex-warning)', badgeClass: 'vex-icon-badge--warning' },
  { label: 'Recusados', value: props.rejected, icon: 'i-lucide-x-circle', color: 'var(--vex-negative)', badgeClass: 'vex-icon-badge--negative' }
])
</script>

<template>
  <section class="grid grid-cols-2 lg:grid-cols-4 gap-3 vex-stagger">
    <article v-for="kpi in kpis" :key="kpi.label" class="vex-kpi-card">
      <div class="flex items-start justify-between mb-3">
        <span class="text-[11px] font-semibold uppercase tracking-wide" style="color: var(--vex-text-faint)">{{ kpi.label }}</span>
        <div :class="['vex-icon-badge vex-icon-badge--sm', kpi.badgeClass]">
          <UIcon :name="kpi.icon" class="size-3.5" />
        </div>
      </div>
      <p class="vex-amount text-[1.5rem] leading-none" :style="{ color: kpi.color }">{{ kpi.value }}</p>
    </article>
  </section>
</template>

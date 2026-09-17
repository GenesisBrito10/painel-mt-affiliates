<script setup lang="ts">
type Tone = 'gold' | 'purple' | 'green' | 'red' | 'amber' | 'blue' | 'default'

const props = withDefaults(defineProps<{
  label: string
  value: string | number
  icon?: string
  tone?: Tone
  hint?: string
  trend?: number
  glow?: boolean
  alert?: boolean
  to?: string
}>(), {
  tone: 'gold',
  glow: false,
  alert: false
})

const accent = computed(() => {
  const map: Record<Tone, string> = {
    gold: 'var(--color-gold)',
    purple: 'var(--color-purple)',
    green: '#22C55E',
    red: '#EF4444',
    amber: '#F59E0B',
    blue: '#7C3AED',
    default: 'var(--color-border-strong)'
  }
  return map[props.tone]
})

const iconBg = computed(() => {
  const map: Record<Tone, string> = {
    gold: 'var(--color-gold-soft)',
    purple: 'var(--color-purple-soft)',
    green: 'rgba(34, 197, 94, 0.15)',
    red: 'rgba(239, 68, 68, 0.15)',
    amber: 'rgba(245, 158, 11, 0.15)',
    blue: 'rgba(124, 58, 237, 0.15)',
    default: 'rgba(255, 255, 255, 0.05)'
  }
  return map[props.tone]
})

const iconColor = computed(() => {
  const map: Record<Tone, string> = {
    gold: 'var(--color-gold)',
    purple: '#A78BFA',
    green: '#4ADE80',
    red: '#F87171',
    amber: '#FBBF24',
    blue: '#A78BFA',
    default: 'var(--color-text-secondary)'
  }
  return map[props.tone]
})

const valueColor = computed(() => {
  if (props.alert) return '#F87171'
  if (props.tone === 'gold' && props.glow) return 'var(--color-gold)'
  if (props.tone === 'red') return '#F87171'
  return 'var(--color-text)'
})

const trendPositive = computed(() => typeof props.trend === 'number' && props.trend > 0)
</script>

<template>
  <component
    :is="to ? resolveComponent('NuxtLink') : 'div'"
    :to="to"
    class="block relative overflow-hidden transition-colors duration-150"
    :style="{
      containerType: 'inline-size',
      padding: '18px',
      background: alert ? 'rgba(239,68,68,0.04)' : 'var(--color-surface)',
      border: `1px solid ${alert ? 'rgba(239,68,68,0.35)' : 'var(--color-border)'}`,
      borderTop: `2px solid ${alert ? '#F87171' : accent}`,
      borderRadius: '14px',
      boxShadow: glow
        ? '0 0 24px rgba(245, 158, 11, 0.18), 0 1px 0 rgba(255,255,255,0.02) inset, 0 12px 32px -16px rgba(0,0,0,0.6)'
        : '0 1px 0 rgba(255,255,255,0.02) inset, 0 12px 32px -16px rgba(0,0,0,0.6)'
    }"
  >
    <div class="flex items-center gap-2 mb-3.5">
      <div
        v-if="icon"
        class="grid place-items-center"
        :style="{ width: '28px', height: '28px', borderRadius: '8px', background: iconBg, color: iconColor }"
      >
        <UIcon
          :name="icon"
          class="size-3.5"
        />
      </div>
      <span class="label-kicker">{{ label }}</span>
    </div>

    <div
      class="font-black tabular leading-none whitespace-nowrap overflow-hidden text-ellipsis"
      :style="{
        fontSize: 'clamp(16px, 8cqw, 32px)',
        letterSpacing: '-0.02em',
        color: valueColor,
      }"
    >
      {{ value }}
    </div>

    <div
      v-if="trend !== undefined || hint"
      class="mt-2 flex items-center gap-1.5 text-xs"
    >
      <span
        v-if="trend !== undefined"
        class="font-semibold inline-flex items-center gap-0.5"
        :style="{ color: trendPositive ? '#4ADE80' : '#F87171' }"
      >
        <UIcon
          :name="trendPositive ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down'"
          class="size-3"
        />
        {{ Math.abs(trend) }}%
      </span>
      <span
        v-if="hint"
        :style="{ color: 'var(--color-text-muted)' }"
      >
        {{ hint }}
      </span>
    </div>
  </component>
</template>

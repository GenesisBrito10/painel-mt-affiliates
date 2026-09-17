<script setup lang="ts">
const props = withDefaults(defineProps<{
  slug?: string
  name?: string | null
  logoUrl?: string | null
  size?: 'sm' | 'lg'
  showName?: boolean
}>(), {
  size: 'sm',
  showName: true
})

const HOUSE_COLORS: Record<string, string> = {
  superbet: '#E53E3E',
  betano: '#F05A28',
  kto: '#00D26A',
  stake: '#1FD05C',
  pixbet: '#7C3AED',
  betnacional: '#A78BFA',
  blaze: '#FF5E00',
  esportes: '#FBBF24',
  esportesnet: '#FBBF24'
}

const initials = computed(() => {
  const source = props.name || props.slug || '??'
  return source.split(/\s+/).map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
})

const swatchSize = computed(() => props.size === 'lg' ? 28 : 20)
const fontSizeNum = computed(() => Math.round(swatchSize.value * 0.42))
const swatchColor = computed(() => {
  const key = (props.slug || '').toLowerCase()
  return HOUSE_COLORS[key] || '#3F3F4D'
})

const displayName = computed(() => props.name || props.slug || '—')
</script>

<template>
  <div
    class="inline-flex items-center"
    :style="showName ? {
      gap: '8px',
      padding: '3px 10px 3px 4px',
      background: 'var(--color-surface-elevated)',
      border: '1px solid var(--color-border)',
      borderRadius: '999px'
    } : { gap: '8px', padding: '0' }"
  >
    <img
      v-if="logoUrl"
      :src="logoUrl"
      :alt="displayName"
      class="rounded-md object-contain shrink-0"
      :style="{ width: swatchSize + 'px', height: swatchSize + 'px', background: 'var(--color-surface-elevated)' }"
    >
    <div
      v-else
      class="grid place-items-center rounded-md font-extrabold shrink-0"
      :style="{
        width: swatchSize + 'px',
        height: swatchSize + 'px',
        fontSize: fontSizeNum + 'px',
        background: swatchColor,
        color: '#fff'
      }"
    >
      {{ initials }}
    </div>
    <span
      v-if="showName"
      class="text-[12px] font-semibold"
      style="color: var(--color-text)"
    >
      {{ displayName }}
    </span>
  </div>
</template>

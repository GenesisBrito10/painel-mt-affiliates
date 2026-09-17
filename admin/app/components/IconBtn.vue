<script setup lang="ts">
type Color = 'gold' | 'green' | 'red' | 'purple' | 'amber' | 'blue' | 'gray'

const props = withDefaults(defineProps<{
  title?: string
  color?: Color
  icon?: string
  to?: string
  disabled?: boolean
}>(), {
  color: 'gray',
  disabled: false
})

defineEmits<{ click: [MouseEvent] }>()

const COLOR_MAP: Record<Color, string> = {
  gold: 'var(--color-gold)',
  green: '#4ADE80',
  red: '#F87171',
  purple: '#A78BFA',
  amber: '#FBBF24',
  blue: '#A78BFA',
  gray: 'var(--color-text-secondary)'
}

const HOVER_BG: Record<Color, string> = {
  gold: 'rgba(245, 158, 11, 0.12)',
  green: 'rgba(74, 222, 128, 0.10)',
  red: 'rgba(248, 113, 113, 0.10)',
  purple: 'rgba(167, 139, 250, 0.10)',
  amber: 'rgba(251, 191, 36, 0.10)',
  blue: 'rgba(167, 139, 250, 0.10)',
  gray: 'rgba(255, 255, 255, 0.05)'
}

const colorVar = computed(() => COLOR_MAP[props.color])
const hoverBg = computed(() => HOVER_BG[props.color])

const btnStyle = computed(() => ({
  width: '30px',
  height: '30px',
  borderRadius: '8px',
  background: 'transparent',
  color: colorVar.value,
  opacity: props.disabled ? '0.4' : '1',
  cursor: props.disabled ? 'not-allowed' : 'pointer',
  display: 'grid',
  placeItems: 'center'
}))

function bgIn(e: Event) {
  ;(e.currentTarget as HTMLElement).style.background = hoverBg.value
}
function bgOut(e: Event) {
  ;(e.currentTarget as HTMLElement).style.background = 'transparent'
}
</script>

<template>
  <span class="tooltip-wrap">
    <NuxtLink
      v-if="to"
      :to="to"
      :style="btnStyle"
      class="transition-colors duration-150"
      @mouseenter="bgIn"
      @mouseleave="bgOut"
    >
      <UIcon
        v-if="icon"
        :name="icon"
        class="size-[14px]"
      />
      <slot />
    </NuxtLink>
    <button
      v-else
      :disabled="disabled"
      :style="btnStyle"
      class="transition-colors duration-150"
      @mouseenter="bgIn"
      @mouseleave="bgOut"
      @click="$emit('click', $event)"
    >
      <UIcon
        v-if="icon"
        :name="icon"
        class="size-[14px]"
      />
      <slot />
    </button>
    <span
      v-if="title"
      class="tooltip"
    >{{ title }}</span>
  </span>
</template>

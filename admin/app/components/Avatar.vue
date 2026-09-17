<script setup lang="ts">
defineOptions({ name: 'UserAvatar' })

const props = withDefaults(defineProps<{
  name?: string | null
  email?: string | null
  size?: number
  color?: 'gold' | 'purple'
}>(), {
  size: 32,
  color: 'purple'
})

const initials = computed(() => {
  const source = props.name || props.email || '??'
  return source.split(/\s+/).map(s => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
})

const bg = computed(() => props.color === 'gold' ? 'var(--color-gold)' : 'var(--color-purple)')
const fg = computed(() => '#fff')
</script>

<template>
  <div
    class="grid place-items-center rounded-full shrink-0"
    :style="{
      width: size + 'px',
      height: size + 'px',
      background: bg,
      color: fg,
      fontWeight: 800,
      fontSize: Math.round(size * 0.38) + 'px'
    }"
  >
    {{ initials }}
  </div>
</template>

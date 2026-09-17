<script setup lang="ts">
const props = withDefaults(defineProps<{
  size?: 'sm' | 'md' | 'lg' | 'sidebar'
  showSubtitle?: boolean
  subtitle?: string
  compact?: boolean
}>(), {
  size: 'md',
  showSubtitle: false,
  subtitle: 'Admin Console',
  compact: false
})

const iconSrc = computed(() =>
  '/vallex-favicon.ico'
)

const colorMode = useColorMode()

const logoSrc = computed(() =>
  colorMode.value === 'dark'
    ? '/vallex-logo-white.png'
    : '/vallex-logo-dark.png'
)

const logoClass = computed(() => {
  if (props.size === 'lg') return 'h-28 max-w-[26rem]'
  if (props.size === 'sidebar') return 'h-16 max-w-[13rem]'
  if (props.size === 'sm') return 'h-9 max-w-[9rem]'
  return 'h-12 max-w-[12rem]'
})
</script>

<template>
  <div class="vex-logo flex flex-col items-start gap-1.5">
    <img
      v-if="compact"
      :src="iconSrc"
      alt="Vallex Group"
      class="size-8 shrink-0 object-contain"
      width="32"
      height="32"
    >
    <img
      v-else
      :src="logoSrc"
      alt="Vallex Group"
      :class="['w-auto shrink-0 object-contain', logoClass]"
      width="1332"
      height="336"
    >
    <p
      v-if="showSubtitle"
      class="font-semibold uppercase"
      :style="{ fontSize: '10px', color: 'var(--color-text-muted)', letterSpacing: '0.14em' }"
    >
      {{ subtitle }}
    </p>
  </div>
</template>

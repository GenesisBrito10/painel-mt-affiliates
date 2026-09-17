<script setup lang="ts">
/**
 * Logotipo oficial — Vallex Group.
 * Usa GROUP branco em fundos escuros e GROUP preto em fundos claros.
 */
const props = defineProps<{
  hideText?: boolean
  variant?: 'dark' | 'auto'
  size?: 'sm' | 'md' | 'lg' | 'sidebar' | 'mobile'
}>()

const iconSrc = computed(() => '/vallex-favicon.ico')
const colorMode = useColorMode()

const logoSrc = computed(() => {
  if (props.variant === 'dark') return '/vallex-logo-white.png'
  return colorMode.value === 'dark'
    ? '/vallex-logo-white.png'
    : '/vallex-logo-dark.png'
})

const logoClass = computed(() => {
  if (props.size === 'lg') return 'h-28 max-w-[26rem]'
  if (props.size === 'sm') return 'h-9 max-w-[9rem]'
  if (props.size === 'sidebar') return 'h-16 max-w-[13rem]'
  if (props.size === 'mobile') return 'h-12 max-w-[9.5rem]'
  return 'h-11 max-w-[11rem]'
})
</script>

<template>
  <div class="flex items-center shrink-0">
    <img
      v-if="hideText"
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
  </div>
</template>

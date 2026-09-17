<script setup lang="ts">
/**
 * Logotipo oficial — MT Affiliates.
 */
const props = defineProps<{
  hideText?: boolean
  variant?: 'dark' | 'auto'
  size?: 'sm' | 'md' | 'lg' | 'sidebar' | 'mobile'
}>()

const iconSrc = '/mt-affiliates-mark.png'
const logoSrc = '/mt-affiliates-logo.png'

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
      alt="MT Affiliates"
      class="size-8 shrink-0 object-contain"
      width="32"
      height="32"
    >
    <img
      v-else
      :src="logoSrc"
      alt="MT Affiliates"
      :class="['w-auto shrink-0 object-contain', logoClass]"
      width="2172"
      height="724"
    >
  </div>
</template>

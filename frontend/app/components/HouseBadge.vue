<script setup lang="ts">
const props = defineProps<{
  slug: string
  size?: 'xs' | 'sm' | 'md'
}>()

const { getLogoUrl, getHouseName } = useHouseFilter()

const logoUrl = computed(() => getLogoUrl(props.slug))
const name = computed(() => getHouseName(props.slug))

const imgClass = computed(() => {
  if (props.size === 'xs') return 'h-3.5 sm:h-4 max-w-[4.5rem] sm:max-w-[5.5rem]'
  if (props.size === 'md') return 'h-6 sm:h-7 max-w-[8rem] sm:max-w-[10rem]'
  return 'h-4 sm:h-5 max-w-[6rem] sm:max-w-[7.5rem]'
})

const textClass = computed(() => {
  if (props.size === 'xs') return 'text-[10px]'
  if (props.size === 'md') return 'text-sm'
  return 'text-xs'
})
</script>

<template>
  <img
    v-if="logoUrl"
    :src="logoUrl"
    :alt="name"
    :class="imgClass"
    class="object-contain object-left w-auto shrink-0 inline-block align-middle"
  >
  <span v-else :class="textClass" class="font-semibold truncate align-middle">{{ name }}</span>
</template>

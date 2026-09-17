<script setup lang="ts">
defineProps<{
  text: string
}>()
</script>

<template>
  <UTooltip :text="text" :popper="{ placement: 'top' }">
    <UIcon name="i-heroicons-information-circle" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-help w-4 h-4 ml-1" />
  </UTooltip>
</template>

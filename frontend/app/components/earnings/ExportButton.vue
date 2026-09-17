<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  exportFn: () => Promise<void>
}>()

const isExporting = ref(false)

const handleExport = async () => {
  isExporting.value = true
  try {
    await props.exportFn()
  } finally {
    isExporting.value = false
  }
}
</script>

<template>
  <UButton
    icon="i-heroicons-arrow-down-tray"
    color="neutral"
    variant="solid"
    :loading="isExporting"
    @click="handleExport"
  >
    Exportar CSV
  </UButton>
</template>

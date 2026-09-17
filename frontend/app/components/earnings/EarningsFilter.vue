<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  modelValue: {
    eventType?: string
    bettingHouse?: string
    dateRange?: { start: Date, end: Date }
  }
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: any): void
}>()

const localFilters = ref({ ...props.modelValue })

const eventTypes = [
  { label: 'Todos os Tipos', value: '' },
  { label: 'CPA', value: 'CPA' },
  { label: 'RevShare', value: 'REVSHARE' },
  { label: 'Saques Aprovados', value: 'WITHDRAWAL_APPROVED' },
  { label: 'Saques Pendentes', value: 'WITHDRAWAL_PENDING' },
  { label: 'Fraudes', value: 'FRAUD_DEDUCTION' },
  { label: 'Bônus', value: 'BONUS' },
]

watch(localFilters, (newVal) => {
  emit('update:modelValue', newVal)
}, { deep: true })
</script>

<template>
  <div class="flex flex-col sm:flex-row gap-4">
    <USelectMenu
      v-model="localFilters.eventType"
      :options="eventTypes"
      value-attribute="value"
      option-attribute="label"
      placeholder="Tipo de Movimentação"
      class="w-full sm:w-64"
    />
    
    <UInput
      v-model="localFilters.bettingHouse"
      placeholder="Filtrar por Casa de Aposta"
      icon="i-heroicons-magnifying-glass"
      class="w-full sm:w-64"
    />
    
    <!-- Nuxt UI DatePicker can be added here if needed, 
         using a simple reset button for now to clear filters -->
    <UButton 
      v-if="localFilters.eventType || localFilters.bettingHouse"
      color="neutral" 
      variant="ghost" 
      icon="i-heroicons-x-mark"
      @click="localFilters = { eventType: '', bettingHouse: '' }"
    >
      Limpar
    </UButton>
  </div>
</template>

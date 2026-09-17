<script setup lang="ts">
import type { PerHouseBalance } from '~/types/earnings'

defineProps<{
  houses: PerHouseBalance[]
}>()

const formatCurrency = (val: number) => {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val)
}
</script>

<template>
  <div class="space-y-4">
    <h3 class="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
      Ganhos por Casa
      <EarningsInfoTooltip text="Detalhamento de ganhos segmentados pelas casas de aposta (apenas ganhos diretos)." />
    </h3>

    <div v-if="!houses || houses.length === 0" class="text-center py-8 text-gray-500">
      Nenhum ganho registrado por casa de aposta.
    </div>

    <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      <UCard 
        v-for="house in houses" 
        :key="house.houseId" 
        class="bg-white dark:bg-gray-800 transition-all hover:shadow-md"
      >
        <div class="flex justify-between items-start mb-4">
          <div class="font-medium text-gray-900 dark:text-white"><HouseBadge :slug="house.houseId" size="sm" /></div>
          <UBadge color="neutral" variant="soft">{{ formatCurrency(house.total) }}</UBadge>
        </div>
        
        <div class="space-y-2 text-sm text-gray-600 dark:text-gray-400">
          <div class="flex justify-between">
            <span>CPA ({{ house.cpaCount }} conv.)</span>
            <span class="font-medium text-gray-900 dark:text-gray-200">{{ formatCurrency(house.cpa) }}</span>
          </div>
          <div class="flex justify-between">
            <span>RevShare ({{ house.ftdCount }} FTDs)</span>
            <span class="font-medium text-gray-900 dark:text-gray-200">{{ formatCurrency(house.revshare) }}</span>
          </div>
        </div>
      </UCard>
    </div>
  </div>
</template>

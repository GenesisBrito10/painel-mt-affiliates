<script setup lang="ts">
import type { EarningsLedger } from '~/types/earnings'

defineProps<{
  ledger: EarningsLedger | null
  loading: boolean
}>()

const emit = defineEmits<{
  (e: 'page-change', page: number): void
}>()
</script>

<template>
  <div class="space-y-4">
    <div v-if="loading" class="space-y-3">
      <USkeleton class="h-20 w-full" v-for="i in 5" :key="i" />
    </div>

    <div v-else-if="!ledger || ledger.data.length === 0" class="text-center py-12 text-gray-500 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
      Nenhuma movimentação financeira encontrada para este período.
    </div>

    <div v-else>
      <UCard :ui="{ body: 'p-0' }" class="overflow-hidden">
        <div class="divide-y divide-gray-200 dark:divide-gray-800">
          <EarningsLedgerEntry 
            v-for="entry in ledger.data" 
            :key="entry.id" 
            :entry="entry" 
          />
        </div>
      </UCard>

      <div class="mt-4 flex justify-between items-center" v-if="ledger.total > ledger.limit">
        <div class="text-sm text-gray-500">
          Mostrando {{ (ledger.page - 1) * ledger.limit + 1 }} - 
          {{ Math.min(ledger.page * ledger.limit, ledger.total) }} 
          de {{ ledger.total }}
        </div>
        <UPagination 
          :model-value="ledger.page" 
          :total="ledger.total" 
          :page-count="ledger.limit"
          @update:model-value="emit('page-change', $event)" 
        />
      </div>
    </div>
  </div>
</template>

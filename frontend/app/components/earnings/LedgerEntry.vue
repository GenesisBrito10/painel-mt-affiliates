<script setup lang="ts">
import type { EarningsLedgerItem } from '~/types/earnings'

const props = defineProps<{
  entry: EarningsLedgerItem
}>()

const formatCurrency = (val: number) => {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Math.abs(val))
}

const formatDate = (dateStr: string) => {
  return new Intl.DateTimeFormat('pt-BR', { 
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(new Date(dateStr))
}

const isCredit = computed(() => props.entry.amount > 0)
const amountClass = computed(() => {
  if (props.entry.amount > 0) return 'text-green-600 dark:text-green-400'
  if (props.entry.amount < 0) return 'text-red-600 dark:text-red-400'
  return 'text-gray-500'
})
const amountPrefix = computed(() => props.entry.amount > 0 ? '+' : (props.entry.amount < 0 ? '-' : ''))
</script>

<template>
  <div class="flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
    <div class="flex items-start space-x-4">
      <div class="mt-1">
        <UIcon v-if="isCredit" name="i-heroicons-arrow-trending-up" class="text-green-500 w-5 h-5" />
        <UIcon v-else name="i-heroicons-arrow-trending-down" class="text-red-500 w-5 h-5" />
      </div>
      <div>
        <div class="font-medium text-gray-900 dark:text-white flex items-center space-x-2">
          <span>{{ entry.eventLabel }}</span>
          <EarningsStatusBadge :eventType="entry.eventType" class="scale-90 origin-left" />
        </div>
        <div class="text-xs text-gray-500 dark:text-gray-400 mt-1 flex flex-wrap gap-x-3 gap-y-1">
          <span>{{ formatDate(entry.date) }}</span>
          <span v-if="entry.bettingHouse">&bull; {{ entry.bettingHouse }}</span>
          <span v-if="entry.sourceName">&bull; {{ entry.sourceName }}</span>
        </div>
      </div>
    </div>
    <div class="text-right ml-4">
      <div :class="['font-bold text-lg', amountClass]">
        {{ amountPrefix }}{{ formatCurrency(entry.amount) }}
      </div>
      <div class="text-[10px] text-gray-400 uppercase tracking-wider mt-1">
        ID: {{ entry.id.substring(0, 8) }}...
      </div>
    </div>
  </div>
</template>

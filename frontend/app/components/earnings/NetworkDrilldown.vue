<script setup lang="ts">
import { ref } from 'vue'
import type { EarningsNetwork } from '~/types/earnings'

const props = defineProps<{
  networkData: EarningsNetwork | null
  loading: boolean
}>()

const isOpen = ref(false)

const openDrilldown = () => {
  isOpen.value = true
}

defineExpose({
  openDrilldown,
})

const formatCurrency = (val: number) => {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val)
}
</script>

<template>
  <USlideover v-model="isOpen">
    <UCard class="flex flex-col flex-1 ring-0 divide-y divide-gray-100 dark:divide-gray-800" :ui="{ body: 'flex-1 overflow-y-auto' }">
      <template #header>
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-base font-semibold leading-6 text-gray-900 dark:text-white">
              Sua Rede de Afiliados
            </h3>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Ganhos detalhados por membro da rede.
            </p>
          </div>
          <UButton color="neutral" variant="ghost" icon="i-heroicons-x-mark-20-solid" class="-my-1" @click="isOpen = false" />
        </div>
      </template>

      <div v-if="loading" class="space-y-4">
        <USkeleton class="h-24 w-full" v-for="i in 3" :key="i" />
      </div>

      <div v-else-if="!networkData || networkData.members.length === 0" class="text-center py-12 text-gray-500">
        Nenhum membro ativo encontrado na sua rede.
      </div>

      <div v-else class="space-y-4">
        <!-- Resumo -->
        <div class="grid grid-cols-2 gap-3 rounded-lg bg-gray-50 p-4 dark:bg-gray-800/50">
          <div>
            <div class="text-xs text-gray-500">Ganho Líquido</div>
            <div class="text-xl font-bold text-gray-900 dark:text-white">{{ formatCurrency(networkData.totalNetworkEarnings) }}</div>
          </div>
          <div>
            <div class="text-xs text-gray-500">Ganho Bruto</div>
            <div class="text-xl font-bold text-gray-900 dark:text-white">{{ formatCurrency(networkData.grossNetworkEarnings) }}</div>
          </div>
          <div>
            <div class="text-xs text-gray-500">Membros</div>
            <div class="text-xl font-bold text-gray-900 dark:text-white">{{ networkData.totalMembers }}</div>
          </div>
          <div>
            <div class="text-xs text-gray-500">Fraudes</div>
            <div class="text-xl font-bold text-red-600 dark:text-red-400">-{{ formatCurrency(networkData.totalFraudDeduction) }}</div>
          </div>
        </div>

        <!-- Lista de membros -->
        <div class="space-y-3 mt-4">
          <EarningsNetworkMemberCard 
            v-for="member in networkData.members" 
            :key="member.memberId" 
            :member="member" 
          />
        </div>
      </div>
    </UCard>
  </USlideover>
</template>

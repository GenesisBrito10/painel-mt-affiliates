<script setup lang="ts">
import type { EarningsOverview } from '~/types/earnings'

defineProps<{
  overview: EarningsOverview
}>()

const formatCurrency = (val: number) => {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val)
}
</script>

<template>
  <div class="space-y-6">
    <h3 class="text-lg font-semibold text-gray-900 dark:text-white flex items-center">
      Composição do Saldo Disponível
      <EarningsInfoTooltip text="Veja exatamente como seu saldo final é calculado, etapa por etapa." />
    </h3>

    <div class="grid grid-cols-1 md:grid-cols-5 gap-4">
      
      <!-- Gross Total -->
      <UCard class="bg-gray-50 dark:bg-gray-800/50">
        <div class="flex flex-col h-full justify-between">
          <div>
            <div class="text-sm text-gray-500 dark:text-gray-400 flex items-center">
              Ganhos Totais
              <EarningsInfoTooltip text="Soma de todos os ganhos (CPA próprio, RevShare, Rede e Bônus)" />
            </div>
            <div class="text-2xl font-bold text-gray-900 dark:text-white mt-1">
              {{ formatCurrency(overview.formula.grossTotal) }}
            </div>
          </div>
          <div class="mt-4 space-y-1 text-xs text-gray-500 dark:text-gray-400">
            <div class="flex justify-between">
              <span>Seu CPA:</span>
              <span class="font-medium text-gray-700 dark:text-gray-300">{{ formatCurrency(overview.formula.ownCpa) }}</span>
            </div>
            <div class="flex justify-between">
              <span>Seu RevShare:</span>
              <span class="font-medium text-gray-700 dark:text-gray-300">{{ formatCurrency(overview.formula.ownRevshare) }}</span>
            </div>
            <div class="flex justify-between">
              <span>CPA da Rede:</span>
              <span class="font-medium text-gray-700 dark:text-gray-300">{{ formatCurrency(overview.formula.networkCpa) }}</span>
            </div>
            <div class="flex justify-between">
              <span>RevShare da Rede:</span>
              <span class="font-medium text-gray-700 dark:text-gray-300">{{ formatCurrency(overview.formula.networkRevshare) }}</span>
            </div>
            <div class="flex justify-between" v-if="overview.formula.bonusBalance > 0">
              <span>Bônus:</span>
              <span class="font-medium text-green-600 dark:text-green-400">+{{ formatCurrency(overview.formula.bonusBalance) }}</span>
            </div>
          </div>
        </div>
      </UCard>

      <!-- Minus symbol -->
      <div class="hidden md:flex items-center justify-center">
        <UIcon name="i-heroicons-minus" class="w-8 h-8 text-gray-400" />
      </div>

      <!-- Deductions (Fraud & Withdrawals) -->
      <UCard class="bg-red-50/50 dark:bg-red-900/10 ring-1 ring-red-200 dark:ring-red-900/30">
        <div class="flex flex-col h-full justify-between">
          <div>
            <div class="text-sm text-red-600 dark:text-red-400 flex items-center">
              Descontos & Saques
              <EarningsInfoTooltip text="Valores subtraídos do seu total, incluindo saques (aprovados e pendentes) e bloqueios por fraude." />
            </div>
            <div class="text-2xl font-bold text-red-700 dark:text-red-300 mt-1">
              -{{ formatCurrency(overview.formula.totalFraudDeduction + overview.formula.withdrawalsApproved + overview.formula.withdrawalsPending) }}
            </div>
          </div>
          <div class="mt-4 space-y-1 text-xs text-red-500/80 dark:text-red-400/80">
            <div class="flex justify-between">
              <span>Saques Aprovados:</span>
              <span class="font-medium">{{ formatCurrency(overview.formula.withdrawalsApproved) }}</span>
            </div>
            <div class="flex justify-between">
              <span>Saques Pendentes:</span>
              <span class="font-medium">{{ formatCurrency(overview.formula.withdrawalsPending) }}</span>
            </div>
            <div class="flex justify-between">
              <span>Fraude Direta:</span>
              <span class="font-medium">{{ formatCurrency(overview.formula.fraudDeductionDirect) }}</span>
            </div>
            <div class="flex justify-between">
              <span>Fraude da Rede:</span>
              <span class="font-medium">{{ formatCurrency(overview.formula.fraudDeductionNetwork) }}</span>
            </div>
          </div>
        </div>
      </UCard>

      <!-- Equals symbol -->
      <div class="hidden md:flex items-center justify-center">
        <UIcon name="i-heroicons-equals" class="w-8 h-8 text-gray-400" />
      </div>

      <!-- Net Balance -->
      <UCard class="bg-primary-50 dark:bg-primary-900/10 ring-1 ring-primary-200 dark:ring-primary-900/30">
        <div class="flex flex-col h-full justify-between">
          <div>
            <div class="text-sm text-primary-600 dark:text-primary-400 font-medium flex items-center">
              Saldo Líquido Atual
              <EarningsInfoTooltip text="Seu saldo final após todos os descontos. Taxas de saque serão descontadas deste valor no momento da solicitação." />
            </div>
            <div class="text-3xl font-bold text-primary-700 dark:text-primary-300 mt-2">
              {{ formatCurrency(overview.formula.netBalance) }}
            </div>
          </div>
          <div class="mt-4 text-xs text-primary-600/80 dark:text-primary-400/80">
            * Taxa de saque atual: {{ overview.formula.withdrawalFeeRate }}% (mín: {{ formatCurrency(overview.formula.withdrawalFee) }})
          </div>
        </div>
      </UCard>

    </div>
  </div>
</template>

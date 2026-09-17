<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  status?: string
  eventType?: string
}>()

const badgeColor = computed(() => {
  const val = props.status || props.eventType
  if (!val) return 'neutral'
  
  switch (val) {
    case 'APPROVED':
    case 'WITHDRAWAL_APPROVED':
    case 'CPA':
    case 'REVSHARE':
    case 'BONUS':
      return 'success'
    case 'PENDING':
    case 'WITHDRAWAL_PENDING':
      return 'warning'
    case 'REJECTED':
    case 'WITHDRAWAL_REJECTED':
    case 'FRAUD_DEDUCTION':
    case 'BLOCKED':
      return 'error'
    case 'MANUAL_ADJUSTMENT':
      return 'info'
    default:
      return 'neutral'
  }
})

const badgeLabel = computed(() => {
  const val = props.status || props.eventType
  if (!val) return 'Desconhecido'

  const labels: Record<string, string> = {
    APPROVED: 'Aprovado',
    PENDING: 'Pendente',
    REJECTED: 'Rejeitado',
    BLOCKED: 'Bloqueado',
    WITHDRAWAL_APPROVED: 'Saque Aprovado',
    WITHDRAWAL_PENDING: 'Saque Pendente',
    WITHDRAWAL_REJECTED: 'Saque Rejeitado',
    CPA: 'CPA',
    REVSHARE: 'RevShare',
    FRAUD_DEDUCTION: 'Desconto Fraude',
    BONUS: 'Bônus',
    MANUAL_ADJUSTMENT: 'Ajuste Manual',
  }

  return labels[val] || val
})
</script>

<template>
  <UBadge :color="badgeColor" variant="soft">
    {{ badgeLabel }}
  </UBadge>
</template>

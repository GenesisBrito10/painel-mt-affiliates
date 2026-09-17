<script setup lang="ts">
type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'gold'

const props = withDefaults(defineProps<{
  status: string
  label?: string
  size?: 'xs' | 'sm'
}>(), {
  size: 'sm'
})

const STATUS_MAP: Record<string, { tone: Tone, label: string }> = {
  APPROVED: { tone: 'success', label: 'Aprovado' },
  ACTIVE: { tone: 'success', label: 'Ativo' },
  ACTIVATED: { tone: 'success', label: 'Ativo' },
  PAID: { tone: 'success', label: 'Pago' },
  COMPLETED: { tone: 'success', label: 'Concluído' },
  SUCCESS: { tone: 'success', label: 'Sucesso' },

  PENDING: { tone: 'warning', label: 'Pendente' },
  PROCESSING: { tone: 'info', label: 'Processando' },
  IN_PROGRESS: { tone: 'info', label: 'Em andamento' },
  REVIEW: { tone: 'warning', label: 'Em análise' },

  REJECTED: { tone: 'danger', label: 'Rejeitado' },
  BLOCKED: { tone: 'danger', label: 'Bloqueado' },
  ERROR: { tone: 'danger', label: 'Erro' },
  FAILED: { tone: 'danger', label: 'Falhou' },
  CANCELLED: { tone: 'danger', label: 'Cancelado' },
  CANCELED: { tone: 'danger', label: 'Cancelado' },

  INACTIVE: { tone: 'neutral', label: 'Inativo' },
  DISABLED: { tone: 'neutral', label: 'Desativado' },
  DRAFT: { tone: 'neutral', label: 'Rascunho' },

  HIGHLIGHT: { tone: 'gold', label: 'Destaque' }
}

const TONE_CLASSES: Record<Tone, string> = {
  success: 'bg-green-500/15 text-green-400 ring-green-500/20',
  warning: 'bg-amber-500/15 text-amber-400 ring-amber-500/25',
  danger: 'bg-red-500/15 text-red-400 ring-red-500/25',
  info: 'bg-violet-500/15 text-violet-400 ring-violet-500/25',
  neutral: 'bg-white/5 text-[var(--color-text-secondary)] ring-white/10',
  gold: 'bg-[var(--color-gold)]/15 text-[var(--color-gold)] ring-[var(--color-gold)]/30'
}

const DOT_CLASSES: Record<Tone, string> = {
  success: 'bg-green-400',
  warning: 'bg-amber-400',
  danger: 'bg-red-400',
  info: 'bg-violet-400',
  neutral: 'bg-zinc-500',
  gold: 'bg-[var(--color-gold)]'
}

const resolved = computed(() => {
  const key = (props.status || '').toUpperCase().trim()
  return STATUS_MAP[key] || { tone: 'neutral' as Tone, label: props.status || '—' }
})

const sizeClass = computed(() =>
  props.size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'
)
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full font-bold uppercase tracking-wider ring-1 ring-inset"
    :class="[TONE_CLASSES[resolved.tone], sizeClass]"
  >
    <span
      class="size-1.5 rounded-full"
      :class="DOT_CLASSES[resolved.tone]"
    />
    {{ label || resolved.label }}
  </span>
</template>

<script setup lang="ts">
/**
 * ApprovalModal — aprova um afiliado. Só APROVAR (sem acordo/comissão). O deal
 * (CPA/RevShare) é definido depois, à parte — não faz parte da aceitação.
 * Props referrerLinks/loadingLinks e o emit select-link são mantidos por
 * compatibilidade com o pai (não usados mais).
 */
import type { AdminAffiliateEntry, ApprovalFormState, ReferrerLink } from '~/types/affiliates'

const open = defineModel<boolean>('open', { required: true })

defineProps<{
  target: AdminAffiliateEntry | null
  form: ApprovalFormState
  referrerLinks: ReferrerLink[]
  loadingLinks: boolean
}>()

const emit = defineEmits<{
  submit: []
  'select-link': [link: ReferrerLink]
}>()
</script>

<template>
  <UModal v-model:open="open" title="Aprovar afiliado" class="sm:max-w-md">
    <template #body>
      <div class="space-y-4">
        <!-- ── Quem está sendo aprovado ── -->
        <div
          class="flex items-center gap-3 rounded-xl p-3"
          style="background: var(--vex-surface-elevated); border: 1px solid var(--vex-border-subtle)"
        >
          <div
            class="size-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
            style="background: color-mix(in srgb, var(--vex-brand) 15%, transparent); color: var(--vex-brand)"
          >
            {{ (target?.name ?? 'A')[0]?.toUpperCase() }}
          </div>
          <div class="min-w-0">
            <p class="font-semibold text-[13px] truncate" style="color: var(--vex-text)">{{ target?.name || 'Afiliado' }}</p>
            <p class="text-[11px] truncate" style="color: var(--vex-text-faint)">{{ target?.email }}</p>
          </div>
          <UBadge label="Pendente" color="warning" variant="subtle" size="xs" class="ml-auto shrink-0" />
        </div>

        <p class="text-[12px]" style="color: var(--vex-text-muted)">
          Deseja aprovar este afiliado? O acordo/comissão é definido depois, à parte.
        </p>
      </div>
    </template>

    <template #footer>
      <div class="w-full flex items-center justify-end gap-2">
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="open = false" />
        <UButton
          label="Confirmar Aprovação"
          color="success"
          icon="i-lucide-check-circle-2"
          @click="emit('submit')"
        />
      </div>
    </template>
  </UModal>
</template>

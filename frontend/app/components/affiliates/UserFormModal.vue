<script setup lang="ts">
/**
 * UserFormModal — Create/edit user modal.
 * On create: name + email + password.
 * On edit: identity data + current agreements + withdrawal block control.
 */
import type { AdminAffiliateMembership } from '~/types/affiliates'

const open = defineModel<boolean>('open', { required: true })

defineProps<{
  mode: 'create' | 'edit'
  loadingProfile?: boolean
  form: {
    name: string
    email: string
    password: string
    role: 'affiliate' | 'admin'
    withdrawalBlocked: boolean
    balanceBlockReason: string
    memberships: AdminAffiliateMembership[]
  }
}>()

const emit = defineEmits<{
  save: []
}>()

const roleOptions = [
  { label: 'Afiliado', value: 'affiliate' },
  { label: 'Admin', value: 'admin' },
]

function formatCurrency(value: number | null | undefined) {
  if (!value) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function formatPercent(value: number | null | undefined) {
  if (!value) return '—'
  return `${value}%`
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="mode === 'create' ? 'Novo usuário' : 'Editar usuário'"
    :description="mode === 'create' ? 'Cria conta global. Vínculos são configurados na aprovação.' : 'Atualiza dados, acordos e bloqueio de saque.'"
    :ui="{ content: mode === 'edit' ? 'sm:max-w-2xl' : 'sm:max-w-md' }"
  >
    <template #body>
      <div class="space-y-4">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <UFormField label="Nome" class="md:col-span-2">
            <UInput v-model="form.name" size="sm" placeholder="Nome completo" class="w-full" />
          </UFormField>

          <UFormField label="E-mail" class="md:col-span-2">
            <UInput
              v-model="form.email"
              type="email"
              size="sm"
              placeholder="email@dominio.com"
              :disabled="mode === 'edit'"
              class="w-full"
            />
          </UFormField>

          <UFormField v-if="mode === 'create'" label="Senha" class="md:col-span-2">
            <UInput
              v-model="form.password"
              type="password"
              size="sm"
              placeholder="Mínimo 6 caracteres"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Papel">
            <USelect v-model="form.role" :items="roleOptions" size="sm" :disabled="mode === 'edit'" />
          </UFormField>
        </div>

        <template v-if="mode === 'edit'">
          <div
            class="rounded-lg border p-3 space-y-3"
            style="border-color: var(--vex-border-subtle); background: var(--vex-surface-strong)"
          >
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="text-[12px] font-bold" style="color: var(--vex-text)">Casas e acordos</p>
                <p class="text-[11px]" style="color: var(--vex-text-faint)">Vínculos ativos do afiliado.</p>
              </div>
              <UIcon
                v-if="loadingProfile"
                name="i-lucide-loader-circle"
                class="animate-spin text-[18px]"
                style="color: var(--vex-brand)"
              />
            </div>

            <div v-if="form.memberships.length" class="space-y-2">
              <div
                v-for="membership in form.memberships"
                :key="membership.id"
                class="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] items-center gap-2 rounded-md border px-3 py-2"
                style="border-color: var(--vex-border-subtle); background: var(--vex-surface)"
              >
                <div class="min-w-0">
                  <HouseBadge :slug="membership.bettingHouse" size="sm" />
                  <p class="mt-1 truncate text-[11px]" style="color: var(--vex-text-faint)">
                    {{ membership.campaignId || 'Sem campanha vinculada' }}
                  </p>
                </div>
                <div>
                  <p class="text-[10px] font-bold uppercase" style="color: var(--vex-text-faint)">CPA</p>
                  <p class="font-money text-[12px]" style="color: var(--vex-text)">{{ formatCurrency(membership.commissionCpa) }}</p>
                </div>
                <div>
                  <p class="text-[10px] font-bold uppercase" style="color: var(--vex-text-faint)">RevShare</p>
                  <p class="font-money text-[12px]" style="color: var(--vex-text)">{{ formatPercent(membership.commissionRevshare) }}</p>
                </div>
              </div>
            </div>

            <p v-else class="rounded-md px-3 py-2 text-[12px]" style="background: var(--vex-bg-muted); color: var(--vex-text-faint)">
              Nenhuma casa ou acordo ativo encontrado para este usuário.
            </p>
          </div>

          <div
            class="rounded-lg border p-3 space-y-3"
            style="border-color: var(--vex-border-subtle); background: var(--vex-surface-strong)"
          >
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="text-[12px] font-bold" style="color: var(--vex-text)">Bloquear saque</p>
                <p class="text-[11px]" style="color: var(--vex-text-faint)">Impede novas solicitações de saque deste afiliado.</p>
              </div>
              <USwitch v-model="form.withdrawalBlocked" />
            </div>

            <UFormField v-if="form.withdrawalBlocked" label="Motivo do bloqueio">
              <UTextarea
                v-model="form.balanceBlockReason"
                :rows="3"
                maxlength="500"
                placeholder="Opcional"
                class="w-full"
              />
            </UFormField>
          </div>
        </template>
      </div>
    </template>
    <template #footer>
      <div class="w-full flex justify-end gap-2">
        <UButton label="Cancelar" color="neutral" variant="ghost" @click="open = false" />
        <UButton
          :label="mode === 'create' ? 'Criar usuário' : 'Salvar alterações'"
          color="primary"
          icon="i-lucide-save"
          @click="emit('save')"
        />
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
/**
 * InvitedList — Grid of invited affiliate cards with actions.
 */
import type { UserStatus } from '~/composables/useAffiliates'

interface InvitedUser {
  id: string
  name: string
  email: string
  status: UserStatus
  active: boolean
  panel: string
  createdAt: string
  isExternal?: boolean
  externalId?: string | null
  level: number
  affiliateLinks: Array<{ bettingHouse: string; affiliateId: string; affiliateName: string; cpa: number; revshare: number }>
}

const props = defineProps<{
  users: InvitedUser[]
  statusLabel: (s: UserStatus) => string
  statusColor: (s: UserStatus) => 'warning' | 'success' | 'error'
  formatDate: (v: string) => string
  formatCurrency: (v: number) => string
  formatHouseLabel: (v: string) => string
}>()

const emit = defineEmits<{
  approve: [id: string]
  reject: [id: string]
}>()
</script>

<template>
  <div v-if="users.length" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
    <article
      v-for="invited in users"
      :key="invited.id"
      class="vex-card p-4"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="font-semibold text-[13px] truncate" style="color: var(--vex-text)">{{ invited.name }}</p>
          <p class="text-[11px] truncate" style="color: var(--vex-text-faint)">{{ invited.email }}</p>
        </div>
        <div class="flex shrink-0 flex-wrap items-center justify-end gap-1">
          <UBadge
            :label="`Nível ${invited.level}`"
            :color="invited.level === 1 ? 'primary' : 'info'"
            variant="soft"
            size="sm"
            icon="i-lucide-git-branch"
          />
          <UBadge v-if="invited.isExternal" label="Externo" color="neutral" variant="subtle" size="sm" icon="i-lucide-plug" />
          <UBadge :label="statusLabel(invited.status)" :color="statusColor(invited.status)" variant="subtle" size="sm" />
        </div>
      </div>

      <div class="mt-3 flex flex-wrap gap-1">
        <span
          v-for="link in invited.affiliateLinks"
          :key="`${invited.id}-${link.bettingHouse}`"
          class="inline-flex items-center gap-1 max-w-full text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap"
          style="background: var(--vex-bg-muted); color: var(--vex-text-muted)"
        >
          <HouseBadge :slug="link.bettingHouse" size="xs" />
          <span class="opacity-70">· CPA {{ link.cpa ? formatCurrency(link.cpa) : '—' }} · Rev {{ link.revshare ? `${link.revshare}%` : '—' }}</span>
        </span>
        <span
          v-if="!invited.affiliateLinks.length"
          class="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded font-medium"
          style="background: var(--vex-warning-light); color: var(--vex-warning)"
        >
          Sem vínculo
        </span>
      </div>

      <div class="mt-4 flex items-center justify-between gap-2">
        <p class="text-[10px]" style="color: var(--vex-text-faint)">Criado em {{ formatDate(invited.createdAt) }}</p>
        <div v-if="invited.status === 'pending'" class="flex items-center gap-1.5">
          <UButton size="xs" color="success" variant="soft" icon="i-lucide-check" label="Aprovar" @click="emit('approve', invited.id)" />
          <UButton size="xs" color="error" variant="soft" icon="i-lucide-x" label="Recusar" @click="emit('reject', invited.id)" />
        </div>
      </div>
    </article>
  </div>

  <div v-else class="vex-card py-14 flex flex-col items-center justify-center text-center">
    <div class="vex-icon-badge mb-3" style="width: 2.5rem; height: 2.5rem">
      <UIcon name="i-lucide-users-round" class="size-5" />
    </div>
    <h3 class="text-sm font-bold" style="color: var(--vex-text)">Nenhum convidado encontrado</h3>
    <p class="text-[11px] max-w-sm mt-1" style="color: var(--vex-text-faint)">Ajuste os filtros ou compartilhe seu link de convite.</p>
  </div>
</template>

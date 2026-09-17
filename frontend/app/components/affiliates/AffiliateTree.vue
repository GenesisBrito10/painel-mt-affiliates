<script setup lang="ts">
/**
 * AffiliateTree — Flat table view showing all network levels at once.
 * All members (level 1, 2, 3) are visible without expand/collapse.
 */
import type { NetworkFlatMember, UserStatus } from '~/composables/useAffiliates'

const props = defineProps<{
  tree: NetworkFlatMember[]
  rootName: string
  rootEmail: string
  statusLabel: (s: UserStatus) => string
  statusColor: (s: UserStatus) => 'warning' | 'success' | 'error'
  formatCurrency: (v: number) => string
  formatHouseLabel: (v: string) => string
  /** Hide server-side pagination when search mode is active (all results are loaded) */
  searchActive?: boolean
  /** Server-side pagination */
  currentPage?: number
  total?: number
  pageSize?: number
}>()

const emit = defineEmits<{
  'update:page': [page: number]
  approve: [id: string]
}>()

const _total = computed(() => props.total ?? props.tree.length)
const _pageSize = computed(() => props.pageSize ?? 20)
const _page = computed(() => props.currentPage ?? 1)
// Hide pagination when searching — all results are already loaded client-side
const hasMultiplePages = computed(() => !props.searchActive && _total.value > _pageSize.value)

const levelLabel: Record<number, string> = { 1: 'N1', 2: 'N2', 3: 'N3' }
const levelStyle: Record<number, string> = {
  1: 'background: var(--vex-brand-muted); color: var(--vex-brand)',
  2: 'background: var(--vex-positive-light); color: var(--vex-positive)',
  3: 'background: var(--vex-warning-light); color: var(--vex-warning)',
}
</script>

<template>
  <div class="vex-card overflow-hidden">
    <!-- Root banner -->
    <div
      class="px-4 py-3 flex items-center gap-3"
      style="background: var(--vex-brand-muted); border-bottom: 1px solid var(--vex-brand-soft-border)"
    >
      <div
        class="size-8 rounded-full flex items-center justify-center text-[11px] font-black shrink-0"
        style="background: var(--vex-brand); color: #fff"
      >
        {{ rootName.charAt(0).toUpperCase() }}
      </div>
      <div class="min-w-0">
        <p class="text-[11px] font-bold" style="color: var(--vex-brand)">Raiz da rede</p>
        <p class="text-[12px] font-semibold truncate" style="color: var(--vex-text)">{{ rootName }}</p>
      </div>
      <span class="ml-auto text-[11px] font-medium" style="color: var(--vex-text-faint)">
        {{ tree.length }} membro{{ tree.length !== 1 ? 's' : '' }} visível{{ tree.length !== 1 ? 'is' : '' }}
      </span>
    </div>

    <!-- Empty state -->
    <div v-if="!tree.length" class="p-10 text-center" style="color: var(--vex-text-faint)">
      <UIcon name="i-lucide-users" class="size-8 mx-auto mb-2 opacity-30" />
      <p class="text-[12px] font-semibold">Nenhum afiliado encontrado</p>
      <p class="text-[11px] mt-0.5">Ajuste os filtros ou compartilhe seu link de convite.</p>
    </div>

    <!-- Flat table -->
    <div v-else class="overflow-x-auto">
      <table class="w-full text-[12px] min-w-[640px]">
        <thead>
          <tr style="background: var(--vex-surface-strong); border-bottom: 1px solid var(--vex-border-subtle)">
            <th class="px-3 py-2 text-left text-[10px] uppercase tracking-widest font-bold w-12" style="color: var(--vex-text-faint)">Nível</th>
            <th class="px-3 py-2 text-left text-[10px] uppercase tracking-widest font-bold" style="color: var(--vex-text-faint)">Nome</th>
            <th class="px-3 py-2 text-left text-[10px] uppercase tracking-widest font-bold hidden md:table-cell" style="color: var(--vex-text-faint)">Email</th>
            <th class="px-3 py-2 text-left text-[10px] uppercase tracking-widest font-bold hidden sm:table-cell" style="color: var(--vex-text-faint)">Referido por</th>
            <th class="px-3 py-2 text-left text-[10px] uppercase tracking-widest font-bold hidden md:table-cell" style="color: var(--vex-text-faint)">Casas</th>
            <th class="px-3 py-2 text-left text-[10px] uppercase tracking-widest font-bold" style="color: var(--vex-text-faint)">Status</th>
            <th class="px-3 py-2 text-right text-[10px] uppercase tracking-widest font-bold" style="color: var(--vex-text-faint)">Ação</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="member in tree"
            :key="member.id"
            class="transition-colors duration-100"
            style="border-bottom: 1px solid var(--vex-border-subtle)"
            @mouseenter="($event.currentTarget as HTMLElement).style.background = 'var(--vex-surface-strong)'"
            @mouseleave="($event.currentTarget as HTMLElement).style.background = ''"
          >
            <!-- Level badge -->
            <td class="px-3 py-2.5">
              <span
                class="inline-flex items-center justify-center text-[10px] font-black px-1.5 py-0.5 rounded"
                :style="levelStyle[member.level] ?? levelStyle[3]"
              >
                {{ levelLabel[member.level] ?? `N${member.level}` }}
              </span>
            </td>

            <!-- Name -->
            <td class="px-3 py-2.5 font-semibold" style="color: var(--vex-text)">
              {{ member.name }}
            </td>

            <!-- Email -->
            <td class="px-3 py-2.5 hidden md:table-cell" style="color: var(--vex-text-muted)">
              {{ member.email }}
            </td>

            <!-- Parent -->
            <td class="px-3 py-2.5 hidden sm:table-cell" style="color: var(--vex-text-muted)">
              {{ member.level === 1 ? rootName : member.parentName }}
            </td>

            <!-- Houses -->
            <td class="px-3 py-2.5 hidden md:table-cell">
              <div v-if="member.houses.length" class="flex flex-wrap items-center gap-x-2 gap-y-1 max-w-[16rem]">
                <HouseBadge v-for="slug in member.houses" :key="slug" :slug="slug" size="xs" />
              </div>
              <span v-else style="color: var(--vex-text-faint)">—</span>
            </td>

            <!-- Status -->
            <td class="px-3 py-2.5">
              <UBadge
                :label="statusLabel(member.status)"
                :color="statusColor(member.status)"
                variant="subtle"
                size="sm"
              />
            </td>

            <!-- Ação: só convidados diretos (nível 1) pendentes são aprováveis.
                 O convidante aprova quem ele convidou; níveis 2+ não aparecem. -->
            <td class="px-3 py-2.5 text-right">
              <UButton
                v-if="member.level === 1 && member.status === 'pending'"
                label="Aprovar"
                icon="i-lucide-check"
                color="success"
                variant="soft"
                size="xs"
                @click="emit('approve', member.id)"
              />
              <span v-else style="color: var(--vex-text-faint)">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Server-side Pagination -->
    <div v-if="hasMultiplePages" class="vex-table-footer">
      <p class="text-[11px]" style="color: var(--vex-text-muted)">
        Página <span class="font-bold" style="color: var(--vex-text)">{{ _page }}</span>
        de <span class="font-bold" style="color: var(--vex-text)">{{ Math.ceil(_total / _pageSize) }}</span>
        —
        <span class="font-bold" style="color: var(--vex-text)">{{ _total }}</span> afiliados no total
      </p>
      <UPagination
        :page="_page"
        :total="_total"
        :items-per-page="_pageSize"
        @update:page="emit('update:page', $event)"
      />
    </div>
  </div>
</template>

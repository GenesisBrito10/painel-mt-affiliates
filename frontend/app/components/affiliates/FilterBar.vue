<script setup lang="ts">
/**
 * FilterBar — Inline filter bar with active filter chips.
 * Works for both affiliate and admin views.
 */
import type { UserStatus } from '~/composables/useAffiliates'

const props = defineProps<{
  search: string
  statusFilter: 'all' | UserStatus
  houseFilter?: string
  houseOptions?: Array<{ label: string; value: string }>
  hasActiveFilters: boolean
}>()

const emit = defineEmits<{
  'update:search': [value: string]
  'update:statusFilter': [value: 'all' | UserStatus]
  'update:houseFilter': [value: string]
  clearAll: []
}>()

const statusOptions = [
  { label: 'Todos os status', value: 'all' },
  { label: 'Pendentes', value: 'pending' },
  { label: 'Aprovados', value: 'approved' },
  { label: 'Recusados', value: 'rejected' }
]

const houseSelectItems = computed(() => {
  if (!props.houseOptions) return []
  return [{ label: 'Todas as casas', value: 'all' }, ...props.houseOptions]
})

const activeChips = computed(() => {
  const chips: Array<{ key: string; label: string; onRemove: () => void }> = []

  if (props.statusFilter !== 'all') {
    const found = statusOptions.find(o => o.value === props.statusFilter)
    chips.push({
      key: 'status',
      label: found?.label || props.statusFilter,
      onRemove: () => emit('update:statusFilter', 'all')
    })
  }

  if (props.houseFilter && props.houseFilter !== 'all' && props.houseOptions) {
    const found = props.houseOptions.find(o => o.value === props.houseFilter)
    chips.push({
      key: 'house',
      label: found?.label || props.houseFilter,
      onRemove: () => emit('update:houseFilter', 'all')
    })
  }

  if (props.search.trim()) {
    chips.push({
      key: 'search',
      label: `"${props.search.trim()}"`,
      onRemove: () => emit('update:search', '')
    })
  }

  return chips
})
</script>

<template>
  <div class="vex-filter-bar">
    <div class="flex flex-col gap-2.5">
      <UInput
        :model-value="search"
        icon="i-lucide-search"
        placeholder="Buscar por nome ou e-mail..."
        size="sm"
        class="w-full"
        @update:model-value="emit('update:search', $event as string)"
      />
      <div class="grid gap-2" :class="houseOptions ? 'grid-cols-2' : 'grid-cols-1'" style="max-width: 24rem">
        <USelect
          v-if="houseOptions"
          :model-value="houseFilter"
          :items="houseSelectItems"
          size="sm"
          @update:model-value="emit('update:houseFilter', $event as string)"
        />
        <USelect
          :model-value="statusFilter"
          :items="statusOptions"
          size="sm"
          @update:model-value="emit('update:statusFilter', $event as ('all' | UserStatus))"
        />
      </div>
    </div>

    <!-- Active filter chips -->
    <div v-if="activeChips.length" class="flex items-center gap-1.5 mt-2 flex-wrap">
      <span class="text-[10px] font-semibold uppercase tracking-wide" style="color: var(--vex-text-faint)">Filtros:</span>
      <button
        v-for="chip in activeChips"
        :key="chip.key"
        class="vex-filter-chip"
        @click="chip.onRemove"
      >
        {{ chip.label }}
        <UIcon name="i-lucide-x" class="size-3 ml-1 opacity-60" />
      </button>
      <button
        class="text-[10px] font-semibold px-2 py-0.5 rounded transition-colors"
        style="color: var(--vex-negative)"
        @click="emit('clearAll')"
      >
        Limpar tudo
      </button>
    </div>
  </div>
</template>

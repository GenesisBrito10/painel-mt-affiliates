<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { NetworkMemberEarnings } from '~/types/earnings'

definePageMeta({
  layout: 'default',
})

useHead({
  title: 'Rede | MT Affiliates',
})

const {
  data: networkData,
  loading: networkLoading,
  error: networkError,
  fetchNetwork,
} = useEarningsNetwork()

const { resolvedSlug: globalHouseSlug, houses: filterHouses, fetchHouses } = useHouseFilter()

const networkFilters = ref({
  search: '',
  status: 'all',
  level: 'all',
  house: 'all',
})

// Filtro de período: os ganhos por usuário são recalculados no backend para o
// intervalo escolhido (startDate/endDate). Vazio = tudo (histórico completo).
const dateRange = ref({ startDate: '', endDate: '' })

watch(globalHouseSlug, (slug) => {
  networkFilters.value.house = slug ?? 'all'
}, { immediate: true })
const networkSort = ref('earnings')
const visibleMemberLimit = ref(25)

// Filtros que REconsultam o backend (recalculam os ganhos): período + casa.
// Busca/status/nível continuam client-side (só filtram a lista já carregada).
const serverFilters = () => ({
  startDate: dateRange.value.startDate || undefined,
  endDate: dateRange.value.endDate || undefined,
  bettingHouse:
    networkFilters.value.house !== 'all'
      ? networkFilters.value.house
      : undefined,
})

onMounted(() => {
  // Lista estável de casas p/ o select (independe dos membros filtrados).
  fetchHouses()
  // Sempre busca no mount para os dados baterem com os filtros atuais (o estado
  // é compartilhado via useState e pode estar filtrado de uma visita anterior).
  fetchNetwork(serverFilters())
})

// Re-consulta ao mudar período ou casa (a casa vem do filtro global do topo ou
// do select da página). Não usa `immediate` — o fetch inicial é o do onMounted.
watch(
  () => [dateRange.value.startDate, dateRange.value.endDate, networkFilters.value.house],
  () => { fetchNetwork(serverFilters()) },
)

const statusOptions = [
  { label: 'Todos status', value: 'all' },
  { label: 'Aprovados', value: 'APPROVED' },
  { label: 'Pendentes', value: 'PENDING' },
  { label: 'Rejeitados', value: 'REJECTED' },
  { label: 'Bloqueados', value: 'BLOCKED' },
]

const sortOptions = [
  { label: 'Maior ganho', value: 'earnings' },
  { label: 'Mais CPA', value: 'cpaQualified' },
  { label: 'Mais depósitos', value: 'deposit' },
  { label: 'Mais cadastros', value: 'registrations' },
]

const formatCurrency = (value: number) => {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0)
}

const formatInteger = (value: number) => {
  return new Intl.NumberFormat('pt-BR').format(value || 0)
}

const formatPercent = (value: number) => {
  return `${(value || 0).toFixed(1).replace('.', ',')}%`
}

const networkMembers = computed(() => networkData.value?.members ?? [])

// Level filter: only offer the levels that actually exist in this user's
// network (deepest level the user has), not a fixed 1..10 list.
const levelOptions = computed(() => {
  const levels = new Set<number>()
  for (const member of networkMembers.value) levels.add(member.level)
  const sorted = Array.from(levels).sort((a, b) => a - b)
  return [
    { label: 'Todos níveis', value: 'all' },
    ...sorted.map(level => ({ label: `Nível ${level}`, value: String(level) })),
  ]
})

const { getHouseName: houseLabel } = useHouseFilter()

// Opções da casa vêm da lista ESTÁVEL do usuário (/dashboard/filters), não dos
// membros carregados — senão, ao filtrar por uma casa o backend escopa o
// resultado e a lista de opções colapsava só pra aquela casa (bug relatado).
const houseOptions = computed(() => {
  const stable = filterHouses.value.map(h => ({ label: h.name, value: h.slug }))
  if (stable.length) {
    return [{ label: 'Todas casas', value: 'all' }, ...stable]
  }
  // Fallback: se a lista estável ainda não carregou, deriva dos membros.
  const houses = new Set<string>()
  for (const member of networkMembers.value) {
    for (const house of member.houses) houses.add(house)
  }
  return [
    { label: 'Todas casas', value: 'all' },
    ...Array.from(houses).sort().map(house => ({ label: houseLabel(house), value: house })),
  ]
})

const filteredNetworkMembers = computed(() => {
  const query = networkFilters.value.search.trim().toLowerCase()
  const list = networkMembers.value.filter((member) => {
    const matchesSearch = !query
      || member.memberName.toLowerCase().includes(query)
      || member.memberEmail.toLowerCase().includes(query)
      || member.houses.some(house => house.toLowerCase().includes(query))
    const matchesStatus = networkFilters.value.status === 'all' || member.status === networkFilters.value.status
    const matchesLevel = networkFilters.value.level === 'all' || String(member.level) === networkFilters.value.level
    const matchesHouse = networkFilters.value.house === 'all' || member.houses.includes(networkFilters.value.house)
    return matchesSearch && matchesStatus && matchesLevel && matchesHouse
  })

  return [...list].sort((a, b) => {
    if (networkSort.value === 'cpaQualified') return b.cpaQualified - a.cpaQualified
    if (networkSort.value === 'deposit') return b.deposit - a.deposit
    if (networkSort.value === 'registrations') return b.registrations - a.registrations
    return b.totalEarnings - a.totalEarnings
  })
})

const displayedNetworkMembers = computed(() => {
  return filteredNetworkMembers.value.slice(0, visibleMemberLimit.value)
})

const hasMoreMembers = computed(() => {
  return displayedNetworkMembers.value.length < filteredNetworkMembers.value.length
})

const activeNetworkFilters = computed(() => {
  return [
    networkFilters.value.search,
    networkFilters.value.status !== 'all',
    networkFilters.value.level !== 'all',
    networkFilters.value.house !== 'all',
    !!dateRange.value.startDate,
    !!dateRange.value.endDate,
  ].filter(Boolean).length
})

const networkConversionRate = computed(() => {
  const registrations = networkData.value?.totals.registrations ?? 0
  const qualified = networkData.value?.totals.cpaQualified ?? 0
  return registrations > 0 ? (qualified / registrations) * 100 : 0
})

const networkAvgDepositPerCpa = computed(() => {
  const deposit = networkData.value?.totals.deposit ?? 0
  const qualified = networkData.value?.totals.cpaQualified ?? 0
  return qualified > 0 ? deposit / qualified : 0
})

const topNetworkMember = computed<NetworkMemberEarnings | null>(() => {
  return networkMembers.value.length ? networkMembers.value[0] ?? null : null
})

const maxLevelEarnings = computed(() => {
  const summary = networkData.value?.levelSummary
  if (!summary) return 1
  return Math.max(...Object.values(summary).map(s => s.earnings), 1)
})

const levelBreakdown = computed(() => {
  const summary = networkData.value?.levelSummary
  if (!summary) return []
  return Object.keys(summary)
    .map(Number)
    .sort((a, b) => a - b)
    .filter(level => summary[level]!.members > 0)
    .map(level => ({
      level,
      ...summary[level]!,
      width: `${Math.max(6, (summary[level]!.earnings / maxLevelEarnings.value) * 100)}%`,
    }))
})

const statusBreakdown = computed(() => {
  const summary = networkData.value?.statusSummary
  if (!summary) return []
  return [
    { label: 'Aprovados', value: summary.approved, color: 'var(--vex-positive)' },
    { label: 'Pendentes', value: summary.pending, color: 'var(--vex-warning)' },
    { label: 'Rejeitados', value: summary.rejected, color: 'var(--vex-negative)' },
    { label: 'Bloqueados', value: summary.blocked, color: 'var(--vex-negative)' },
  ]
})

const networkKpis = computed(() => {
  const data = networkData.value
  if (!data) return []
  return [
    {
      label: 'Ganho líquido',
      value: formatCurrency(data.totalNetworkEarnings),
      hint: `${formatCurrency(data.grossNetworkEarnings)} bruto`,
      icon: 'i-lucide-wallet',
      color: 'var(--vex-brand)',
    },
    {
      label: 'CPA da rede',
      value: formatCurrency(data.totalCpaEarnings),
      hint: `${formatInteger(data.totals.cpaQualified)} CPA qualificados`,
      icon: 'i-lucide-badge-check',
      color: 'var(--vex-positive)',
    },
    {
      label: 'RevShare da rede',
      value: formatCurrency(data.totalRevshareEarnings),
      hint: `${formatCurrency(data.totals.revShareGenerated)} rev gerado`,
      icon: 'i-lucide-percent',
      color: 'var(--vex-info)',
    },
    {
      label: 'Depósitos',
      value: formatCurrency(data.totals.deposit),
      hint: `${formatCurrency(networkAvgDepositPerCpa.value)} por CPA`,
      icon: 'i-lucide-arrow-down-to-line',
      color: 'var(--vex-accent)',
    },
    {
      label: 'Cadastros',
      value: formatInteger(data.totals.registrations),
      hint: `${formatPercent(networkConversionRate.value)} viraram CPA`,
      icon: 'i-lucide-user-plus',
      color: 'var(--vex-info)',
    },
    {
      label: 'Fraudes',
      value: `-${formatCurrency(data.totalFraudDeduction)}`,
      hint: `${formatInteger(data.totals.fraudCount)} ocorrência(s)`,
      icon: 'i-lucide-shield-alert',
      color: 'var(--vex-negative)',
    },
  ]
})

const resetNetworkFilters = () => {
  networkFilters.value = { search: '', status: 'all', level: 'all', house: 'all' }
  dateRange.value = { startDate: '', endDate: '' }
  networkSort.value = 'earnings'
}

const showMoreMembers = () => {
  visibleMemberLimit.value += 25
}

watch([networkFilters, networkSort], () => {
  visibleMemberLimit.value = 25
}, { deep: true })
</script>

<template>
  <div class="min-h-full flex flex-col">
    <!-- ─── PAGE HEADER ─── -->
    <header class="vex-page-header">
      <div class="flex items-center gap-3">
        <h1 class="text-base font-bold vex-title">Rede</h1>
        <span
          v-if="networkData"
          class="vex-shell-chip hidden md:inline-block text-[11px] font-medium px-2 py-0.5 rounded-md"
        >
          {{ networkData.totalMembers }} membros
        </span>
      </div>
      <div class="flex items-center gap-2">
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-filter-x"
          size="sm"
          :disabled="activeNetworkFilters === 0"
          @click="resetNetworkFilters"
        >
          Limpar filtros
        </UButton>
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-refresh-cw"
          size="sm"
          :loading="networkLoading"
          @click="fetchNetwork()"
        />
      </div>
    </header>

    <!-- ─── CONTENT ─── -->
    <div class="flex-1">
      <div class="py-5 w-full">
        <div>
          <p class="mb-6 text-sm" style="color: var(--vex-text-muted)">
            Acompanhe os ganhos, volume, níveis e saúde da sua rede de afiliados.
          </p>
        </div>

        <UAlert v-if="networkError" title="Erro ao carregar rede" :description="networkError" color="error" class="mb-4" />

    <div v-if="networkLoading && !networkData" class="space-y-4">
      <USkeleton class="h-28 w-full" />
      <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <USkeleton v-for="i in 6" :key="i" class="h-28 w-full" />
      </div>
      <USkeleton class="h-64 w-full" />
    </div>

    <template v-else-if="networkData">
      <div class="space-y-6">
        <UCard class="border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div class="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <h2 class="text-xl font-bold text-gray-900 dark:text-white">Minha Rede</h2>
                <UBadge color="primary" variant="soft">{{ networkData.totalMembers }} membros</UBadge>
              </div>
              <p class="mt-1 max-w-3xl text-sm text-gray-500 dark:text-gray-400">
                Ganhos por spread de CPA e RevShare, descontos de fraude, volume gerado e desempenho por nível.
              </p>
            </div>

            <div v-if="topNetworkMember" class="rounded-lg border border-gray-200 px-4 py-3 dark:border-gray-700">
              <div class="text-[11px] font-medium uppercase tracking-wide text-gray-500">Maior contribuição</div>
              <div class="mt-1 flex items-center gap-3">
                <div class="min-w-0">
                  <div class="truncate text-sm font-semibold text-gray-900 dark:text-white">{{ topNetworkMember.memberName }}</div>
                  <div class="text-xs text-gray-500">{{ topNetworkMember.cpaQualified }} CPA · {{ formatCurrency(topNetworkMember.deposit) }}</div>
                </div>
                <div class="font-money text-lg font-bold text-gray-900 dark:text-white">{{ formatCurrency(topNetworkMember.totalEarnings) }}</div>
              </div>
            </div>
          </div>
        </UCard>

        <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <UCard v-for="kpi in networkKpis" :key="kpi.label" class="bg-white dark:bg-gray-900">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="text-xs font-medium text-gray-500 dark:text-gray-400">{{ kpi.label }}</div>
                <div class="mt-2 font-money text-2xl font-bold text-gray-900 dark:text-white">{{ kpi.value }}</div>
                <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">{{ kpi.hint }}</div>
              </div>
              <div class="flex size-10 shrink-0 items-center justify-center rounded-lg" style="background: var(--vex-brand-muted)">
                <UIcon :name="kpi.icon" class="size-5" :style="{ color: kpi.color }" />
              </div>
            </div>
          </UCard>
        </div>

        <div class="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <UCard class="bg-white dark:bg-gray-900">
            <div class="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 class="font-semibold text-gray-900 dark:text-white">Composição dos ganhos</h3>
                <p class="text-xs text-gray-500 dark:text-gray-400">Quanto veio de CPA, RevShare e quanto foi descontado.</p>
              </div>
              <UBadge color="neutral" variant="soft">{{ formatCurrency(networkData.totalNetworkEarnings) }}</UBadge>
            </div>
            <div class="space-y-3">
              <div>
                <div class="mb-1 flex justify-between text-xs text-gray-500">
                  <span>CPA</span>
                  <span>{{ formatCurrency(networkData.totalCpaEarnings) }}</span>
                </div>
                <div class="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                  <div class="h-full rounded-full bg-emerald-500" :style="{ width: `${Math.min(100, (networkData.totalCpaEarnings / Math.max(networkData.grossNetworkEarnings, 1)) * 100)}%` }" />
                </div>
              </div>
              <div>
                <div class="mb-1 flex justify-between text-xs text-gray-500">
                  <span>RevShare</span>
                  <span>{{ formatCurrency(networkData.totalRevshareEarnings) }}</span>
                </div>
                <div class="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                  <div class="h-full rounded-full" :style="{ width: `${Math.min(100, (networkData.totalRevshareEarnings / Math.max(networkData.grossNetworkEarnings, 1)) * 100)}%`, background: 'var(--vex-info)' }" />
                </div>
              </div>
              <div>
                <div class="mb-1 flex justify-between text-xs text-gray-500">
                  <span>Fraude</span>
                  <span>-{{ formatCurrency(networkData.totalFraudDeduction) }}</span>
                </div>
                <div class="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                  <div class="h-full rounded-full bg-red-500" :style="{ width: `${Math.min(100, (networkData.totalFraudDeduction / Math.max(networkData.grossNetworkEarnings, 1)) * 100)}%` }" />
                </div>
              </div>
            </div>
          </UCard>

          <UCard class="bg-white dark:bg-gray-900">
            <div class="mb-4">
              <h3 class="font-semibold text-gray-900 dark:text-white">Níveis e status</h3>
              <p class="text-xs text-gray-500 dark:text-gray-400">Leitura rápida de profundidade e saúde da rede.</p>
            </div>
            <div class="space-y-3">
              <div v-for="level in levelBreakdown" :key="level.level">
                <div class="mb-1 flex justify-between text-xs">
                  <span class="font-medium text-gray-700 dark:text-gray-300">Nível {{ level.level }} · {{ level.members }} membros</span>
                  <span class="text-gray-500">{{ formatCurrency(level.earnings) }}</span>
                </div>
                <div class="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                  <div class="h-full rounded-full" :style="{ width: level.width, background: 'var(--vex-brand)' }" />
                </div>
              </div>
              <div class="flex flex-wrap gap-2 pt-2">
                <span v-for="status in statusBreakdown" :key="status.label" class="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300">
                  <span class="size-2 rounded-full" :style="{ background: status.color }" />
                  {{ status.label }}: {{ status.value }}
                </span>
              </div>
            </div>
          </UCard>
        </div>

        <UCard class="bg-white dark:bg-gray-900">
          <div class="space-y-3">
            <div class="flex items-center justify-between gap-2">
              <div>
                <h3 class="font-semibold text-gray-900 dark:text-white">Filtros</h3>
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  Período e casa recalculam os ganhos de cada usuário. Busca, status e nível filtram a lista.
                </p>
              </div>
            </div>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <UFormField label="De">
                <UInput v-model="dateRange.startDate" type="date" :max="dateRange.endDate || undefined" class="w-full" />
              </UFormField>
              <UFormField label="Até">
                <UInput v-model="dateRange.endDate" type="date" :min="dateRange.startDate || undefined" class="w-full" />
              </UFormField>
              <UFormField label="Casa">
                <USelect v-model="networkFilters.house" :items="houseOptions" class="w-full" />
              </UFormField>
              <UFormField label="Usuário">
                <UInput v-model="networkFilters.search" icon="i-lucide-search" placeholder="Nome, e-mail ou casa..." class="w-full" />
              </UFormField>
            </div>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <UFormField label="Status">
                <USelect v-model="networkFilters.status" :items="statusOptions" class="w-full" />
              </UFormField>
              <UFormField label="Nível">
                <USelect v-model="networkFilters.level" :items="levelOptions" class="w-full" />
              </UFormField>
            </div>
          </div>
        </UCard>

        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="text-sm text-gray-500 dark:text-gray-400">
            Mostrando {{ displayedNetworkMembers.length }} de {{ filteredNetworkMembers.length }} membros filtrados
          </div>
          <USelect v-model="networkSort" :items="sortOptions" class="w-full sm:w-44" icon="i-lucide-arrow-up-down" />
        </div>

        <div v-if="networkData.members.length === 0" class="rounded-lg border border-dashed border-gray-300 py-12 text-center text-gray-500 dark:border-gray-700">
          <UIcon name="i-lucide-users-round" class="mx-auto mb-2 size-8 opacity-50" />
          Nenhum membro ativo encontrado na sua rede.
        </div>

        <div v-else-if="filteredNetworkMembers.length === 0" class="rounded-lg border border-dashed border-gray-300 py-12 text-center text-gray-500 dark:border-gray-700">
          <UIcon name="i-lucide-search-x" class="mx-auto mb-2 size-8 opacity-50" />
          Nenhum membro corresponde aos filtros selecionados.
        </div>

        <div v-else class="grid grid-cols-1 gap-4">
          <EarningsNetworkMemberCard
            v-for="member in displayedNetworkMembers"
            :key="member.memberId"
            :member="member"
          />

          <div v-if="hasMoreMembers" class="flex justify-center pt-2">
            <UButton color="neutral" variant="outline" icon="i-lucide-chevron-down" @click="showMoreMembers">
              Carregar mais {{ Math.min(25, filteredNetworkMembers.length - displayedNetworkMembers.length) }}
            </UButton>
          </div>
        </div>
      </div>
    </template>
      </div>
    </div>
  </div>
</template>

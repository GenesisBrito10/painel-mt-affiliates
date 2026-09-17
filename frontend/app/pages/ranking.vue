<script setup lang="ts">
definePageMeta({ layout: 'default' })

const {
  leaderboard, leaderboardContext, podium, tableEntries, loadingLeaderboard,
  prizes, loadingPrizes,
  showcase,
  rewards, pendingRewards, redeemedRewards, loadingRewards,
  redeeming,
  fetchLeaderboard, redeemPrize, init,
} = useRanking()

// House filter for the public board — top CPA per house (not cross-house)
const { houses, fetchHouses } = useHouseFilter()
// 'all' sentinel — Reka UI SelectItem proíbe value string vazia.
const ALL_HOUSES = 'all'
const selectedHouseSlug = ref<string>(ALL_HOUSES)
const houseSelectOptions = computed(() => [
  { label: 'Todas as casas', value: ALL_HOUSES },
  ...houses.value.map(h => ({ label: h.name, value: h.slug })),
])
function selectHouse(slug: string) {
  selectedHouseSlug.value = slug
  selectedPrizeId.value = null // period board scoped to the chosen house
  page.value = 1
  fetchLeaderboard({ period: 'month', bettingHouse: slug !== ALL_HOUSES ? slug : undefined })
}
function houseNameOf(slug: string | null): string {
  if (!slug || slug === ALL_HOUSES) return 'Todas as casas'
  return houses.value.find(h => h.slug === slug)?.name ?? slug
}

const formatNumber = (val: number) => new Intl.NumberFormat('pt-BR').format(val)

const tabs = ['Classificação', 'Premiações']
const activeTab = ref('Classificação')

const page = ref(1)
const pageSize = 10
const paginatedItems = computed(() => {
  const start = (page.value - 1) * pageSize
  return tableEntries.value.slice(start, start + pageSize)
})

// Prize selector — only configured prizes
const selectedPrizeId = ref<string | null>(null)
const prizeOptions = computed(() =>
  prizes.value.map(p => ({ label: `${p.icon} ${p.title}`, value: p.id }))
)

function selectPrize(id: string) {
  selectedPrizeId.value = id
  selectedHouseSlug.value = ALL_HOUSES // prize-bound board uses the prize's own house
  page.value = 1
  fetchLeaderboard({ prizeId: id })
}

// Redeem modal
const redeemTarget = ref<{ prizeId: string; rank: number; label: string } | null>(null)
function confirmRedeem() {
  if (!redeemTarget.value) return
  redeemPrize(redeemTarget.value.prizeId, redeemTarget.value.rank)
  redeemTarget.value = null
}

function daysLeft(endDate: string) {
  const diff = Math.ceil((new Date(endDate).getTime() - Date.now()) / 86400000)
  return diff > 0 ? `${diff} dias restantes` : 'Encerrado'
}

function prizeIcon(type: string) {
  switch (type) {
    case 'BALANCE': return 'i-lucide-wallet'
    case 'PHYSICAL': return 'i-lucide-gift'
    case 'VOUCHER': return 'i-lucide-ticket'
    default: return 'i-lucide-trophy'
  }
}

const rankMedal = (rank: number) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}º`)

onMounted(async () => {
  fetchHouses()
  await init()
  // Default filter to the latest active prize (init já carregou o leaderboard
  // dele); reflete a seleção no dropdown em vez de deixar em branco.
  selectedPrizeId.value = prizes.value[0]?.id ?? null
})
</script>

<template>
  <div class="min-h-full flex flex-col">
    <!-- ─── PAGE HEADER ─── -->
    <header class="vex-page-header">
      <div class="flex items-center gap-3">
        <h1 class="text-base font-bold vex-title">Ranking</h1>
        <!-- Tabs -->
        <div class="vex-shell-segmented flex items-center p-0.5 rounded-lg">
          <button
            v-for="tab in tabs" :key="tab"
            class="vex-shell-tab px-2.5 py-1 text-[11px] font-semibold rounded-md transition-all duration-150"
            :class="activeTab === tab ? 'is-active' : ''"
            @click="activeTab = tab"
          >{{ tab }}</button>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <template v-if="activeTab === 'Classificação'">
          <!-- House filter: top CPA por casa -->
          <USelect
            :model-value="selectedHouseSlug"
            :items="houseSelectOptions"
            value-key="value"
            size="sm"
            class="w-44"
            icon="i-lucide-building-2"
            @update:model-value="selectHouse($event)"
          />
          <!-- Prize selector: dropdown se múltiplas, botão se única -->
          <template v-if="prizeOptions.length > 1">
            <USelect
              :model-value="selectedPrizeId ?? ''"
              :items="prizeOptions.map(o => ({ label: o.label, value: o.value }))"
              value-key="value"
              size="sm"
              class="w-52"
              @update:model-value="selectPrize($event)"
            />
          </template>
          <template v-else-if="prizeOptions.length === 1">
            <div class="flex items-center p-0.5 rounded-lg" style="background: var(--vex-bg-muted)">
              <button
                class="px-2.5 py-1 text-[11px] font-semibold rounded-md bg-[var(--vex-surface)] shadow-sm max-w-[220px] truncate"
                style="color: var(--vex-text)"
              >{{ prizeOptions[0]!.label }}</button>
            </div>
          </template>
        </template>
      </div>
    </header>

    <!-- ─── CONTENT ─── -->
    <div class="flex-1">
      <div class="py-5 space-y-5 w-full">

        <!-- ═══════════════════════════════════════════
             TAB: CLASSIFICAÇÃO
             ═══════════════════════════════════════════ -->
        <template v-if="activeTab === 'Classificação'">

          <!-- Active prize context banner -->
          <div v-if="leaderboardContext" class="vex-card p-4 flex items-center gap-4" style="border-left: 3px solid var(--vex-brand)">
            <span class="text-3xl shrink-0">{{ leaderboardContext.icon }}</span>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <h3 class="text-[13px] font-bold truncate" style="color: var(--vex-text)">{{ leaderboardContext.title }}</h3>
                <span class="text-[10px] font-bold px-1.5 py-0.5 rounded" style="color: var(--vex-positive); background: var(--vex-positive-light)">ATIVA</span>
              </div>
              <p class="text-[11px] mt-0.5 line-clamp-1" style="color: var(--vex-text-faint)">{{ leaderboardContext.description }}</p>
            </div>
            <div class="hidden md:flex items-center gap-4 shrink-0">
              <div class="text-center">
                <p class="text-[10px] font-semibold uppercase" style="color: var(--vex-text-faint)">Meta CPA</p>
                <p class="text-sm font-bold font-money" style="color: var(--vex-brand)">{{ formatNumber(leaderboardContext.targetCpa) }}</p>
              </div>
              <div class="text-center">
                <p class="text-[10px] font-semibold uppercase" style="color: var(--vex-text-faint)">Prêmio</p>
                <p class="text-sm font-bold" style="color: var(--vex-text)">{{ leaderboardContext.prizeLabel }}</p>
              </div>
              <div class="text-center">
                <p class="text-[10px] font-semibold uppercase" style="color: var(--vex-text-faint)">Encerra</p>
                <p class="text-sm font-bold" style="color: var(--vex-text)">{{ daysLeft(leaderboardContext.endDate) }}</p>
              </div>
            </div>
          </div>

          <!-- Loading skeleton -->
          <template v-if="loadingLeaderboard">
            <section class="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div v-for="i in 3" :key="i" class="vex-card p-6 flex flex-col items-center">
                <USkeleton class="w-14 h-14 rounded-full mb-3" />
                <USkeleton class="h-4 w-24 mb-2" />
                <USkeleton class="h-7 w-16" />
              </div>
            </section>
            <section class="vex-card overflow-hidden">
              <div v-for="i in 5" :key="i" class="px-5 py-3 flex gap-4 items-center" style="border-bottom: 1px solid var(--vex-border-subtle)">
                <USkeleton class="h-4 w-8" />
                <USkeleton class="h-8 w-8 rounded-full" />
                <USkeleton class="h-4 w-32 flex-1" />
                <USkeleton class="h-4 w-12" />
              </div>
            </section>
          </template>

          <!-- Empty state -->
          <template v-else-if="leaderboard.length === 0">
            <div class="vex-card py-20 flex flex-col items-center justify-center text-center">
              <div class="vex-icon-badge mb-4" style="width: 3.5rem; height: 3.5rem">
                <UIcon name="i-lucide-bar-chart-3" class="size-7" />
              </div>
              <h3 class="text-sm font-bold" style="color: var(--vex-text)">Nenhum dado disponível</h3>
              <p class="text-[12px] max-w-xs mt-1" style="color: var(--vex-text-faint)">
                Ainda não há dados de CPA para o período selecionado.
              </p>
            </div>
          </template>

          <!-- Real data -->
          <template v-else>
            <!-- PODIUM -->
            <section class="grid grid-cols-1 md:grid-cols-3 gap-3 vex-stagger">
              <template v-for="p in podium" :key="p.rank">
                <!-- 1st place -->
                <article v-if="p.rank === 1" class="vex-hero-card overflow-hidden md:order-2">
                  <div class="vex-shell-hero-panel p-5 md:p-6 flex flex-col items-center text-center relative">
                    <div class="vex-shell-hero-orb--brand absolute top-0 right-0 w-40 h-40 rounded-full opacity-[0.07] pointer-events-none" style="transform: translate(30%, -30%)" />
                    <p class="text-[10px] font-bold uppercase tracking-[0.14em] mb-3" style="color: var(--vex-brand-soft-text-strong)">🏆 1º Lugar</p>
                    <div class="w-16 h-16 rounded-full mb-3 flex items-center justify-center text-2xl font-bold" style="border: 2px solid var(--vex-brand-soft-text); background: var(--vex-brand-soft-bg); color: var(--vex-brand-soft-text)">
                      {{ p.userName.charAt(0).toUpperCase() }}
                    </div>
                    <h3 class="text-sm font-bold text-white">{{ p.userName }}</h3>
                    <p v-if="p.isMe" class="text-[10px] font-bold px-1.5 py-0.5 rounded mt-1" style="color: var(--vex-brand-soft-text); background: var(--vex-brand-soft-bg-strong)">Você</p>
                    <p class="vex-amount text-3xl text-white mt-3">{{ formatNumber(p.cpa) }}</p>
                    <p class="text-[10px] mt-1" style="color: var(--vex-shell-dark-subtle)">CPA Qualificados</p>
                  </div>
                </article>
                <!-- 2nd & 3rd -->
                <article v-else class="vex-card p-5 flex flex-col items-center text-center" :class="p.rank === 2 ? 'md:order-1' : 'md:order-3'">
                  <p class="text-[10px] font-bold uppercase tracking-[0.14em] mb-3" style="color: var(--vex-text-faint)">
                    {{ p.rank === 2 ? '🥈 2º Lugar' : '🥉 3º Lugar' }}
                  </p>
                  <div class="w-12 h-12 rounded-full mb-3 flex items-center justify-center text-lg font-bold" style="border: 1px solid var(--vex-border); background: var(--vex-surface-strong); color: var(--vex-text-muted)">
                    {{ p.userName.charAt(0).toUpperCase() }}
                  </div>
                  <h3 class="text-sm font-semibold" style="color: var(--vex-text)">{{ p.userName }}</h3>
                  <p v-if="p.isMe" class="text-[10px] font-bold px-1.5 py-0.5 rounded mt-1" style="color: var(--vex-brand); background: var(--vex-brand-muted)">Você</p>
                  <p class="vex-amount text-2xl mt-2" style="color: var(--vex-text)">{{ formatNumber(p.cpa) }}</p>
                  <p class="text-[10px] mt-1" style="color: var(--vex-text-faint)">CPA Qualificados</p>
                </article>
              </template>
            </section>

            <!-- LEADERBOARD TABLE -->
            <section v-if="tableEntries.length > 0" class="vex-card overflow-hidden">
              <div class="vex-table-header">
                <div>
                  <h3 class="text-sm font-bold vex-title" style="color: var(--vex-text)">{{ leaderboardContext ? leaderboardContext.title : 'Classificação Geral' }}</h3>
                  <p class="text-[11px] mt-0.5" style="color: var(--vex-text-faint)">
                    {{ leaderboardContext ? 'Ranking de CPA qualificados desta premiação' : `Top ${leaderboard.length} afiliados por CPA qualificados` }}
                  </p>
                </div>
              </div>
              <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse text-[13px]">
                  <thead>
                    <tr style="background: var(--vex-surface-strong); border-bottom: 1px solid var(--vex-border-subtle)">
                      <th class="px-5 py-2.5 w-16 text-center text-[10px] uppercase tracking-[0.1em] font-bold" style="color: var(--vex-text-faint)">Pos</th>
                      <th class="px-5 py-2.5 text-[10px] uppercase tracking-[0.1em] font-bold" style="color: var(--vex-text-faint)">Afiliado</th>
                      <th class="px-5 py-2.5 text-right text-[10px] uppercase tracking-[0.1em] font-bold" style="color: var(--vex-text-faint)">CPA</th>
                      <th class="px-5 py-2.5 text-right text-[10px] uppercase tracking-[0.1em] font-bold" style="color: var(--vex-text-faint)">FTD</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="row in paginatedItems" :key="row.rank"
                      class="transition-colors duration-100"
                      :style="{
                        borderBottom: '1px solid var(--vex-border-subtle)',
                        background: row.isMe ? 'var(--vex-brand-muted)' : '',
                        borderLeft: row.isMe ? '3px solid var(--vex-brand)' : '',
                      }"
                      @mouseenter="!row.isMe && (($event.currentTarget as HTMLElement).style.background = 'var(--vex-surface-strong)')"
                      @mouseleave="!row.isMe && (($event.currentTarget as HTMLElement).style.background = '')"
                    >
                      <td class="px-5 py-3 text-center font-money font-semibold tabular-nums" :style="{ color: row.isMe ? 'var(--vex-brand)' : 'var(--vex-text-faint)' }">{{ row.rank }}</td>
                      <td class="px-5 py-3">
                        <div class="flex items-center gap-3">
                          <div class="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0" :style="{ border: row.isMe ? '2px solid var(--vex-brand)' : '1px solid var(--vex-border)', background: 'var(--vex-surface-strong)', color: 'var(--vex-text-muted)' }">
                            {{ row.userName.charAt(0).toUpperCase() }}
                          </div>
                          <div>
                            <div class="flex items-center gap-2">
                              <p class="font-medium" style="color: var(--vex-text)">{{ row.userName }}</p>
                              <span v-if="row.isMe" class="px-1.5 py-0.5 rounded text-[9px] uppercase font-bold tracking-wider" style="color: var(--vex-brand); background: var(--vex-brand-muted)">Você</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td class="px-5 py-3 text-right font-money font-bold tabular-nums" style="color: var(--vex-text)">{{ formatNumber(row.cpa) }}</td>
                      <td class="px-5 py-3 text-right font-money tabular-nums" style="color: var(--vex-text-muted)">{{ formatNumber(row.ftd) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div v-if="tableEntries.length > pageSize" class="vex-table-footer">
                <p class="text-[11px]" style="color: var(--vex-text-muted)">
                  Exibindo
                  <span class="font-bold" style="color: var(--vex-text)">{{ (page - 1) * pageSize + 1 }}</span> a
                  <span class="font-bold" style="color: var(--vex-text)">{{ Math.min(page * pageSize, tableEntries.length) }}</span> de
                  <span class="font-bold" style="color: var(--vex-text)">{{ tableEntries.length }}</span>
                </p>
                <UPagination :page="page" :total="tableEntries.length" :items-per-page="pageSize" @update:page="page = $event" />
              </div>
            </section>
          </template>
        </template>

        <!-- ═══════════════════════════════════════════
             TAB: PREMIAÇÕES
             ═══════════════════════════════════════════ -->
        <template v-if="activeTab === 'Premiações'">

          <!-- Loading -->
          <template v-if="loadingPrizes || loadingRewards">
            <section class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div v-for="i in 4" :key="i" class="vex-card p-5 space-y-3">
                <USkeleton class="h-5 w-40" />
                <USkeleton class="h-3 w-full" />
                <USkeleton class="h-8 w-24 mt-2" />
              </div>
            </section>
          </template>

          <template v-else>
            <!-- ═══ MEUS PRÊMIOS (pendentes) ═══ -->
            <section v-if="pendingRewards.length > 0">
              <h2 class="text-sm font-bold mb-3 flex items-center gap-2" style="color: var(--vex-text)">
                <UIcon name="i-lucide-gift" class="size-4" style="color: var(--vex-brand)" />
                Prêmios para Resgatar
              </h2>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <article v-for="r in pendingRewards" :key="`${r.prizeId}-${r.rank}`" class="vex-card p-5 flex items-start gap-4" style="border-left: 3px solid var(--vex-brand)">
                  <div class="vex-icon-badge shrink-0">
                    <UIcon :name="prizeIcon(r.prizeType)" class="size-4" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <h4 class="text-[13px] font-bold truncate" style="color: var(--vex-text)">{{ r.title }}</h4>
                    <p class="text-[11px] mt-0.5" style="color: var(--vex-text-faint)">
                      {{ r.rank }}º lugar · {{ formatNumber(r.cpaAchieved) }} CPAs
                    </p>
                    <p class="text-[13px] font-bold mt-2" style="color: var(--vex-brand)">
                      {{ r.prizeLabel || `R$ ${formatNumber(r.prizeValue)}` }}
                    </p>
                  </div>
                  <UButton
                    label="Resgatar"
                    color="primary"
                    size="sm"
                    icon="i-lucide-check-circle"
                    :loading="redeeming"
                    @click="redeemTarget = { prizeId: r.prizeId, rank: r.rank, label: r.prizeLabel || r.title }"
                  />
                </article>
              </div>
            </section>

            <!-- ═══ PREMIAÇÕES (ativas + encerradas) ═══ -->
            <section v-if="showcase.length > 0">
              <h2 class="text-sm font-bold mb-3 flex items-center gap-2" style="color: var(--vex-text)">
                <UIcon name="i-lucide-trophy" class="size-4" style="color: var(--vex-warning)" />
                Premiações
              </h2>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <article v-for="p in showcase" :key="p.id" class="vex-card overflow-hidden">
                  <div class="p-5">
                    <div class="flex items-start justify-between mb-3">
                      <div class="flex-1 min-w-0">
                        <h4 class="text-[13px] font-bold truncate" style="color: var(--vex-text)">{{ p.icon }} {{ p.title }}</h4>
                        <p class="text-[11px] mt-0.5 whitespace-pre-line" style="color: var(--vex-text-faint)">{{ p.description }}</p>
                        <div class="flex flex-wrap gap-1 mt-1">
                          <span class="text-[9px] font-bold px-1.5 py-0.5 rounded" style="color: var(--vex-text-muted); background: var(--vex-bg-muted)">
                            🏠 {{ houseNameOf(p.bettingHouse) }}
                          </span>
                          <span class="text-[9px] font-bold px-1.5 py-0.5 rounded" style="color: var(--vex-brand); background: var(--vex-brand-muted)">
                            {{ p.winMode === 'TARGET' ? `Meta ${p.targetCpa} CPA` : 'Mais CPA vence' }}
                          </span>
                          <span v-if="p.winMode === 'TARGET' && p.cpaFromNetwork" class="text-[9px] font-bold px-1.5 py-0.5 rounded" style="color: var(--vex-info); background: var(--vex-info-light)">
                            Rede
                          </span>
                        </div>
                      </div>
                      <span
                        class="shrink-0 ml-3 text-[10px] font-bold px-2 py-0.5 rounded"
                        :style="p.final
                          ? 'color: var(--vex-text-muted); background: var(--vex-bg-muted)'
                          : 'color: var(--vex-positive); background: var(--vex-positive-light)'"
                      >
                        {{ p.final ? 'Encerrada' : daysLeft(p.endDate) }}
                      </span>
                    </div>
                    <!-- KPIs -->
                    <div class="grid grid-cols-3 gap-2 mt-4">
                      <div class="text-center p-2 rounded" style="background: var(--vex-surface-strong)">
                        <p class="text-[10px] font-semibold uppercase" style="color: var(--vex-text-faint)">{{ p.winMode === 'TARGET' ? 'Meta CPA' : 'Posições' }}</p>
                        <p class="text-sm font-bold mt-0.5" style="color: var(--vex-text)">{{ p.winMode === 'TARGET' ? p.targetCpa : p.winnersCount }}</p>
                      </div>
                      <div class="text-center p-2 rounded" style="background: var(--vex-surface-strong)">
                        <p class="text-[10px] font-semibold uppercase" style="color: var(--vex-text-faint)">{{ p.liveStandings ? 'Líderes' : 'Vencedores' }}</p>
                        <p class="text-sm font-bold mt-0.5" style="color: var(--vex-text)">{{ p.winners.length }}</p>
                      </div>
                      <div class="text-center p-2 rounded" style="background: var(--vex-surface-strong)">
                        <p class="text-[10px] font-semibold uppercase" style="color: var(--vex-text-faint)">Prêmio</p>
                        <p class="text-sm font-bold mt-0.5" style="color: var(--vex-brand)">{{ p.prizeLabel || `R$ ${formatNumber(p.prizeValue)}` }}</p>
                      </div>
                    </div>

                    <!-- Quem está ganhando (ao vivo) / Vencedores (encerrada) -->
                    <div class="mt-4">
                      <p class="text-[10px] font-bold uppercase tracking-wide mb-1.5 flex items-center gap-1" style="color: var(--vex-text-faint)">
                        <UIcon :name="p.liveStandings ? 'i-lucide-flame' : 'i-lucide-award'" class="size-3" :style="p.liveStandings ? 'color: var(--vex-warning)' : 'color: var(--vex-positive)'" />
                        {{ p.liveStandings ? 'Quem está ganhando' : 'Vencedores' }}
                      </p>
                      <div v-if="p.winners.length > 0" class="space-y-1">
                        <div
                          v-for="w in p.winners"
                          :key="`${w.userId}-${w.rank}`"
                          class="flex items-center justify-between gap-2 text-[11px] px-2 py-1.5 rounded"
                          :style="w.isMe
                            ? 'background: var(--vex-brand-muted); border: 1px solid var(--vex-brand)'
                            : 'background: var(--vex-bg-muted)'"
                        >
                          <div class="flex items-center gap-2 min-w-0">
                            <span class="w-6 text-center shrink-0">{{ rankMedal(w.rank) }}</span>
                            <span class="font-semibold truncate" style="color: var(--vex-text)">{{ w.isMe ? 'Você' : w.userName }}</span>
                          </div>
                          <span class="font-bold shrink-0" style="color: var(--vex-brand)">{{ formatNumber(w.cpa) }} CPAs</span>
                        </div>
                      </div>
                      <p v-else class="text-[11px] px-2 py-1.5 rounded" style="color: var(--vex-text-faint); background: var(--vex-bg-muted)">
                        {{ p.liveStandings
                          ? 'Ninguém pontuou ainda — seja o primeiro!'
                          : (p.winMode === 'TARGET' ? `Ainda não há vencedores — alcance a meta de ${p.targetCpa} CPA!` : 'Sem vencedores registrados.') }}
                      </p>
                    </div>
                  </div>
                </article>
              </div>
            </section>

            <!-- ═══ RESGATADOS ═══ -->
            <section v-if="redeemedRewards.length > 0">
              <h2 class="text-sm font-bold mb-3 flex items-center gap-2" style="color: var(--vex-text)">
                <UIcon name="i-lucide-check-check" class="size-4" style="color: var(--vex-positive)" />
                Prêmios Resgatados
              </h2>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <article v-for="r in redeemedRewards" :key="`${r.prizeId}-${r.rank}`" class="vex-card p-5 flex items-start gap-4 opacity-70">
                  <div class="vex-icon-badge shrink-0" style="opacity: 0.5">
                    <UIcon :name="prizeIcon(r.prizeType)" class="size-4" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <h4 class="text-[13px] font-bold truncate" style="color: var(--vex-text)">{{ r.title }}</h4>
                    <p class="text-[11px] mt-0.5" style="color: var(--vex-text-faint)">
                      {{ r.rank }}º lugar · {{ formatNumber(r.cpaAchieved) }} CPAs
                    </p>
                    <p class="text-[11px] mt-1" style="color: var(--vex-positive)">
                      ✓ Resgatado {{ r.redeemedAt ? new Date(r.redeemedAt).toLocaleDateString('pt-BR') : '' }}
                    </p>
                  </div>
                </article>
              </div>
            </section>

            <!-- Empty — no prizes at all -->
            <div v-if="showcase.length === 0 && rewards.length === 0" class="vex-card py-20 flex flex-col items-center justify-center text-center">
              <div class="vex-icon-badge mb-4" style="width: 3.5rem; height: 3.5rem">
                <UIcon name="i-lucide-trophy" class="size-7" />
              </div>
              <h3 class="text-sm font-bold" style="color: var(--vex-text)">Nenhuma premiação ativa</h3>
              <p class="text-[12px] max-w-xs mt-1" style="color: var(--vex-text-faint)">
                Fique atento! Novas campanhas de premiação serão lançadas em breve.
              </p>
            </div>
          </template>
        </template>

      </div>
    </div>

    <!-- ═══ REDEEM MODAL ═══ -->
    <UModal :open="!!redeemTarget" title="Confirmar Resgate" @update:open="val => { if (!val) redeemTarget = null }">
      <template #content>
        <div class="p-5 space-y-4">
          <p class="text-[13px]" style="color: var(--vex-text)">
            Deseja resgatar o prêmio <strong>{{ redeemTarget?.label }}</strong>?
          </p>
          <p class="text-[11px]" style="color: var(--vex-text-faint)">
            Esta ação não pode ser desfeita. O valor será creditado ao seu saldo bônus.
          </p>
          <div class="flex justify-end gap-2 pt-2">
            <UButton label="Cancelar" variant="ghost" color="neutral" @click="redeemTarget = null" />
            <UButton label="Confirmar Resgate" color="primary" icon="i-lucide-check" :loading="redeeming" @click="confirmRedeem" />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>

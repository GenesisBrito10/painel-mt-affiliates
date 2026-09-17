<script setup lang="ts">
definePageMeta({ layout: 'default' })

interface DealEligibility {
  eligible: boolean
  required: boolean
  metricsHouseSlug: string
  windowDays: number
  minAvgDepositPerFtd: number
  minQualifiedFtd: number
  sumQualifiedFtd: number
  sumDeposit: number
  sumFtds: number
  avgDepositPerFtd: number | null
  reasons: string[]
}

interface DealItem {
  id: string
  name: string
  bettingHouseSlug: string
  houseName: string
  cpa: number
  revshare: number
  baseline: number
  exclusive: boolean
  featured: boolean
  newArrival: boolean
  logoUrl: string | null
  conditionsText: string | null
  paymentNotes: string | null
  trafficSources: string[]
  revenueType: string
  kind?: 'LINK' | 'FORM'
  formSchema?: unknown
  eligibility?: DealEligibility
  userStatus: 'PENDING' | 'FULFILLED' | 'REJECTED' | null
}

const { authHeaders, fetchMe } = useAuth()
const apiBase = useApiBase()
const toast = useToast()

const deals = ref<DealItem[]>([])
const loading = ref(false)
const submitting = ref<string | null>(null)
const detailDeal = ref<DealItem | null>(null)
// Deal kind=FORM aberta no modal de formulário (null = fechado).
const formDeal = ref<DealItem | null>(null)

function openDealForm(deal: DealItem) {
  detailDeal.value = null
  formDeal.value = deal
}

function onFormSubmitted() {
  const target = formDeal.value
  if (target) {
    const idx = deals.value.findIndex(d => d.id === target.id)
    if (idx !== -1) deals.value[idx] = { ...deals.value[idx], userStatus: 'PENDING' } as DealItem
  }
  void fetchDeals()
}

// ─── Filters & Search ───
const searchQuery = ref('')
const sortBy = ref('Recomendados')
const sortOptions = ['Recomendados', 'Maior CPA', 'Maior RevShare', 'Mais Recentes', 'A-Z']

const howItWorksOpen = ref(true)

function toggleHowItWorks() {
  howItWorksOpen.value = !howItWorksOpen.value
}

// ─── Computed ───
const filteredDeals = computed(() => {
  let result = [...deals.value]

  // Search
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase().trim()
    result = result.filter(d => d.houseName.toLowerCase().includes(q) || d.name.toLowerCase().includes(q))
  }

  // Sort
  switch (sortBy.value) {
    case 'Maior CPA': result.sort((a, b) => b.cpa - a.cpa); break
    case 'Maior RevShare': result.sort((a, b) => b.revshare - a.revshare); break
    case 'A-Z': result.sort((a, b) => a.houseName.localeCompare(b.houseName)); break
    case 'Mais Recentes': result.sort((a, b) => (b.newArrival ? 1 : 0) - (a.newArrival ? 1 : 0)); break
    default: // Recomendados: featured first, then by CPA
      result.sort((a, b) => {
        if (a.featured !== b.featured) return b.featured ? 1 : -1
        return b.cpa - a.cpa
      })
  }
  return result
})

const dealCount = computed(() => deals.value.length)
const newCount = computed(() => deals.value.filter(d => d.newArrival).length)
const resultCount = computed(() => filteredDeals.value.length)

// ─── API ───
async function fetchDeals() {
  loading.value = true
  try {
    const res = await $fetch<{ data: DealItem[] }>(`${apiBase}/v1/link-requests/deals`, { headers: authHeaders() })
    deals.value = res.data
  }
  catch { toast.add({ title: 'Erro ao carregar deals', color: 'error', icon: 'i-lucide-x-circle' }) }
  finally { loading.value = false }
}

async function requestAffiliation(deal: DealItem) {
  // Deals kind=FORM não solicitam link direto — abrem o formulário dinâmico.
  if (deal.kind === 'FORM') {
    openDealForm(deal)
    return
  }
  if (!canRequestDeal(deal)) {
    toast.add({
      title: 'Requisito ainda não atingido',
      description: eligibilityReason(deal),
      color: 'warning',
      icon: 'i-lucide-lock',
    })
    return
  }

  submitting.value = deal.id
  try {
    await $fetch(`${apiBase}/v1/link-requests`, {
      method: 'POST',
      headers: authHeaders(),
      body: { dealId: deal.id },
    })
    const idx = deals.value.findIndex(d => d.id === deal.id)
    if (idx !== -1) deals.value[idx] = { ...deals.value[idx], userStatus: 'PENDING' } as DealItem
    if (detailDeal.value?.id === deal.id) {
      detailDeal.value = { ...deal, userStatus: 'PENDING' } as DealItem
    }
    if (deal.bettingHouseSlug === 'superbet') await fetchMe()
    toast.add({ title: 'Solicitação enviada!', description: `Aguarde aprovação para ${deal.houseName}.`, color: 'success', icon: 'i-lucide-check-circle' })
  }
  catch (err: unknown) {
    const data = (err as { data?: { message?: string; error?: string; reasons?: string[] } })?.data
    const msg = data?.message ?? data?.error ?? data?.reasons?.[0] ?? 'Tente novamente.'
    toast.add({ title: 'Erro ao solicitar', description: msg, color: 'error', icon: 'i-lucide-x-circle' })
  }
  finally { submitting.value = null }
}

function fmt(v: number) {
  return v > 0 ? `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : 'R$ 0,00'
}
function fmtCpa(v: number) {
  return v > 0 ? `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}` : 'Personalizável'
}
function fmtPct(v: number) { return v > 0 ? `${v}%` : '0%' }
function fmtCurrencyPrecise(v: number | null | undefined) {
  const value = typeof v === 'number' ? v : 0
  return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function lockedRequestLabel(deal: DealItem) {
  const reason = deal.eligibility?.reasons?.[0]
  if (reason && reason.length <= 48) return reason
  return 'Requisito não atingido'
}

function canRequestDeal(deal: DealItem) {
  const statusAllowsRequest = !deal.userStatus || deal.userStatus === 'REJECTED'
  return statusAllowsRequest && (deal.eligibility?.eligible ?? true)
}

function eligibilityReason(deal: DealItem) {
  if (!deal.eligibility?.required) return 'Este deal não exige a métrica de liberação.'
  if (deal.eligibility.reasons[0]) return deal.eligibility.reasons[0]
  if (deal.eligibility.minAvgDepositPerFtd > 0) {
    return `Você precisa ter pelo menos ${deal.eligibility.minQualifiedFtd} CPAs qualificados e depósito médio de ${fmtCurrencyPrecise(deal.eligibility.minAvgDepositPerFtd)} na Superbet.`
  }
  return `Você precisa ter pelo menos ${deal.eligibility.minQualifiedFtd} CPAs qualificados na Superbet nos últimos ${deal.eligibility.windowDays} dias.`
}

function clearFilters() {
  searchQuery.value = ''
  sortBy.value = 'Recomendados'
}

onMounted(async () => {
  await fetchDeals()
  // Prompt "acordo Superbet obrigatório" removido — acordo não é mais exigido.
})
</script>

<template>
  <div class="min-h-full flex flex-col relative">

    <!-- PAGE HEADER -->
    <header class="vex-page-header">
      <div class="flex items-center gap-2.5">
        <UIcon name="i-lucide-store" class="size-[18px]" style="color: var(--vex-brand)" />
        <h1 class="text-[15px] font-bold vex-title">Marketplace</h1>
        <span v-if="dealCount > 0" class="vex-shell-chip text-[11px] font-semibold px-2 py-0.5 rounded">
          {{ dealCount }} deals
        </span>
      </div>
      <div class="flex items-center gap-2">
        <!-- Search -->
        <div class="relative hidden sm:block">
          <UIcon name="i-lucide-search" class="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5" style="color: var(--vex-text-faint); pointer-events: none" />
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Buscar operadora..."
            class="h-8 w-[200px] lg:w-[240px] pl-8 pr-3 rounded-lg text-xs font-medium outline-none transition-colors"
            style="background: var(--vex-bg-muted); border: 1px solid var(--vex-border-subtle); color: var(--vex-text)"
            @focus="($event.target as HTMLInputElement).style.borderColor = 'var(--vex-brand)'"
            @blur="($event.target as HTMLInputElement).style.borderColor = 'var(--vex-border-subtle)'"
          >
        </div>
        <!-- Sort -->
        <USelect v-model="sortBy" :items="sortOptions" class="w-[150px] hidden md:block" icon="i-lucide-arrow-up-down" size="sm" />
      </div>
    </header>

    <!-- HOW IT WORKS SECTION -->
    <div>
      <!-- Section Header / Toggle -->
      <div
        class="flex items-center justify-between py-3 cursor-pointer select-none"
        style="border-bottom: 1px solid var(--vex-border-subtle)"
        @click="toggleHowItWorks"
      >
        <div class="flex items-center gap-2">
          <div class="vex-icon-badge vex-icon-badge--sm">
            <UIcon name="i-lucide-graduation-cap" class="size-3.5" />
          </div>
          <span class="text-[13px] font-bold" style="color: var(--vex-text)">Como funciona?</span>
          <span class="text-[11px] font-medium" style="color: var(--vex-text-faint)">Guia rápido do marketplace</span>
        </div>
        <UIcon
          :name="howItWorksOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
          class="size-4 transition-transform duration-200"
          style="color: var(--vex-text-faint)"
        />
      </div>

      <!-- Collapsible Content -->
      <Transition
        enter-active-class="transition-all duration-300 ease-out overflow-hidden"
        enter-from-class="max-h-0 opacity-0"
        enter-to-class="max-h-[600px] opacity-100"
        leave-active-class="transition-all duration-200 ease-in overflow-hidden"
        leave-from-class="max-h-[600px] opacity-100"
        leave-to-class="max-h-0 opacity-0"
      >
        <div v-if="howItWorksOpen" class="pt-4 pb-5" style="border-bottom: 1px solid var(--vex-border-subtle)">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">

            <!-- Step 1 -->
            <div class="relative rounded-xl p-5 overflow-hidden" style="background: var(--vex-surface); border: 1px solid var(--vex-border)">
              <div class="absolute -bottom-3 -right-1 text-7xl font-black select-none" style="color: var(--vex-text); opacity: 0.035; line-height: 1">1</div>
              <div class="flex items-center gap-3 mb-4">
                <div class="size-9 rounded-lg flex items-center justify-center shrink-0" style="background: var(--vex-brand-muted); border: 1px solid var(--vex-brand-soft-border)">
                  <UIcon name="i-lucide-search" class="size-4" style="color: var(--vex-brand)" />
                </div>
                <div>
                  <span class="text-[10px] font-bold uppercase tracking-widest" style="color: var(--vex-brand)">Passo 1</span>
                  <h4 class="text-[14px] font-bold leading-tight" style="color: var(--vex-text)">Escolha um deal</h4>
                </div>
              </div>
              <p class="text-[13px] leading-relaxed" style="color: var(--vex-text-muted)">
                Explore o catálogo de operadoras disponíveis. Compare CPA, RevShare e condições. Selecione o deal que melhor se encaixa no seu tráfego e audiência.
              </p>
              <div class="flex items-center gap-1.5 mt-4">
                <span class="vex-badge vex-badge--new">CPA</span>
                <span class="vex-badge vex-badge--featured">RevShare</span>
                <span class="text-[11px]" style="color: var(--vex-text-faint)">compare e decida</span>
              </div>
            </div>

            <!-- Step 2 -->
            <div class="relative rounded-xl p-5 overflow-hidden" style="background: var(--vex-surface); border: 1px solid var(--vex-border)">
              <div class="absolute -bottom-3 -right-1 text-7xl font-black select-none" style="color: var(--vex-text); opacity: 0.035; line-height: 1">2</div>
              <div class="flex items-center gap-3 mb-4">
                <div class="size-9 rounded-lg flex items-center justify-center shrink-0" style="background: var(--vex-warning-light); border: 1px solid var(--vex-warning-soft-border)">
                  <UIcon name="i-lucide-clock" class="size-4" style="color: var(--vex-warning)" />
                </div>
                <div>
                  <span class="text-[10px] font-bold uppercase tracking-widest" style="color: var(--vex-warning)">Passo 2</span>
                  <h4 class="text-[14px] font-bold leading-tight" style="color: var(--vex-text)">Aprovação do deal</h4>
                </div>
              </div>
              <p class="text-[13px] leading-relaxed" style="color: var(--vex-text-muted)">
                Após solicitar afiliação, a operadora analisa seu perfil. O processo leva até <strong style="color: var(--vex-text)">3 dias úteis</strong>. Aprovado, você recebe seu link de afiliado e pode usar todas as ferramentas do painel.
              </p>
              <div class="flex items-center gap-1.5 mt-4">
                <UIcon name="i-lucide-bell" class="size-3.5" style="color: var(--vex-text-faint)" />
                <span class="text-[11px]" style="color: var(--vex-text-faint)">Você será notificado ao ser aprovado</span>
              </div>
            </div>

            <!-- Step 3 -->
            <div class="relative rounded-xl p-5 overflow-hidden" style="background: var(--vex-surface); border: 1px solid var(--vex-border)">
              <div class="absolute -bottom-3 -right-1 text-7xl font-black select-none" style="color: var(--vex-text); opacity: 0.035; line-height: 1">3</div>
              <div class="flex items-center gap-3 mb-4">
                <div class="size-9 rounded-lg flex items-center justify-center shrink-0" style="background: var(--vex-positive-light); border: 1px solid var(--vex-positive-soft-border)">
                  <UIcon name="i-lucide-trending-up" class="size-4" style="color: var(--vex-positive)" />
                </div>
                <div>
                  <span class="text-[10px] font-bold uppercase tracking-widest" style="color: var(--vex-positive)">Passo 3</span>
                  <h4 class="text-[14px] font-bold leading-tight" style="color: var(--vex-text)">Fature!</h4>
                </div>
              </div>
              <p class="text-[13px] leading-relaxed" style="color: var(--vex-text-muted)">
                Leve jogadores para a casa de apostas usando seu link de afiliado. O pagamento é feito conforme as regras do deal — CPA por jogador qualificado ou RevShare sobre o GGR gerado.
              </p>
              <div class="flex items-center gap-1.5 mt-4">
                <UIcon name="i-lucide-zap" class="size-3.5" style="color: var(--vex-positive)" />
                <span class="text-[11px] font-medium" style="color: var(--vex-positive)">Comissão automática no painel</span>
              </div>
            </div>

          </div>
        </div>
      </Transition>
    </div>


    <!-- CONTENT -->
    <main class="flex-1 relative">
      <div class="w-full pb-16">

        <!-- Context Bar -->
        <div class="vex-context-bar">
          <span>
            <template v-if="searchQuery">
              {{ resultCount }} resultado{{ resultCount !== 1 ? 's' : '' }}
            </template>
            <template v-else>
              {{ dealCount }} deals disponíveis<span v-if="newCount > 0" class="hidden sm:inline"> · {{ newCount }} novo{{ newCount !== 1 ? 's' : '' }} esta semana</span>
            </template>
          </span>
        </div>

        <!-- LOADING SKELETONS -->
        <div v-if="loading" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          <div v-for="i in 6" :key="i" class="vex-deal-card animate-pulse" style="cursor: default">
            <div class="flex items-start gap-3">
              <div class="size-11 rounded-[10px]" style="background: var(--vex-bg-muted)" />
              <div class="flex-1 space-y-2">
                <div class="h-4 w-28 rounded" style="background: var(--vex-bg-muted)" />
                <div class="h-3 w-16 rounded" style="background: var(--vex-bg-muted)" />
              </div>
            </div>
            <div class="vex-metric-hero" style="border-color: transparent">
              <div class="h-3 w-8 rounded mb-2" style="background: var(--vex-bg-muted)" />
              <div class="h-6 w-24 rounded" style="background: var(--vex-bg-muted)" />
            </div>
            <div class="flex gap-3 mt-2.5">
              <div class="flex-1 space-y-1.5">
                <div class="h-2.5 w-12 rounded" style="background: var(--vex-bg-muted)" />
                <div class="h-3.5 w-10 rounded" style="background: var(--vex-bg-muted)" />
              </div>
              <div class="flex-1 space-y-1.5">
                <div class="h-2.5 w-12 rounded" style="background: var(--vex-bg-muted)" />
                <div class="h-3.5 w-16 rounded" style="background: var(--vex-bg-muted)" />
              </div>
            </div>
            <div class="flex gap-2 mt-5">
              <div class="flex-1 h-9 rounded-lg" style="background: var(--vex-bg-muted)" />
              <div class="flex-[1.2] h-9 rounded-lg" style="background: var(--vex-bg-muted)" />
            </div>
          </div>
        </div>

        <template v-else>
          <!-- EMPTY STATE -->
          <div v-if="filteredDeals.length === 0" class="py-20 flex flex-col items-center justify-center text-center px-4">
            <div class="vex-icon-badge mb-4" style="width: 3rem; height: 3rem">
              <UIcon :name="searchQuery ? 'i-lucide-search-x' : 'i-lucide-package-open'" class="size-6" />
            </div>
            <h3 class="text-sm font-bold" style="color: var(--vex-text)">
              {{ searchQuery ? 'Nenhum deal encontrado' : 'Nenhum deal disponível no momento' }}
            </h3>
            <p class="text-xs max-w-xs mt-1.5 mb-5" style="color: var(--vex-text-muted)">
              {{ searchQuery ? 'Tente ajustar os filtros ou buscar por outro termo.' : 'Novos deals são adicionados frequentemente. Volte em breve.' }}
            </p>
            <button v-if="searchQuery" class="vex-cta-secondary" @click="clearFilters">
              Limpar filtros
            </button>
          </div>

          <!-- DEAL GRID -->
          <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5 vex-stagger">
            <DealCard
              v-for="deal in filteredDeals"
              :key="deal.id"
              :deal="deal"
              :submitting="submitting === deal.id"
              @request="requestAffiliation(deal)"
              @detail="detailDeal = deal"
            />
          </div>
        </template>
      </div>
    </main>

    <!-- DETAIL SLIDEOVER -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0 translate-x-8"
        enter-to-class="opacity-100 translate-x-0"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="opacity-100 translate-x-0"
        leave-to-class="opacity-0 translate-x-8"
      >
        <div v-if="detailDeal" class="fixed inset-0 z-50 flex justify-end">
          <div class="absolute inset-0 bg-black/50 backdrop-blur-[2px]" @click="detailDeal = null" />

          <div class="relative w-full md:w-[480px] h-full shadow-2xl flex flex-col" style="background: var(--vex-surface)">

            <!-- Header -->
            <div class="p-4 sm:p-6 shrink-0 flex justify-between items-start gap-4" style="background: var(--vex-surface-strong)">
              <div class="flex items-center gap-3 sm:gap-4 min-w-0">
                <div class="size-12 sm:size-14 rounded-xl overflow-hidden shrink-0 flex items-center justify-center font-bold text-xl shadow-sm" style="background: var(--vex-surface); color: var(--vex-brand); border: 1px solid var(--vex-border-subtle)">
                  <img v-if="detailDeal.logoUrl" :src="detailDeal.logoUrl" :alt="detailDeal.houseName" class="size-full object-cover">
                  <span v-else>{{ detailDeal.houseName.charAt(0).toUpperCase() }}</span>
                </div>
                <div class="min-w-0">
                  <h2 class="text-lg sm:text-xl font-bold truncate vex-title" style="color: var(--vex-text)">{{ detailDeal.houseName }}</h2>
                  <p class="text-[13px] sm:text-[14px] mt-0.5 truncate" style="color: var(--vex-text-faint)">{{ detailDeal.name }}</p>
                  <!-- Badges -->
                  <div class="flex gap-1.5 mt-2 flex-wrap">
                    <span v-if="detailDeal.featured" class="vex-badge vex-badge--featured"><UIcon name="i-lucide-star" class="size-2.5" /> Destaque</span>
                    <span v-if="detailDeal.newArrival" class="vex-badge vex-badge--new"><UIcon name="i-lucide-sparkles" class="size-2.5" /> Novo</span>
                    <span v-if="detailDeal.exclusive" class="vex-badge vex-badge--exclusive"><UIcon name="i-lucide-lock" class="size-2.5" /> Exclusivo</span>
                  </div>
                </div>
              </div>
              <button class="p-1.5 rounded-lg shrink-0 transition-colors" style="background: var(--vex-surface); border: 1px solid var(--vex-border-subtle); color: var(--vex-text-faint)" @click="detailDeal = null">
                <UIcon name="i-lucide-x" class="size-5" />
              </button>
            </div>

            <!-- Header Stats -->
            <div class="flex items-center justify-between px-4 sm:px-6 py-4 shrink-0" style="background: var(--vex-surface); border-bottom: 1px solid var(--vex-border-subtle)">
              <div class="flex-1 text-center sm:text-left">
                <p class="vex-metric-label mb-1">CPA</p>
                <p class="font-bold font-money text-[15px] sm:text-lg" :style="{ color: detailDeal.cpa > 0 ? 'var(--vex-positive)' : 'var(--vex-text-faint)' }">{{ fmtCpa(detailDeal.cpa) }}</p>
              </div>
              <div class="flex-1 text-center" style="border-left: 1px solid var(--vex-border-subtle); border-right: 1px solid var(--vex-border-subtle)">
                <p class="vex-metric-label mb-1">Rev Share</p>
                <p class="font-bold font-money text-[15px] sm:text-lg" style="color: var(--vex-brand)">{{ fmtPct(detailDeal.revshare) }}</p>
              </div>
              <div class="flex-1 text-center sm:text-right">
                <p class="vex-metric-label mb-1">Baseline</p>
                <p class="font-bold font-money text-[15px] sm:text-lg" style="color: var(--vex-text)">{{ fmt(detailDeal.baseline) }}</p>
              </div>
            </div>

            <!-- Content -->
            <div class="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
              <!-- Conditions -->
              <div>
                <div class="flex items-center gap-2.5 mb-3">
                  <div class="vex-icon-badge vex-icon-badge--sm"><UIcon name="i-lucide-trending-up" class="size-3.5" /></div>
                  <h3 class="font-bold text-[14px]" style="color: var(--vex-text)">Indicadores Mínimos (KPIs)</h3>
                </div>
                <div class="text-[13px] leading-relaxed p-4 rounded-xl" style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle); color: var(--vex-text-muted)">
                  <p v-if="detailDeal.conditionsText" class="whitespace-pre-line">{{ detailDeal.conditionsText }}</p>
                  <p v-else style="color: var(--vex-text-faint); font-style: italic">Indicadores não configurados para este deal.</p>
                </div>
              </div>

              <!-- Payment -->
              <div>
                <div class="flex items-center gap-2.5 mb-3">
                  <div class="vex-icon-badge vex-icon-badge--sm"><UIcon name="i-lucide-banknote" class="size-3.5" /></div>
                  <h3 class="font-bold text-[14px]" style="color: var(--vex-text)">Regras de Pagamento</h3>
                </div>
                <div class="text-[13px] leading-relaxed p-4 rounded-xl" style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle); color: var(--vex-text-muted)">
                  <p v-if="detailDeal.paymentNotes" class="whitespace-pre-line">{{ detailDeal.paymentNotes }}</p>
                  <p v-else style="color: var(--vex-text-faint); font-style: italic">Regras de pagamento não configuradas para este deal.</p>
                </div>
              </div>

              <!-- Traffic Sources -->
              <div v-if="detailDeal.trafficSources.length">
                <div class="flex items-center gap-2.5 mb-3">
                  <div class="vex-icon-badge vex-icon-badge--sm"><UIcon name="i-lucide-users" class="size-3.5" /></div>
                  <h3 class="font-bold text-[14px]" style="color: var(--vex-text)">Fontes de Tráfego</h3>
                </div>
                <div class="flex flex-wrap gap-2">
                  <span v-for="src in detailDeal.trafficSources" :key="src" class="px-3 py-1.5 rounded-lg text-[12px] font-semibold" style="background: var(--vex-bg-muted); color: var(--vex-text); border: 1px solid var(--vex-border-subtle)">{{ src }}</span>
                </div>
              </div>

              <!-- Info Box -->
              <div class="rounded-xl p-4" style="background: var(--vex-info-light); border: 1px solid var(--vex-info-soft-border)">
                <div class="flex items-center gap-2 mb-2">
                  <UIcon name="i-lucide-info" class="size-4" style="color: var(--vex-info)" />
                  <h4 class="font-bold text-[13px]" style="color: var(--vex-info)">Requisitos de Qualidade</h4>
                </div>
                <div class="text-[12px] leading-relaxed" style="color: var(--vex-text-muted)">
                  <p v-if="detailDeal.eligibility?.required && detailDeal.eligibility.minAvgDepositPerFtd > 0">
                    Liberação pela Superbet: {{ detailDeal.eligibility.sumQualifiedFtd }} CPAs qualificados e depósito médio de
                    <strong style="color: var(--vex-text)">{{ fmtCurrencyPrecise(detailDeal.eligibility.avgDepositPerFtd) }}</strong>
                    nos últimos {{ detailDeal.eligibility.windowDays }} dias.
                    Mínimo configurado:
                    <strong style="color: var(--vex-text)">{{ detailDeal.eligibility.minQualifiedFtd }} CPAs</strong>
                    e
                    <strong style="color: var(--vex-text)">{{ fmtCurrencyPrecise(detailDeal.eligibility.minAvgDepositPerFtd) }}</strong>.
                  </p>
                  <p v-else-if="detailDeal.eligibility?.required">
                    Liberação pela Superbet: <strong style="color: var(--vex-text)">{{ detailDeal.eligibility.sumQualifiedFtd }} CPAs qualificados</strong>
                    nos últimos {{ detailDeal.eligibility.windowDays }} dias.
                    Mínimo configurado:
                    <strong style="color: var(--vex-text)">{{ detailDeal.eligibility.minQualifiedFtd }} CPAs qualificados na Superbet</strong>.
                  </p>
                  <p v-else>Este deal não exige a métrica de liberação por depósito médio na Superbet.</p>
                  <p v-if="detailDeal.eligibility?.required && !detailDeal.eligibility.eligible" class="mt-2" style="color: var(--vex-warning)">
                    {{ eligibilityReason(detailDeal) }}
                  </p>
                </div>
              </div>
            </div>

            <!-- Footer CTA -->
            <div class="p-5 sm:p-6 shrink-0" style="background: var(--vex-surface); border-top: 1px solid var(--vex-border-subtle); box-shadow: var(--vex-shadow-surface-top)">
              <!-- Quick ref -->
              <p class="text-[11px] font-medium mb-3 text-center" style="color: var(--vex-text-faint)">
                CPA {{ fmtCpa(detailDeal.cpa) }} · RevShare {{ fmtPct(detailDeal.revshare) }} · Baseline {{ fmt(detailDeal.baseline) }}
              </p>
              <button
                v-if="!detailDeal.userStatus || detailDeal.userStatus === 'REJECTED'"
                class="vex-cta-primary w-full !h-12 !text-[14px] uppercase tracking-wide"
                :disabled="submitting === detailDeal.id || !canRequestDeal(detailDeal)"
                :style="!canRequestDeal(detailDeal) ? 'opacity: 0.55; cursor: not-allowed; filter: grayscale(0.2)' : undefined"
                @click="requestAffiliation(detailDeal)"
              >
                <UIcon v-if="submitting === detailDeal.id" name="i-lucide-loader-2" class="size-5 animate-spin" />
                <UIcon v-else :name="detailDeal.kind === 'FORM' ? 'i-lucide-clipboard-list' : (canRequestDeal(detailDeal) ? 'i-lucide-zap' : 'i-lucide-lock')" class="size-5" />
                {{ detailDeal.kind === 'FORM' ? (detailDeal.userStatus === 'REJECTED' ? 'Preencher formulário novamente' : 'Preencher formulário') : (submitting === detailDeal.id ? 'Enviando Solicitação...' : (!canRequestDeal(detailDeal) ? lockedRequestLabel(detailDeal) : (detailDeal.userStatus === 'REJECTED' ? 'Solicitar Novamente' : 'Solicitar afiliação neste deal'))) }}
              </button>
              <div
                v-else
                :class="['vex-cta-status w-full !h-12 !text-[14px] uppercase tracking-wide', detailDeal.userStatus === 'PENDING' ? 'vex-cta-status--pending' : 'vex-cta-status--approved']"
              >
                <UIcon :name="detailDeal.userStatus === 'PENDING' ? 'i-lucide-clock' : 'i-lucide-check-circle'" class="size-5" />
                {{ detailDeal.userStatus === 'PENDING' ? 'Solicitação Pendente de Análise' : 'Solicitação Aprovada' }}
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- FORM DEAL MODAL (deals kind=FORM) -->
    <DealFormModal
      :deal="formDeal"
      @close="formDeal = null"
      @submitted="onFormSubmitted"
    />
  </div>
</template>

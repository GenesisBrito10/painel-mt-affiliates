<script setup lang="ts">
definePageMeta({ layout: 'default' })

const {
  houses,
  linkRequests,
  dealRequests,
  loadingLinks,
  loadingDeals,
  submitting,
  approveDealRequest,
  setCpa,
  fetchReferrerCeiling,
  fetchLinkRequests,
  fetchDealRequests,
  init,
} = useLinkRequests()

const { user } = useAuth()
const toast = useToast()

// ─── Filtered views ───────────────────────────────────────────────────────────
// "Meus Links": only requests created by the logged-in user
const myLinkRequests = computed(() =>
  linkRequests.value.filter(r => r.userId === user.value?.id)
)

// "Deal Requests": requests from users invited by the logged-in user
const inviteeLinkRequests = computed(() =>
  dealRequests.value
)

const dealFilters = reactive({
  house: 'all',
  status: 'all',
  search: '',
})

const dealHouseOptions = computed(() => {
  const slugs = new Set(inviteeLinkRequests.value.map(req => req.bettingHouseSlug).filter(Boolean))
  return [
    { label: 'Todas as casas', value: 'all' },
    ...Array.from(slugs).map((slug) => {
      const house = houses.value.find(h => h.slug === slug)
      return { label: house?.name ?? slug, value: slug }
    }).sort((a, b) => a.label.localeCompare(b.label)),
  ]
})

const dealStatusOptions = [
  { label: 'Todos os status', value: 'all' },
  { label: 'Pendentes', value: 'PENDING' },
  { label: 'Aprovados', value: 'FULFILLED' },
  { label: 'Recusados', value: 'REJECTED' },
]

const filteredDealRequests = computed(() => {
  const q = dealFilters.search.trim().toLowerCase()
  return inviteeLinkRequests.value.filter((req) => {
    const matchesHouse = dealFilters.house === 'all' || req.bettingHouseSlug === dealFilters.house
    const matchesStatus = dealFilters.status === 'all' || req.status === dealFilters.status
    const matchesSearch = !q
      || req.userName?.toLowerCase().includes(q)
      || req.userEmail?.toLowerCase().includes(q)
    return matchesHouse && matchesStatus && matchesSearch
  })
})

const hasActiveDealFilters = computed(() =>
  dealFilters.house !== 'all' || dealFilters.status !== 'all' || dealFilters.search.trim() !== ''
)

function clearDealFilters() {
  dealFilters.house = 'all'
  dealFilters.status = 'all'
  dealFilters.search = ''
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────
type Tab = 'links' | 'deals'
const activeTab = ref<Tab>('links')

// ─── Status config ────────────────────────────────────────────────────────────
const statusMap: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  PENDING:   { label: 'Pendente',  color: 'var(--vex-warning)',  bg: 'var(--vex-warning-light)',  icon: 'i-lucide-clock' },
  FULFILLED: { label: 'Aprovado', color: 'var(--vex-positive)', bg: 'var(--vex-positive-light)', icon: 'i-lucide-check-circle' },
  REJECTED:  { label: 'Recusado', color: 'var(--vex-negative)', bg: 'var(--vex-negative-light)', icon: 'i-lucide-x-circle' },
}

// ─── Deal Approve Modal ───────────────────────────────────────────────────────
const approveModal = ref<{ show: boolean; item: any | null }>({ show: false, item: null })
const approveForm = reactive({ cpa: '', revshare: '', adminNote: '' })
const ceilingLoading = ref(false)
const ceiling = ref<{
  hasCeiling: boolean
  maxCpa?: number
  maxRevshare?: number
  presetCpa?: number | null
  presetRevshare?: number | null
  awaitingAutoAssign?: boolean
} | null>(null)

async function openApprove(item: any) {
  approveModal.value = { show: true, item }
  approveForm.cpa = ''
  approveForm.revshare = ''
  approveForm.adminNote = ''
  ceiling.value = null
  ceilingLoading.value = true
  try {
    const data = await fetchReferrerCeiling(item.id)
    ceiling.value = data
    // Pre-fill with preset values if available
    if (data.presetCpa != null) approveForm.cpa = String(data.presetCpa)
    if (data.presetRevshare != null) approveForm.revshare = String(data.presetRevshare)
  } finally {
    ceilingLoading.value = false
  }
}

async function onApprove() {
  if (!approveModal.value.item) return
  const item = approveModal.value.item
  const cpa = approveForm.cpa ? Number(approveForm.cpa) : undefined
  const revshare = approveForm.revshare ? Number(approveForm.revshare) : undefined
  // esportiva-diario: CPA manual — seta só o CPA (a planilha atribui o link).
  const result = item.bettingHouseSlug === 'esportiva-diario'
    ? await setCpa(item.id, cpa ?? 0, revshare)
    : await approveDealRequest(item.id, {
        cpa,
        revshare,
        adminNote: approveForm.adminNote || undefined,
      })
  if (result.success) {
    approveModal.value.show = false
    toast.add({ title: 'Deal aprovado!', color: 'success', icon: 'i-lucide-check-circle' })
  } else {
    toast.add({ title: 'Erro', description: result.error, color: 'error', icon: 'i-lucide-x-circle' })
  }
}

async function onReject(id: string) {
  const result = await approveDealRequest(id, { action: 'reject' })
  if (result.success) {
    toast.add({ title: 'Solicitação recusada', color: 'warning', icon: 'i-lucide-x-circle' })
  } else {
    toast.add({ title: 'Erro', description: result.error, color: 'error', icon: 'i-lucide-x-circle' })
  }
}

// ─── Pending counts ───────────────────────────────────────────────────────────
const pendingLinks = computed(() => myLinkRequests.value.filter(r => r.status === 'PENDING').length)
const pendingDeals = computed(() => inviteeLinkRequests.value.filter(r => r.status === 'PENDING').length)

// ─── Copy link ────────────────────────────────────────────────────────────────
const copiedId = ref<string | null>(null)
function copyLink(id: string, url: string) {
  navigator.clipboard.writeText(url)
  copiedId.value = id
  setTimeout(() => copiedId.value = null, 2000)
  toast.add({ title: 'Link copiado!', color: 'success', icon: 'i-lucide-check-circle' })
}

const formatDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })

onMounted(async () => {
  await init()
})
</script>

<template>
  <div class="min-h-full flex flex-col">
    <!-- ─── HEADER ─── -->
    <header class="vex-page-header">
      <div class="flex items-center gap-3">
        <h1 class="text-base font-bold vex-title">Meus Links</h1>
        <span class="vex-shell-chip hidden md:inline-block text-[11px] font-medium px-2 py-0.5 rounded">
          {{ myLinkRequests.filter(r => r.status === 'FULFILLED').length }} ativos
        </span>
      </div>
      <div class="flex items-center gap-2">
        <UButton
          color="neutral" variant="outline" icon="i-lucide-refresh-cw" size="sm"
          :loading="loadingLinks || loadingDeals"
          @click="activeTab === 'links' ? fetchLinkRequests() : fetchDealRequests()"
        />
      </div>
    </header>

    <!-- ─── TABS ─── -->
    <div
      class="flex-shrink-0 sticky top-[3.25rem] z-[9] py-2"
      style="border-bottom: 1px solid var(--vex-border-subtle)"
    >
      <div class="vex-shell-segmented inline-flex items-center gap-1 p-1 rounded-xl">
        <button
          v-for="tab in ([
            { key: 'links', label: 'Meus Links',    icon: 'i-lucide-link',    count: pendingLinks },
            { key: 'deals', label: 'Deal Requests', icon: 'i-lucide-handshake', count: pendingDeals },
          ] as const)"
          :key="tab.key"
          class="vex-shell-tab relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all duration-150 whitespace-nowrap"
          :class="activeTab === tab.key ? 'is-active' : ''"
          @click="activeTab = tab.key"
        >
          <UIcon :name="tab.icon" class="size-3.5 shrink-0" />
          <span class="hidden sm:inline">{{ tab.label }}</span>
          <span
            v-if="tab.count > 0"
            class="vex-shell-tab-count inline-flex items-center justify-center size-4 rounded-full text-[9px] font-bold"
            :class="activeTab === tab.key ? 'is-active' : ''"
          >{{ tab.count }}</span>
        </button>
      </div>
    </div>

    <!-- ─── CONTENT ─── -->
    <div class="flex-1">
      <div class="py-5 space-y-4 w-full">

        <!-- ══════ LINK REQUESTS TAB ══════ -->
        <section v-show="activeTab === 'links'">
          <!-- Loading -->
          <div v-if="loadingLinks" class="space-y-3">
            <div v-for="i in 4" :key="i" class="h-24 rounded-xl animate-pulse" style="background: var(--vex-surface)" />
          </div>

          <!-- Empty -->
          <div v-else-if="!myLinkRequests.length" class="flex flex-col items-center justify-center py-20 gap-3">
            <div class="size-14 rounded-full flex items-center justify-center" style="background: var(--vex-surface-strong)">
              <UIcon name="i-lucide-link" class="size-7" style="color: var(--vex-text-faint)" />
            </div>
            <p class="text-sm font-semibold" style="color: var(--vex-text)">Nenhuma solicitação ainda</p>
            <p class="text-[12px]" style="color: var(--vex-text-faint)">Nenhum link disponível no momento</p>
          </div>

          <!-- Grid -->
          <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 vex-stagger">
            <article
              v-for="req in myLinkRequests"
              :key="req.id"
              class="vex-card p-4 flex flex-col gap-3"
            >
              <!-- Header -->
              <div class="flex items-start justify-between gap-2">
                <div class="flex items-center gap-2.5 min-w-0">
                  <div class="vex-icon-badge" style="width: 2.25rem; height: 2.25rem; flex-shrink: 0">
                    <UIcon name="i-lucide-building-2" class="size-4" />
                  </div>
                  <div class="min-w-0">
                    <p class="font-semibold text-[13px] truncate" style="color: var(--vex-text)">
                      <HouseBadge :slug="req.bettingHouseSlug" size="sm" />
                    </p>
                    <p class="text-[11px] truncate" style="color: var(--vex-text-faint)">
                      {{ req.dealName ?? 'Link avulso' }}
                    </p>
                  </div>
                </div>
                <!-- Status badge -->
                <span
                  class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0"
                  :style="{ color: statusMap[req.status]?.color, background: statusMap[req.status]?.bg }"
                >
                  <UIcon :name="statusMap[req.status]?.icon ?? ''" class="size-3" />
                  {{ statusMap[req.status]?.label }}
                </span>
              </div>

              <!-- Message -->
              <p v-if="req.message" class="text-[11px] leading-relaxed px-1" style="color: var(--vex-text-faint)">
                "{{ req.message }}"
              </p>

              <!-- Admin note -->
              <div
                v-if="req.adminNote"
                class="rounded-lg px-3 py-2 text-[11px]"
                style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle); color: var(--vex-text-muted)"
              >
                <span class="font-bold" style="color: var(--vex-text-faint)">Nota: </span>{{ req.adminNote }}
              </div>

              <!-- Bloqueio por dependência / regra -->
              <div
                v-if="req.status === 'REJECTED' && req.blockedReason"
                class="rounded-lg px-3 py-2 text-[11px]"
                style="background: var(--vex-negative-soft, rgba(200,60,60,0.08)); border: 1px solid var(--vex-border-subtle); color: var(--vex-negative)"
              >
                {{ req.blockedReason }}
              </div>

              <!-- Aguardando link no pool -->
              <div
                v-else-if="req.status === 'PENDING' && !req.links.length"
                class="rounded-lg px-3 py-2 text-[11px]"
                style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle); color: var(--vex-text-muted)"
              >
                Sua solicitação foi criada. Assim que houver um link disponível, ele será atribuído automaticamente.
                <span v-if="req.resolvedCpa != null"> (CPA {{ req.resolvedCpa }})</span>
              </div>

              <!-- Links -->
              <div v-if="req.links.length" class="space-y-1.5">
                <p class="text-[10px] font-bold uppercase tracking-[0.1em]" style="color: var(--vex-text-faint)">Links Ativos</p>
                <div
                  v-for="(lk, i) in req.links"
                  :key="i"
                  class="flex items-center gap-2 rounded-lg px-3 py-2"
                  style="background: var(--vex-bg-muted); border: 1px solid var(--vex-border-subtle)"
                >
                  <span class="text-[11px] font-mono truncate flex-1" style="color: var(--vex-text-muted)">{{ lk.url }}</span>
                  <button
                    class="shrink-0 p-1 rounded transition-colors"
                    style="color: var(--vex-text-faint)"
                    @click="copyLink(`${req.id}-${i}`, lk.url)"
                  >
                    <UIcon :name="copiedId === `${req.id}-${i}` ? 'i-lucide-check' : 'i-lucide-copy'" class="size-3.5" />
                  </button>
                </div>
              </div>

              <!-- Footer -->
              <div class="flex items-center justify-between pt-1" style="border-top: 1px solid var(--vex-border-subtle)">
                <span class="text-[10px]" style="color: var(--vex-text-faint)">{{ formatDate(req.createdAt) }}</span>
                <span v-if="req.fulfilledByName" class="text-[10px]" style="color: var(--vex-text-faint)">
                  por {{ req.fulfilledByName }}
                </span>
              </div>
            </article>
          </div>
        </section>

        <!-- ══════ DEAL REQUESTS TAB ══════ -->
        <section v-show="activeTab === 'deals'">
          <!-- Aviso: aprovação Superbet sem URL → planilha automática -->
          <div
            class="mb-3 flex items-start gap-3 p-3 rounded-xl border-l-2"
            :style="{
              background: 'var(--vex-info-soft-bg, var(--vex-surface))',
              borderColor: 'var(--vex-brand)',
              color: 'var(--vex-text)'
            }"
          >
            <UIcon name="i-lucide-info" class="size-4 mt-0.5 shrink-0" :style="{ color: 'var(--vex-brand)' }" />
            <div class="text-[12px] leading-relaxed">
              <strong>Aprovação Superbet:</strong> ao definir apenas <strong>CPA e RevShare</strong> (sem informar link),
              o sistema atribui automaticamente um link da planilha ao usuário em até 1 minuto.
              Se quiser definir o link manualmente, basta informá-lo no momento da aprovação.
            </div>
          </div>

          <!-- Loading -->
          <div v-if="loadingDeals" class="space-y-3">
            <div v-for="i in 4" :key="i" class="h-24 rounded-xl animate-pulse" style="background: var(--vex-surface)" />
          </div>

          <!-- Empty -->
          <div v-else-if="!inviteeLinkRequests.length" class="flex flex-col items-center justify-center py-20 gap-3">
            <div class="size-14 rounded-full flex items-center justify-center" style="background: var(--vex-surface-strong)">
              <UIcon name="i-lucide-handshake" class="size-7" style="color: var(--vex-text-faint)" />
            </div>
            <p class="text-sm font-semibold" style="color: var(--vex-text)">Nenhum deal request</p>
            <p class="text-[12px]" style="color: var(--vex-text-faint)">Deal requests dos seus convidados aparecerão aqui</p>
          </div>

          <!-- Table -->
          <div v-else-if="inviteeLinkRequests.length" class="vex-card overflow-hidden">
            <div class="vex-table-header flex-col xl:flex-row xl:items-end gap-3">
              <div>
                <h2 class="text-sm font-bold vex-title" style="color: var(--vex-text)">Deal Requests</h2>
                <p class="text-[11px] mt-0.5" style="color: var(--vex-text-faint)">Solicitações de deal dos seus convidados diretos</p>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-[minmax(13rem,1fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_auto] gap-2 w-full xl:w-auto">
                <UInput
                  v-model="dealFilters.search"
                  placeholder="Buscar nome ou e-mail…"
                  icon="i-lucide-search"
                  size="sm"
                  class="w-full"
                />
                <USelect
                  v-model="dealFilters.house"
                  :items="dealHouseOptions"
                  size="sm"
                  class="w-full"
                />
                <USelect
                  v-model="dealFilters.status"
                  :items="dealStatusOptions"
                  size="sm"
                  class="w-full"
                />
                <UButton
                  icon="i-lucide-filter-x"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  :disabled="!hasActiveDealFilters"
                  @click="clearDealFilters"
                />
              </div>
            </div>

            <div
              v-if="!filteredDealRequests.length"
              class="flex flex-col items-center justify-center py-14 gap-2"
            >
              <UIcon name="i-lucide-search-x" class="size-8" style="color: var(--vex-text-faint)" />
              <p class="text-sm font-semibold" style="color: var(--vex-text)">Nenhum resultado com esses filtros</p>
              <UButton
                label="Limpar filtros"
                icon="i-lucide-filter-x"
                color="neutral"
                variant="soft"
                size="sm"
                @click="clearDealFilters"
              />
            </div>

            <div v-else class="overflow-x-auto">
              <table class="w-full text-left text-[12px] whitespace-nowrap">
                <thead>
                  <tr style="background: var(--vex-surface-strong); border-bottom: 1px solid var(--vex-border-subtle)">
                    <th class="px-4 py-2.5 text-[10px] uppercase tracking-[0.1em] font-bold" style="color: var(--vex-text-faint)">Afiliado</th>
                    <th class="px-4 py-2.5 text-[10px] uppercase tracking-[0.1em] font-bold" style="color: var(--vex-text-faint)">Casa / Deal</th>
                    <th class="px-4 py-2.5 text-[10px] uppercase tracking-[0.1em] font-bold" style="color: var(--vex-text-faint)">Status</th>
                    <th class="px-4 py-2.5 text-[10px] uppercase tracking-[0.1em] font-bold" style="color: var(--vex-text-faint)">Data</th>
                    <th class="px-4 py-2.5 text-[10px] uppercase tracking-[0.1em] font-bold text-right" style="color: var(--vex-text-faint)">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="req in filteredDealRequests"
                    :key="req.id"
                    style="border-bottom: 1px solid var(--vex-border-subtle)"
                    @mouseenter="($event.currentTarget as HTMLElement).style.background = 'var(--vex-surface-strong)'"
                    @mouseleave="($event.currentTarget as HTMLElement).style.background = ''"
                  >
                    <td class="px-4 py-3">
                      <p class="font-semibold" style="color: var(--vex-text)">{{ req.userName }}</p>
                      <p class="text-[10px] font-mono" style="color: var(--vex-text-faint)">{{ req.userEmail }}</p>
                    </td>
                    <td class="px-4 py-3">
                      <p class="font-medium" style="color: var(--vex-text)"><HouseBadge :slug="req.bettingHouseSlug" size="sm" /></p>
                      <p class="text-[10px]" style="color: var(--vex-text-faint)">{{ req.dealName ?? '—' }}</p>
                    </td>
                    <td class="px-4 py-3">
                      <span
                        class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold"
                        :style="{ color: statusMap[req.status]?.color, background: statusMap[req.status]?.bg }"
                      >
                        <UIcon :name="statusMap[req.status]?.icon ?? ''" class="size-3" />
                        {{ statusMap[req.status]?.label }}
                      </span>
                    </td>
                    <td class="px-4 py-3 text-[11px]" style="color: var(--vex-text-faint)">{{ formatDate(req.createdAt) }}</td>
                    <td class="px-4 py-3 text-right">
                      <div v-if="req.status === 'PENDING'" class="flex items-center justify-end gap-1.5">
                        <UButton
                          size="xs" color="primary" variant="soft" icon="i-lucide-check"
                          label="Aprovar" :loading="submitting"
                          @click="openApprove(req)"
                        />
                        <UButton
                          size="xs" color="error" variant="ghost" icon="i-lucide-x"
                          :loading="submitting"
                          @click="onReject(req.id)"
                        />
                      </div>
                      <span v-else class="text-[10px]" style="color: var(--vex-text-faint)">{{ req.fulfilledByName || '—' }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

      </div>
    </div>

    <!-- ══════ APPROVE DEAL MODAL ══════ -->
    <Teleport to="body">
      <Transition name="vex-overlay">
        <div
          v-if="approveModal.show"
          class="vex-overlay-backdrop fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4"
          @click.self="approveModal.show = false"
        >
          <div
            class="w-full max-w-md rounded-2xl p-6 flex flex-col gap-5"
            style="background: var(--vex-surface); border: 1px solid var(--vex-border)"
          >
            <div>
              <h2 class="text-base font-bold" style="color: var(--vex-text)">Aprovar Deal Request</h2>
              <p class="text-[12px] mt-0.5" style="color: var(--vex-text-faint)">
                Define as comissões para <strong>{{ approveModal.item?.userName }}</strong>
              </p>
            </div>

            <!-- Awaiting auto-assign banner -->
            <div
              v-if="ceiling?.awaitingAutoAssign"
              class="flex items-start gap-2 rounded-lg px-3 py-2 text-[11px] border-l-2"
              style="background: var(--vex-surface-strong); border-color: var(--vex-brand); color: var(--vex-text)"
            >
              <UIcon name="i-lucide-loader-circle" class="size-3.5 shrink-0 mt-0.5 animate-spin" :style="{ color: 'var(--vex-brand)' }" />
              <span>
                <strong>Atribuição de link em andamento.</strong>
                CPA e RevShare já definidos. O sistema atribuirá um link da planilha em até 1 minuto. Não é necessário aprovar novamente.
              </span>
            </div>

            <!-- Ceiling info banner -->
            <div
              v-if="ceiling?.hasCeiling && !ceiling?.awaitingAutoAssign"
              class="flex items-center gap-2 rounded-lg px-3 py-2 text-[11px]"
              style="background: var(--vex-surface-strong); border: 1px solid var(--vex-border-subtle); color: var(--vex-text-muted)"
            >
              <UIcon name="i-lucide-shield-check" class="size-3.5 shrink-0" style="color: var(--vex-positive)" />
              <span>
                Teto do seu acordo:
                <strong style="color: var(--vex-text)">CPA R${{ ceiling.maxCpa ?? '—' }}</strong>
                ·
                <strong style="color: var(--vex-text)">RevShare {{ ceiling.maxRevshare ?? '—' }}%</strong>
              </span>
            </div>

            <div v-if="ceilingLoading" class="flex justify-center py-2">
              <UIcon name="i-lucide-loader-circle" class="size-5 animate-spin" style="color: var(--vex-text-faint)" />
            </div>

            <div class="grid grid-cols-2 gap-3">
              <UFormField
                :label="ceiling?.hasCeiling && ceiling.maxCpa != null ? `CPA (R$) — máx. R$${ceiling.maxCpa}` : 'CPA (R$)'"
              >
                <UInput
                  v-model="approveForm.cpa"
                  type="number"
                  placeholder="Ex: 150"
                  :max="ceiling?.hasCeiling && ceiling.maxCpa != null ? ceiling.maxCpa : undefined"
                  min="0"
                  :disabled="ceiling?.awaitingAutoAssign"
                />
              </UFormField>
              <UFormField
                :label="ceiling?.hasCeiling && ceiling.maxRevshare != null ? `RevShare (%) — máx. ${ceiling.maxRevshare}%` : 'RevShare (%)'"
              >
                <UInput
                  v-model="approveForm.revshare"
                  type="number"
                  placeholder="Ex: 35"
                  :max="ceiling?.hasCeiling && ceiling.maxRevshare != null ? ceiling.maxRevshare : undefined"
                  min="0"
                  :disabled="ceiling?.awaitingAutoAssign"
                />
              </UFormField>
              <UFormField label="Nota (opcional)" class="col-span-2">
                <UInput
                  v-model="approveForm.adminNote"
                  placeholder="Observação interna..."
                  :disabled="ceiling?.awaitingAutoAssign"
                />
              </UFormField>
            </div>

            <div class="flex gap-3">
              <UButton
                v-if="ceiling?.awaitingAutoAssign"
                color="primary"
                class="flex-1"
                label="Fechar"
                @click="approveModal.show = false"
              />
              <template v-else>
                <UButton color="neutral" variant="outline" class="flex-1" label="Cancelar" @click="approveModal.show = false" />
                <UButton
                  color="primary" class="flex-1" icon="i-lucide-check"
                  label="Confirmar Aprovação"
                  :loading="submitting || ceilingLoading"
                  :disabled="(!approveForm.cpa && !approveForm.revshare) || ceilingLoading"
                  @click="onApprove"
                />
              </template>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'default' })

interface RankPrize {
  id: string
  rank: number
  prizeType: string
  prizeValue: number
  prizeLabel: string
  icon: string
}

interface Prize {
  id: string
  title: string
  description: string
  prizeType: string
  prizeValue: number
  prizeLabel: string
  icon: string
  startDate: string
  endDate: string
  winnersCount: number
  targetCpa: number
  bettingHouse: string | null
  winMode: 'RANKING' | 'TARGET'
  cpaFromNetwork: boolean
  maxWinsPerUser: number | null
  status: 'ACTIVE' | 'ENDED' | 'FINALIZED'
  createdBy: { name: string, email: string } | null
  finalizedBy: { name: string, email: string } | null
  finalizedAt: string | null
  createdAt: string
  prizes: RankPrize[]
  _count: { winners: number }
}

interface PreviewWinner {
  userId: string
  userName: string
  campaignId: string
  cpaAchieved: number
  rank: number
  prizeType: string
  prizeValue: number
  prizeLabel: string
}

interface WinnerRecord {
  id: string
  rank: number
  userName: string
  campaignId: string
  cpaAchieved: number
  prizeType: string
  prizeValue: number
  prizeLabel: string
  redeemed: boolean
  redeemedAt: string | null
  user: { name: string; email: string } | null
}

const { authHeaders } = useAuth()
const apiBase = useApiBase()
const toast = useToast()

const loading = ref(false)
const prizes = ref<Prize[]>([])
const houses = ref<Array<{ slug: string, name: string }>>([])
const showFormModal = ref(false)
const showDeleteConfirm = ref(false)
const showFinalizeConfirm = ref(false)
const showWinnersPreview = ref(false)
const editing = ref<Prize | null>(null)
const submitting = ref(false)
const deleting = ref(false)
const finalizing = ref(false)
const previewingWinners = ref(false)
const previewWinners = ref<PreviewWinner[]>([])
const previewPrize = ref<Prize | null>(null)

// Winners panel
const showWinnersPanel = ref(false)
const winnersPanelPrize = ref<Prize | null>(null)
const winnersPanelLoading = ref(false)
const winnersPanel = ref<WinnerRecord[]>([])

// DOM refs for scroll
const deletingPrize = ref<Prize | null>(null)
const finalizingPrize = ref<Prize | null>(null)

const form = ref({
  title: '',
  description: '',
  prizeType: 'BALANCE' as string,
  prizeValue: 0,
  prizeLabel: '',
  icon: '🏆',
  startDate: '',
  endDate: '',
  winnersCount: 5,
  targetCpa: 0,
  bettingHouse: 'all',
  winMode: 'RANKING' as 'RANKING' | 'TARGET',
  cpaFromNetwork: false,
  maxWinsPerUser: null as number | null,
  prizes: [] as Array<{ rank: number, prizeType: string, prizeValue: number, prizeLabel: string, icon: string }>
})

const prizeTypeOptions = [
  { label: 'Saldo', value: 'BALANCE' },
  { label: 'Físico', value: 'PHYSICAL' },
  { label: 'Outro', value: 'OTHER' }
]

// 'all' = todas as casas (sentinel UI; vira '' no backend); senão o slug
const houseOptions = computed(() => [
  { label: 'Todas as casas', value: 'all' },
  ...houses.value.map(h => ({ label: h.name, value: h.slug }))
])

const winModeOptions = [
  { label: 'Mais CPA vence (ranking)', value: 'RANKING' as const },
  { label: 'Meta de CPA (atingir X)', value: 'TARGET' as const }
]

// Fonte do CPA contado no modo Meta de CPA (TARGET).
const cpaScopeOptions = [
  { label: 'Produção individual', value: false },
  { label: 'Produção da rede (downline)', value: true }
]

// Limite de premiações por afiliado (modo TARGET). null = ilimitado.
const unlimitedWins = computed({
  get: () => form.value.maxWinsPerUser == null,
  set: (v: boolean) => { form.value.maxWinsPerUser = v ? null : 1 }
})

function houseLabel(slug: string | null): string {
  if (!slug) return 'Todas'
  return houses.value.find(h => h.slug === slug)?.name ?? slug
}

const statusLabels: Record<string, string> = {
  ACTIVE: 'Ativo',
  ENDED: 'Encerrado',
  FINALIZED: 'Finalizado'
}

const money = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0)

const fmtDate = (value: string) =>
  new Date(value).toLocaleDateString('pt-BR')

function toInputDate(iso: string): string {
  if (!iso) return ''
  return iso.slice(0, 10)
}

function statusColor(status: string): 'success' | 'warning' | 'info' | 'neutral' {
  if (status === 'ACTIVE') return 'success'
  if (status === 'ENDED') return 'warning'
  if (status === 'FINALIZED') return 'info'
  return 'neutral'
}

function prizeTypeLabel(t: string): string {
  if (t === 'BALANCE') return 'Saldo'
  if (t === 'PHYSICAL') return 'Físico'
  return 'Outro'
}

// === Filters (client-side over fetched list) ===
const searchPrize = ref('')
const statusPrizeFilter = ref<'all' | 'ACTIVE' | 'ENDED' | 'FINALIZED'>('all')
const prizeTypeFilter = ref<'all' | 'BALANCE' | 'PHYSICAL' | 'OTHER'>('all')

const statusFilterOptions = [
  { label: 'Todos', value: 'all' as const },
  { label: 'Ativos', value: 'ACTIVE' as const },
  { label: 'Encerrados', value: 'ENDED' as const },
  { label: 'Finalizados', value: 'FINALIZED' as const }
]

const filteredPrizes = computed(() => {
  const q = searchPrize.value.trim().toLowerCase()
  return prizes.value.filter((p) => {
    if (statusPrizeFilter.value !== 'all' && p.status !== statusPrizeFilter.value) return false
    if (prizeTypeFilter.value !== 'all' && p.prizeType !== prizeTypeFilter.value) return false
    if (!q) return true
    return (
      p.title.toLowerCase().includes(q)
      || (p.description || '').toLowerCase().includes(q)
      || (p.prizeLabel || '').toLowerCase().includes(q)
    )
  })
})

async function load() {
  loading.value = true
  try {
    const res = await $fetch<{ data: Prize[] }>(`${apiBase}/v1/admin/prizes`, {
      headers: authHeaders()
    })
    prizes.value = res.data
  } finally {
    loading.value = false
  }
}

async function loadHouses() {
  try {
    const res = await $fetch<{ data: Array<{ slug: string, name: string }> }>(`${apiBase}/admin/houses`, {
      headers: authHeaders()
    })
    houses.value = res.data
  } catch { /* silent — house selector falls back to "Todas as casas" only */ }
}

function resetForm() {
  form.value = {
    title: '',
    description: '',
    prizeType: 'BALANCE',
    prizeValue: 0,
    prizeLabel: '',
    icon: '🏆',
    startDate: '',
    endDate: '',
    winnersCount: 5,
    targetCpa: 0,
    bettingHouse: 'all',
    winMode: 'RANKING',
    cpaFromNetwork: false,
    maxWinsPerUser: null,
    prizes: [{ rank: 1, prizeType: 'BALANCE', prizeValue: 0, prizeLabel: '', icon: '🏆' }]
  }
}

function openCreate() {
  editing.value = null
  resetForm()
  showFormModal.value = true
}

function openEdit(prize: Prize) {
  editing.value = prize
  form.value = {
    title: prize.title,
    description: prize.description,
    prizeType: prize.prizeType,
    prizeValue: prize.prizeValue,
    prizeLabel: prize.prizeLabel,
    icon: prize.icon,
    startDate: toInputDate(prize.startDate),
    endDate: toInputDate(prize.endDate),
    winnersCount: prize.winnersCount,
    targetCpa: prize.targetCpa,
    bettingHouse: prize.bettingHouse || 'all',
    winMode: prize.winMode ?? 'RANKING',
    cpaFromNetwork: prize.cpaFromNetwork ?? false,
    maxWinsPerUser: prize.maxWinsPerUser ?? null,
    prizes: prize.prizes.length
      ? prize.prizes.map(p => ({ rank: p.rank, prizeType: p.prizeType, prizeValue: p.prizeValue, prizeLabel: p.prizeLabel, icon: p.icon }))
      : [{ rank: 1, prizeType: prize.prizeType, prizeValue: prize.prizeValue, prizeLabel: prize.prizeLabel, icon: prize.icon }]
  }
  showFormModal.value = true
}

function addRankPrize() {
  const nextRank = form.value.prizes.length + 1
  form.value.prizes.push({ rank: nextRank, prizeType: 'BALANCE', prizeValue: 0, prizeLabel: '', icon: '🏆' })
}

function removeRankPrize(idx: number) {
  form.value.prizes.splice(idx, 1)
  form.value.prizes.forEach((p, i) => { p.rank = i + 1 })
}

async function submitForm() {
  submitting.value = true
  try {
    const body = {
      title: form.value.title,
      description: form.value.description,
      prizeType: form.value.prizeType,
      prizeValue: form.value.prizeValue,
      prizeLabel: form.value.prizeLabel,
      icon: form.value.icon,
      startDate: form.value.startDate,
      endDate: form.value.endDate,
      winnersCount: form.value.winnersCount,
      targetCpa: form.value.targetCpa,
      bettingHouse: form.value.bettingHouse === 'all' ? '' : form.value.bettingHouse,
      winMode: form.value.winMode,
      cpaFromNetwork: form.value.winMode === 'TARGET' ? form.value.cpaFromNetwork : false,
      // Só faz sentido no modo Meta de CPA; null = ilimitado.
      maxWinsPerUser: form.value.winMode === 'TARGET' ? form.value.maxWinsPerUser : null,
      // Prêmios por posição só valem no modo ranking; no modo Meta de CPA todos
      // que atingem a meta recebem o prêmio padrão (limitado às vagas).
      prizes: form.value.winMode === 'TARGET' ? [] : form.value.prizes
    }

    if (editing.value) {
      await $fetch(`${apiBase}/v1/admin/prizes/${editing.value.id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body
      })
      toast.add({ title: 'Ranking atualizado', color: 'success' })
    } else {
      await $fetch(`${apiBase}/v1/admin/prizes`, {
        method: 'POST',
        headers: authHeaders(),
        body
      })
      toast.add({ title: 'Ranking criado', color: 'success' })
    }

    showFormModal.value = false
    await load()
  } catch (err: any) {
    toast.add({ title: 'Erro ao salvar', description: err?.data?.detail || err?.message || '', color: 'error' })
  } finally {
    submitting.value = false
  }
}

function openDelete(prize: Prize) {
  deletingPrize.value = prize
  showDeleteConfirm.value = true
}

async function confirmDelete() {
  if (!deletingPrize.value) return
  deleting.value = true
  try {
    await $fetch(`${apiBase}/v1/admin/prizes/${deletingPrize.value.id}`, {
      method: 'DELETE',
      headers: authHeaders()
    })
    toast.add({ title: 'Ranking excluído', color: 'success' })
    showDeleteConfirm.value = false
    deletingPrize.value = null
    await load()
  } catch (err: any) {
    toast.add({ title: 'Erro ao excluir', description: err?.data?.detail || '', color: 'error' })
  } finally {
    deleting.value = false
  }
}

async function openPreviewWinners(prize: Prize) {
  previewPrize.value = prize
  previewingWinners.value = true
  previewWinners.value = []
  showWinnersPreview.value = true
  try {
    const res = await $fetch<{ winners: PreviewWinner[] }>(`${apiBase}/v1/admin/prizes/${prize.id}/preview-winners`, {
      method: 'POST',
      headers: authHeaders()
    })
    previewWinners.value = res.winners
  } catch (err: any) {
    toast.add({ title: 'Erro ao calcular vencedores', description: err?.data?.detail || '', color: 'error' })
    showWinnersPreview.value = false
  } finally {
    previewingWinners.value = false
  }
}

async function openWinnersPanel(prize: Prize) {
  winnersPanelPrize.value = prize
  winnersPanel.value = []
  showWinnersPanel.value = true
  winnersPanelLoading.value = true
  try {
    const res = await $fetch<{ winners: WinnerRecord[] }>(`${apiBase}/v1/admin/prizes/${prize.id}/winners`, {
      headers: authHeaders()
    })
    winnersPanel.value = res.winners
  } catch (err: any) {
    toast.add({ title: 'Erro ao carregar ganhadores', description: err?.data?.detail || '', color: 'error' })
    showWinnersPanel.value = false
  } finally {
    winnersPanelLoading.value = false
  }
}

function openFinalize(prize: Prize) {
  finalizingPrize.value = prize
  showFinalizeConfirm.value = true
}

async function confirmFinalize() {
  if (!finalizingPrize.value) return
  finalizing.value = true
  try {
    await $fetch(`${apiBase}/v1/admin/prizes/${finalizingPrize.value.id}/finalize`, {
      method: 'POST',
      headers: authHeaders(),
      body: { confirmed: true }
    })
    toast.add({ title: 'Ranking finalizado', color: 'success' })
    showFinalizeConfirm.value = false
    finalizingPrize.value = null
    await load()
  } catch (err: any) {
    toast.add({ title: 'Erro ao finalizar', description: err?.data?.detail || '', color: 'error' })
  } finally {
    finalizing.value = false
  }
}

async function revertPrize(prize: Prize) {
  try {
    await $fetch(`${apiBase}/v1/admin/prizes/${prize.id}/revert`, {
      method: 'POST',
      headers: authHeaders()
    })
    toast.add({ title: 'Ranking revertido', color: 'success' })
    await load()
  } catch (err: any) {
    toast.add({ title: 'Erro ao reverter', description: err?.data?.detail || '', color: 'error' })
  }
}

async function endPrize(prize: Prize) {
  try {
    await $fetch(`${apiBase}/v1/admin/prizes/${prize.id}/end`, {
      method: 'POST',
      headers: authHeaders()
    })
    toast.add({ title: 'Ranking encerrado', color: 'success' })
    await load()
  } catch (err: any) {
    toast.add({ title: 'Erro ao encerrar', description: err?.data?.detail || '', color: 'error' })
  }
}

onMounted(() => { load(); loadHouses() })
</script>

<template>
  <div class="admin-page space-y-5">
    <!-- Filter card (MT Affiliates pattern) -->
    <div
      class="card-vex mb-3.5 flex flex-wrap items-center gap-2.5"
      style="padding: 14px"
    >
      <div
        class="relative"
        style="flex: 1; min-width: 0"
      >
        <UIcon
          name="i-lucide-search"
          class="absolute size-3.5"
          style="left: 12px; top: 50%; transform: translateY(-50%); color: var(--color-text-muted)"
        />
        <input
          v-model="searchPrize"
          class="vex-input"
          placeholder="Buscar por título, descrição ou prêmio..."
          style="padding-left: 36px"
        >
      </div>
      <div
        class="flex gap-1"
        style="background: var(--color-surface-2); border: 1px solid var(--color-border); padding: 3px; border-radius: 10px; overflow-x: auto; flex-shrink: 0; max-width: 100%"
      >
        <button
          v-for="opt in statusFilterOptions"
          :key="opt.value"
          class="font-semibold transition-colors shrink-0"
          :style="{
            padding: '6px 12px',
            fontSize: '12px',
            borderRadius: '7px',
            background: statusPrizeFilter === opt.value ? 'var(--color-surface-elevated)' : 'transparent',
            color: statusPrizeFilter === opt.value ? '#fff' : 'var(--color-text-secondary)'
          }"
          @click="statusPrizeFilter = opt.value"
        >
          {{ opt.label }}
        </button>
      </div>
      <select
        v-model="prizeTypeFilter"
        class="vex-select"
        style="width: auto; min-width: 130px"
      >
        <option value="all">
          Todos os tipos
        </option>
        <option value="BALANCE">
          Saldo
        </option>
        <option value="PHYSICAL">
          Físico
        </option>
        <option value="OTHER">
          Outro
        </option>
      </select>
      <button
        class="btn btn-ghost btn-sm"
        :disabled="loading"
        @click="load()"
      >
        <UIcon
          name="i-lucide-refresh-cw"
          class="size-3.5"
        />
        Atualizar
      </button>
      <button
        class="btn btn-gold btn-sm"
        @click="openCreate"
      >
        <UIcon
          name="i-lucide-plus"
          class="size-3.5"
        />
        Novo Ranking
      </button>
    </div>

    <section class="admin-section overflow-hidden">
      <!-- Desktop table -->
      <div class="table-scroll desk-only">
        <table class="admin-table">
        <thead>
          <tr>
            <th>Título</th>
            <th>Período</th>
            <th>Tipo</th>
            <th>Posições</th>
            <th>Vencedores</th>
            <th>Status</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading && !prizes.length">
            <td
              colspan="7"
              class="text-muted"
            >
              Carregando rankings...
            </td>
          </tr>
          <tr v-else-if="!filteredPrizes.length">
            <td
              colspan="7"
              style="text-align: center; padding: 56px"
            >
              <div class="flex flex-col items-center gap-2">
                <UIcon
                  name="i-lucide-trophy"
                  class="size-10"
                  style="color: var(--color-text-muted); opacity: 0.4"
                />
                <p style="color: var(--color-text-secondary); font-size: 13px; font-weight: 600">
                  Nenhum ranking encontrado
                </p>
                <p style="color: var(--color-text-muted); font-size: 12px">
                  Ajuste os filtros ou crie um novo ranking.
                </p>
              </div>
            </td>
          </tr>
          <tr
            v-for="prize in filteredPrizes"
            v-else
            :key="prize.id"
          >
            <td>
              <p class="font-bold text-highlighted">
                {{ prize.icon }} {{ prize.title }}
              </p>
              <p
                v-if="prize.description"
                class="mt-0.5 text-xs text-muted line-clamp-2"
              >
                {{ prize.description }}
              </p>
              <div class="mt-1 flex flex-wrap gap-1">
                <UBadge color="neutral" variant="soft" size="xs">
                  <UIcon name="i-lucide-building-2" class="size-3 mr-0.5" />
                  {{ houseLabel(prize.bettingHouse) }}
                </UBadge>
                <UBadge :color="prize.winMode === 'TARGET' ? 'warning' : 'primary'" variant="soft" size="xs">
                  {{ prize.winMode === 'TARGET' ? `Meta ${prize.targetCpa} CPA` : 'Ranking' }}
                </UBadge>
                <UBadge v-if="prize.winMode === 'TARGET' && prize.cpaFromNetwork" color="info" variant="soft" size="xs">
                  Rede
                </UBadge>
              </div>
            </td>
            <td class="whitespace-nowrap text-muted">
              {{ fmtDate(prize.startDate) }} — {{ fmtDate(prize.endDate) }}
            </td>
            <td>
              <UBadge
                color="neutral"
                variant="outline"
              >
                {{ prizeTypeLabel(prize.prizeType) }}
              </UBadge>
              <p class="mt-0.5 text-xs text-muted">
                {{ prize.prizeLabel || money(prize.prizeValue) }}
              </p>
            </td>
            <td class="text-center">
              {{ prize.prizes.length || prize.winnersCount }}
            </td>
            <td class="text-center">
              {{ prize._count.winners }}
            </td>
            <td>
              <UBadge
                :color="statusColor(prize.status)"
                variant="soft"
              >
                {{ statusLabels[prize.status] || prize.status }}
              </UBadge>
              <p
                v-if="prize.finalizedBy"
                class="mt-0.5 text-xs text-muted"
              >
                por {{ prize.finalizedBy.name }}
              </p>
            </td>
            <td>
              <div class="flex flex-wrap gap-2">
                <UButton
                  v-if="prize.status === 'ENDED' || prize.status === 'FINALIZED'"
                  size="xs"
                  icon="i-lucide-users"
                  color="success"
                  variant="soft"
                  @click="openWinnersPanel(prize)"
                >
                  Ganhadores
                </UButton>
                <UButton
                  size="xs"
                  icon="i-lucide-eye"
                  color="neutral"
                  variant="soft"
                  @click="openPreviewWinners(prize)"
                >
                  Prévia
                </UButton>
                <UButton
                  v-if="prize.status !== 'FINALIZED'"
                  size="xs"
                  icon="i-lucide-pencil"
                  color="primary"
                  variant="soft"
                  @click="openEdit(prize)"
                >
                  Editar
                </UButton>
                <UButton
                  v-if="prize.status === 'ACTIVE'"
                  size="xs"
                  icon="i-lucide-square"
                  color="warning"
                  variant="soft"
                  @click="endPrize(prize)"
                >
                  Encerrar
                </UButton>
                <UButton
                  v-if="prize.status === 'ENDED'"
                  size="xs"
                  icon="i-lucide-trophy"
                  color="success"
                  variant="soft"
                  @click="openFinalize(prize)"
                >
                  Finalizar
                </UButton>
                <UButton
                  v-if="prize.status === 'FINALIZED'"
                  size="xs"
                  icon="i-lucide-undo-2"
                  color="warning"
                  variant="soft"
                  @click="revertPrize(prize)"
                >
                  Reverter
                </UButton>
                <UButton
                  v-if="prize.status !== 'FINALIZED'"
                  size="xs"
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="soft"
                  @click="openDelete(prize)"
                >
                  Excluir
                </UButton>
              </div>
            </td>
          </tr>
          </tbody>
        </table>
      </div>

      <!-- Mobile card list -->
      <div class="mob-only">
        <div
          v-if="loading && !prizes.length"
          style="text-align: center; padding: 24px; color: var(--color-text-muted); font-size: 13px"
        >
          Carregando rankings...
        </div>
        <div
          v-else-if="!filteredPrizes.length"
          class="flex flex-col items-center gap-2"
          style="padding: 40px 16px"
        >
          <UIcon
            name="i-lucide-trophy"
            class="size-10"
            style="color: var(--color-text-muted); opacity: 0.4"
          />
          <p style="color: var(--color-text-secondary); font-size: 13px; font-weight: 600">
            Nenhum ranking encontrado
          </p>
        </div>
        <div
          v-for="prize in filteredPrizes"
          v-else
          :key="prize.id + '-mob'"
          class="mob-card"
        >
          <div class="mob-card-row mb-1">
            <div style="font-weight: 700; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1">
              {{ prize.icon }} {{ prize.title }}
            </div>
            <UBadge
              :color="statusColor(prize.status)"
              variant="soft"
            >
              {{ statusLabels[prize.status] || prize.status }}
            </UBadge>
          </div>
          <div style="font-size: 11px; color: var(--color-text-muted); margin-bottom: 6px">
            {{ fmtDate(prize.startDate) }} — {{ fmtDate(prize.endDate) }}
            · {{ prizeTypeLabel(prize.prizeType) }}
            · {{ prize._count.winners }}/{{ prize.prizes.length || prize.winnersCount }} vencedores
          </div>
          <div class="mob-card-actions">
            <UButton
              v-if="prize.status === 'ENDED' || prize.status === 'FINALIZED'"
              size="xs"
              icon="i-lucide-users"
              color="success"
              variant="soft"
              @click="openWinnersPanel(prize)"
            >
              Ganhadores
            </UButton>
            <UButton
              size="xs"
              icon="i-lucide-eye"
              color="neutral"
              variant="soft"
              @click="openPreviewWinners(prize)"
            >
              Prévia
            </UButton>
            <UButton
              v-if="prize.status !== 'FINALIZED'"
              size="xs"
              icon="i-lucide-pencil"
              color="primary"
              variant="soft"
              @click="openEdit(prize)"
            >
              Editar
            </UButton>
            <UButton
              v-if="prize.status === 'ACTIVE'"
              size="xs"
              icon="i-lucide-square"
              color="warning"
              variant="soft"
              @click="endPrize(prize)"
            />
            <UButton
              v-if="prize.status === 'ENDED'"
              size="xs"
              icon="i-lucide-trophy"
              color="success"
              variant="soft"
              @click="openFinalize(prize)"
            />
            <UButton
              v-if="prize.status !== 'FINALIZED'"
              size="xs"
              icon="i-lucide-trash-2"
              color="error"
              variant="soft"
              @click="openDelete(prize)"
            />
          </div>
        </div>
      </div>
    </section>

    <!-- Preview Modal -->
    <UModal
      v-model:open="showWinnersPreview"
      :title="previewPrize ? `Prévia — ${previewPrize.title}` : 'Prévia'"
      :ui="{ content: 'max-w-2xl' }"
    >
      <template #body>
        <div v-if="previewPrize" class="text-xs text-muted mb-3">
          {{ previewPrize.winMode === 'TARGET' ? 'Meta de CPAs' : 'CPA mínimo' }}:
          <strong>{{ previewPrize.targetCpa }}</strong>
          &nbsp;·&nbsp;
          Casa: <strong>{{ houseLabel(previewPrize.bettingHouse) }}</strong>
          &nbsp;·&nbsp;
          {{ previewPrize.winnersCount }} vaga{{ previewPrize.winnersCount !== 1 ? 's' : '' }}
        </div>
        <div v-if="previewingWinners" class="flex items-center gap-2 text-sm text-muted py-6 justify-center">
          <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
          Calculando vencedores...
        </div>
        <div v-else-if="!previewWinners.length" class="flex flex-col items-center gap-2 py-10">
          <UIcon name="i-lucide-trophy" class="size-10" style="color: var(--color-text-muted); opacity: 0.35" />
          <p class="text-sm text-muted font-semibold">Nenhum vencedor calculado</p>
          <p class="text-xs text-muted">Nenhum afiliado qualificado no período.</p>
        </div>
        <div v-else class="overflow-hidden rounded-lg border border-muted">
          <table class="admin-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Afiliado</th>
                <th>CPA</th>
                <th>Prêmio</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="w in previewWinners" :key="w.rank">
                <td class="font-black text-highlighted">{{ w.rank }}°</td>
                <td>
                  <p class="font-bold text-highlighted">{{ w.userName }}</p>
                  <p class="text-xs text-muted">{{ w.campaignId }}</p>
                </td>
                <td class="font-semibold">{{ w.cpaAchieved }}</td>
                <td>{{ w.prizeLabel || money(w.prizeValue) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end">
          <UButton color="neutral" variant="ghost" @click="showWinnersPreview = false; previewPrize = null">Fechar</UButton>
        </div>
      </template>
    </UModal>

    <!-- Winners Modal (ENDED / FINALIZED) -->
    <UModal
      v-model:open="showWinnersPanel"
      :title="winnersPanelPrize ? `Ganhadores — ${winnersPanelPrize.title}` : 'Ganhadores'"
      :ui="{ content: 'max-w-3xl' }"
    >
      <template #body>
        <div v-if="winnersPanelPrize" class="text-xs text-muted mb-3">
          <UIcon name="i-lucide-users" class="size-3.5 inline mr-1" style="color: var(--color-success)" />
          {{ winnersPanel.filter(w => w.redeemed).length }}/{{ winnersPanel.length }} já resgataram o prêmio
        </div>
        <div v-if="winnersPanelLoading" class="flex items-center gap-2 text-sm text-muted py-6 justify-center">
          <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
          Carregando ganhadores...
        </div>
        <div v-else-if="!winnersPanel.length" class="flex flex-col items-center gap-2 py-10">
          <UIcon name="i-lucide-users" class="size-10" style="color: var(--color-text-muted); opacity: 0.35" />
          <p class="text-sm text-muted font-semibold">Nenhum ganhador registrado</p>
          <p class="text-xs text-muted">Este ranking ainda não foi finalizado ou não teve vencedores.</p>
        </div>
        <div v-else class="overflow-hidden rounded-lg border border-muted">
          <table class="admin-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Afiliado</th>
                <th>CPA</th>
                <th>Prêmio</th>
                <th>Status</th>
                <th>Resgatado em</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="w in winnersPanel" :key="w.id">
                <td class="font-black text-highlighted">{{ w.rank }}°</td>
                <td>
                  <p class="font-bold text-highlighted">{{ w.user?.name || w.userName }}</p>
                  <p class="text-xs text-muted">{{ w.user?.email || w.campaignId }}</p>
                </td>
                <td class="font-semibold">{{ w.cpaAchieved }}</td>
                <td class="text-sm">{{ w.prizeLabel || money(w.prizeValue) }}</td>
                <td>
                  <UBadge :color="w.redeemed ? 'success' : 'warning'" variant="soft">
                    {{ w.redeemed ? 'Resgatado' : 'Pendente' }}
                  </UBadge>
                </td>
                <td class="text-xs text-muted whitespace-nowrap">{{ w.redeemedAt ? fmtDate(w.redeemedAt) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end">
          <UButton color="neutral" variant="ghost" @click="showWinnersPanel = false; winnersPanelPrize = null">Fechar</UButton>
        </div>
      </template>
    </UModal>


    <UModal
      v-model:open="showFormModal"
      :title="editing ? 'Editar Ranking' : 'Novo Ranking'"
    >
      <template #body>
        <div class="space-y-5">

          <!-- Informações Gerais -->
          <div class="rounded-xl p-5 space-y-4" style="background: var(--color-surface-2); border: 1px solid var(--color-border)">
            <p class="text-[11px] font-bold uppercase tracking-widest" style="color: var(--color-text-muted)">Informações Gerais</p>
            <div class="flex gap-3 items-end">
              <UFormField label="Ícone" style="width: 80px">
                <UInput v-model="form.icon" placeholder="🏆" />
              </UFormField>
              <UFormField label="Título" class="flex-1">
                <UInput v-model="form.title" placeholder="Ex: Ranking CPA Maio 2026" />
              </UFormField>
            </div>
            <UFormField label="Descrição">
              <UTextarea v-model="form.description" :rows="3" placeholder="Descrição do ranking" />
            </UFormField>
          </div>

          <!-- Período -->
          <div class="rounded-xl p-5 space-y-4" style="background: var(--color-surface-2); border: 1px solid var(--color-border)">
            <p class="text-[11px] font-bold uppercase tracking-widest" style="color: var(--color-text-muted)">Período de Competição</p>
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField label="Data início">
                <UInput v-model="form.startDate" type="date" />
              </UFormField>
              <UFormField label="Data fim">
                <UInput v-model="form.endDate" type="date" />
              </UFormField>
            </div>
          </div>

          <!-- Prêmio padrão -->
          <div class="rounded-xl p-5 space-y-4" style="background: var(--color-surface-2); border: 1px solid var(--color-border)">
            <p class="text-[11px] font-bold uppercase tracking-widest" style="color: var(--color-text-muted)">Prêmio Padrão</p>
            <div class="grid gap-4 sm:grid-cols-3">
              <UFormField label="Tipo">
                <USelect v-model="form.prizeType" :items="prizeTypeOptions" value-key="value" />
              </UFormField>
              <UFormField label="Valor (R$)">
                <UInput v-model.number="form.prizeValue" type="number" :step="0.01" />
              </UFormField>
              <UFormField label="Rótulo">
                <UInput v-model="form.prizeLabel" placeholder="Ex: R$500 de bônus" />
              </UFormField>
            </div>
            <p class="text-xs" style="color: var(--color-text-muted)">
              No modo <strong>Meta de CPA</strong> este é o prêmio que cada ganhador recebe. No modo
              <strong>Ranking</strong> serve de base, sobrescrito pelos prêmios por posição abaixo.
            </p>
          </div>

          <!-- Modo de disputa -->
          <div class="rounded-xl p-5 space-y-4" style="background: var(--color-surface-2); border: 1px solid var(--color-border)">
            <p class="text-[11px] font-bold uppercase tracking-widest" style="color: var(--color-text-muted)">Modo de Disputa</p>
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField label="Casa" hint="De qual casa contar os CPAs">
                <USelect v-model="form.bettingHouse" :items="houseOptions" value-key="value" />
              </UFormField>
              <UFormField label="Modo de disputa">
                <USelect v-model="form.winMode" :items="winModeOptions" value-key="value" />
              </UFormField>
            </div>

            <!-- Modo Meta de CPA (TARGET) -->
            <div
              v-if="form.winMode === 'TARGET'"
              class="space-y-4 rounded-lg p-4"
              style="background: var(--color-surface); border: 1px solid var(--color-border)"
            >
              <p class="text-xs leading-relaxed" style="color: var(--color-text-muted)">
                <strong>Meta de CPA:</strong> <strong>todos</strong> os afiliados que atingirem a meta no
                período ganham o prêmio padrão. Não há limite de ganhadores.
              </p>
              <div class="grid gap-5 sm:grid-cols-2">
                <UFormField label="Contagem de CPA" hint="Produção individual ou da rede (downline)">
                  <USelect v-model="form.cpaFromNetwork" :items="cpaScopeOptions" value-key="value" />
                </UFormField>
                <UFormField label="Meta de CPAs" hint="Quantos CPAs para ganhar o prêmio">
                  <UInput v-model.number="form.targetCpa" type="number" />
                </UFormField>
              </div>
              <div class="grid gap-5 sm:grid-cols-2 sm:items-start">
                <UFormField label="Limite de premiações por afiliado" hint="Quantas vezes o mesmo afiliado pode vencer esta meta">
                  <USwitch v-model="unlimitedWins" label="Ilimitado" />
                </UFormField>
                <UFormField v-if="!unlimitedWins" label="Máximo de vezes" hint="Acima disso o afiliado não vence de novo">
                  <UInput v-model.number="form.maxWinsPerUser" type="number" :min="1" />
                </UFormField>
              </div>
              <p v-if="form.cpaFromNetwork" class="text-xs" style="color: var(--color-warning, #b45309)">
                Conta apenas os CPAs gerados pela rede/downline do afiliado — o CPA próprio dele não entra.
              </p>
            </div>

            <!-- Modo Ranking -->
            <UFormField
              v-else
              label="CPA mínimo para participar"
              hint="0 = sem mínimo"
            >
              <UInput v-model.number="form.targetCpa" type="number" style="max-width: 160px" />
            </UFormField>
          </div>

          <!-- Prêmios por posição — só no modo Ranking -->
          <div v-if="form.winMode === 'RANKING'" class="rounded-xl p-4 space-y-3" style="background: var(--color-surface-2); border: 1px solid var(--color-border)">
            <div class="flex items-center justify-between">
              <p class="text-[11px] font-bold uppercase tracking-widest" style="color: var(--color-text-muted)">Prêmios por Posição</p>
              <UButton size="xs" icon="i-lucide-plus" color="primary" variant="soft" @click="addRankPrize">
                Adicionar
              </UButton>
            </div>
            <div class="space-y-3">
              <div
                v-for="(rp, idx) in form.prizes"
                :key="idx"
                class="flex items-start gap-2 rounded-lg p-3"
                style="background: var(--color-surface); border: 1px solid var(--color-border)"
              >
                <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-black" style="background: rgba(var(--color-primary-500), 0.12); color: var(--color-primary-500)">
                  {{ rp.rank }}°
                </div>
                <div class="grid flex-1 gap-2 sm:grid-cols-3">
                  <UFormField label="Tipo">
                    <USelect v-model="rp.prizeType" :items="prizeTypeOptions" value-key="value" />
                  </UFormField>
                  <UFormField label="Valor (R$)">
                    <UInput v-model.number="rp.prizeValue" type="number" :step="0.01" />
                  </UFormField>
                  <UFormField label="Rótulo">
                    <UInput v-model="rp.prizeLabel" placeholder="Ex: R$500" />
                  </UFormField>
                </div>
                <UButton
                  v-if="form.prizes.length > 1"
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  size="xs"
                  class="mt-5"
                  @click="removeRankPrize(idx)"
                />
              </div>
            </div>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="showFormModal = false"
          >
            Cancelar
          </UButton>
          <UButton
            color="primary"
            :loading="submitting"
            @click="submitForm"
          >
            {{ editing ? 'Salvar' : 'Criar' }}
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Delete Modal -->
    <UModal
      v-model:open="showDeleteConfirm"
      title="Confirmar exclusão"
    >
      <template #body>
        <p class="text-sm">
          Excluir <strong class="text-highlighted">{{ deletingPrize?.title }}</strong>? Esta ação não pode ser desfeita.
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="showDeleteConfirm = false"
          >
            Cancelar
          </UButton>
          <UButton
            color="error"
            :loading="deleting"
            @click="confirmDelete"
          >
            Excluir
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Finalize Modal -->
    <UModal
      v-model:open="showFinalizeConfirm"
      title="Finalizar ranking"
    >
      <template #body>
        <p class="text-sm">
          Finalizar <strong class="text-highlighted">{{ finalizingPrize?.title }}</strong>?
          Os vencedores serão registrados e notificados.
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="showFinalizeConfirm = false"
          >
            Cancelar
          </UButton>
          <UButton
            color="success"
            :loading="finalizing"
            @click="confirmFinalize"
          >
            Finalizar
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>

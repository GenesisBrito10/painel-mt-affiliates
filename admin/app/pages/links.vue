<script setup lang="ts">
definePageMeta({ layout: 'default' })

interface LinkItem {
  label: string
  url: string
}

interface LinkRequest {
  id: string
  userId: string
  userName: string
  userEmail: string
  referredBy?: { id: string, name: string, email: string } | null
  dealId: string
  dealName: string
  bettingHouseSlug: string
  message: string
  status: 'PENDING' | 'FULFILLED' | 'REJECTED'
  links: LinkItem[]
  adminNote: string
  fulfilledAt: string | null
  fulfilledByName: string | null
  createdAt: string
  resolvedCpa: number | null
  resolvedRevshare: number | null
  resolvedRuleApplied: string | null
  inviterCpa: number | null
  requiredHouseSlugs: string[]
  missingHouseSlugs: string[]
  blockedReason: string | null
  // Deals kind=FORM: tipo + respostas do formulário (senha já decifrada p/ admin).
  kind?: 'LINK' | 'FORM'
  formData?: Record<string, unknown> | null
}

const { authHeaders } = useAuth()
const apiBase = useApiBase()
const toast = useToast()

const loading = ref(false)
const items = ref<LinkRequest[]>([])
const total = ref(0)
const page = ref(1)
const limit = ref(20)
const status = ref('PENDING')
const search = ref('')
const houseFilter = ref('all')
const hasCommissionFilter = ref('all')
const houses = ref<{slug: string, name: string}[]>([])
const submitting = ref(false)

const showApproveModal = ref(false)
const showRejectModal = ref(false)
const selected = ref<LinkRequest | null>(null)

const approveLinks = ref<LinkItem[]>([{ label: '', url: '' }])
const approveNote = ref('')
const approveManualCampaignId = ref('')
const approveCpa = ref<number | null>(null)
// esportiva-diario: CPA manual — sem link no modal (a planilha atribui depois).
const isFormRequest = computed(() => selected.value?.kind === 'FORM')
// Sem seção de links quando é CPA manual (esportiva-diario) OU deal FORM.
const isManualApprove = computed(
  () =>
    selected.value?.bettingHouseSlug === 'esportiva-diario'
    || isFormRequest.value,
)

// Rótulos legíveis dos campos do formData (fallback = a própria key).
const FORM_FIELD_LABELS: Record<string, string> = {
  firstName: 'Nome',
  lastName: 'Sobrenome',
  email: 'E-mail',
  whatsapp: 'WhatsApp',
  credUsername: 'Usuário desejado',
  credPassword: 'Senha desejada',
  houses: 'Casas solicitadas',
  agreement: 'Acordo',
  actAs: 'Atua como',
  channel: 'Instagram / canal',
  notes: 'Observações',
}

const formEntries = computed(() => {
  const fd = selected.value?.formData
  if (!fd || typeof fd !== 'object') return []
  return Object.entries(fd).map(([k, v]) => ({
    key: k,
    label: FORM_FIELD_LABELS[k] ?? k,
    value: Array.isArray(v) ? v.join(', ') : String(v ?? ''),
  }))
})
const approveRevshare = ref<number | null>(null)
const ceiling = ref<{ hasCeiling: boolean, referrerName?: string, maxCpa?: number, maxRevshare?: number } | null>(null)
const loadingCeiling = ref(false)

const rejectNote = ref('')

const statusOptions = [
  { label: 'Pendentes', value: 'PENDING' },
  { label: 'Aprovados', value: 'FULFILLED' },
  { label: 'Rejeitados', value: 'REJECTED' },
  { label: 'Todos', value: 'all' }
]

const statusLabel = (s: string) => {
  if (s === 'PENDING') return 'Pendente'
  if (s === 'FULFILLED') return 'Aprovado'
  if (s === 'REJECTED') return 'Rejeitado'
  return s
}

const _statusColor = (s: string) => {
  if (s === 'FULFILLED') return 'success' as const
  if (s === 'REJECTED') return 'error' as const
  return 'warning' as const
}

const fmtDate = (value: string) =>
  new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })

let searchTimer: ReturnType<typeof setTimeout> | null = null

watch(status, () => load(1))
watch(houseFilter, () => load(1))
watch(hasCommissionFilter, () => load(1))

const houseSelectItems = computed(() => [
  { value: 'all', label: 'Todas as Casas' },
  ...houses.value.map(h => ({ value: h.slug, label: h.name }))
])

watch(search, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => load(1), 350)
})

async function load(nextPage = page.value) {
  loading.value = true
  page.value = nextPage
  try {
    const res = await $fetch<{ data: LinkRequest[], total: number, page: number, limit: number }>(`${apiBase}/v1/link-requests`, {
      headers: authHeaders(),
      query: {
        page: page.value,
        limit: limit.value,
        status: status.value === 'all' ? undefined : status.value,
        house: houseFilter.value === 'all' ? undefined : houseFilter.value,
        hasCommission: hasCommissionFilter.value === 'all' ? undefined : hasCommissionFilter.value,
        search: search.value || undefined
      }
    })
    items.value = res.data
    total.value = res.total
  } finally {
    loading.value = false
  }
}

async function reprocessItem(item: LinkRequest) {
  const reason = window.prompt('Motivo do reprocessamento:')
  if (!reason) return
  const recalc = window.confirm('Recalcular CPA? (OK = sim, Cancelar = usar snapshot atual)')
  try {
    const res = await $fetch<{ status: string; outcome: string }>(
      `${apiBase}/v1/link-requests/${item.id}/reprocess`,
      {
        method: 'POST',
        headers: authHeaders(),
        body: { reason, recalculateSnapshot: recalc },
      },
    )
    toast.add({ title: `Reprocessado: ${res.status} / ${res.outcome}`, color: 'success' })
    await load()
  } catch (err: unknown) {
    const e = err as { data?: { message?: string } }
    toast.add({ title: 'Reprocesso falhou', description: e.data?.message || String(err), color: 'error' })
  }
}

function openApproveModal(item: LinkRequest) {
  selected.value = item
  approveLinks.value = [{ label: '', url: '' }]
  approveNote.value = ''
  approveManualCampaignId.value = ''
  approveCpa.value = null
  approveRevshare.value = null
  ceiling.value = null
  showApproveModal.value = true
  fetchReferrerCeiling(item.id)
}

async function fetchReferrerCeiling(requestId: string) {
  loadingCeiling.value = true
  try {
    const res = await $fetch<{
      hasCeiling: boolean
      referrerName?: string
      maxCpa?: number
      maxRevshare?: number
      presetCpa?: number | null
      presetRevshare?: number | null
    }>(
      `${apiBase}/v1/link-requests/${requestId}/referrer-ceiling`,
      { headers: authHeaders() }
    )
    ceiling.value = res
    // Pre-fill CPA/RevShare: preset (from referrer approval) > ceiling max > leave empty
    if (approveCpa.value === null) {
      approveCpa.value = res.presetCpa ?? (res.hasCeiling ? res.maxCpa ?? null : null)
    }
    if (approveRevshare.value === null) {
      approveRevshare.value = res.presetRevshare ?? (res.hasCeiling ? res.maxRevshare ?? null : null)
    }
  } catch { ceiling.value = null }
  finally { loadingCeiling.value = false }
}

function openRejectModal(item: LinkRequest) {
  selected.value = item
  rejectNote.value = ''
  showRejectModal.value = true
}

function addLink() {
  approveLinks.value.push({ label: '', url: '' })
}

function removeLink(index: number) {
  approveLinks.value.splice(index, 1)
}

async function submitApprove() {
  if (!selected.value) return
  // esportiva-diario: CPA MANUAL — admin seta só o CPA; a planilha (aba DIÁRIO)
  // atribui o link depois via scheduler. Não exige link colado.
  const isManualCpa = selected.value.bettingHouseSlug === 'esportiva-diario'
  // Deals FORM não têm tracking URL — libera com ID de afiliado + CPA/REV.
  const isForm = selected.value.kind === 'FORM'
  const validLinks = approveLinks.value.filter(l => l.url.trim())
  if (!isManualCpa && !isForm && !validLinks.length) {
    toast.add({ title: 'Adicione pelo menos um link.', color: 'warning' })
    return
  }

  if (approveCpa.value === undefined || approveCpa.value === null || approveCpa.value < 0) {
    toast.add({ title: 'O valor de CPA é obrigatório.', color: 'warning' })
    return
  }

  if (approveRevshare.value === undefined || approveRevshare.value === null || approveRevshare.value < 0) {
    toast.add({ title: 'O valor de RevShare é obrigatório.', color: 'warning' })
    return
  }

  // Client-side ceiling validation
  if (ceiling.value?.hasCeiling) {
    if (approveCpa.value && ceiling.value.maxCpa !== undefined && approveCpa.value > ceiling.value.maxCpa) {
      toast.add({ title: `CPA não pode exceder R$${ceiling.value.maxCpa} (teto do indicador).`, color: 'warning' })
      return
    }
    if (approveRevshare.value && ceiling.value.maxRevshare !== undefined && approveRevshare.value > ceiling.value.maxRevshare) {
      toast.add({ title: `RevShare não pode exceder ${ceiling.value.maxRevshare}% (teto do indicador).`, color: 'warning' })
      return
    }
  }

  submitting.value = true
  try {
    if (isManualCpa) {
      // Seta só o CPA → request entra na fila do scheduler (atribui da planilha).
      await $fetch(`${apiBase}/v1/link-requests/${selected.value.id}/set-cpa`, {
        method: 'PUT',
        headers: authHeaders(),
        body: {
          cpa: approveCpa.value ?? undefined,
          revshare: approveRevshare.value ?? undefined,
        },
      })
    } else {
      await $fetch(`${apiBase}/v1/link-requests/${selected.value.id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: {
          status: 'fulfilled',
          links: validLinks.map(l => ({ label: l.label.trim(), url: l.url.trim() })),
          adminNote: approveNote.value.trim() || undefined,
          manualCampaignId: approveManualCampaignId.value.trim() || undefined,
          cpa: approveCpa.value ?? undefined,
          revshare: approveRevshare.value ?? undefined
        }
      })
    }
    toast.add({ title: 'Solicitação aprovada com sucesso.', color: 'success' })
    showApproveModal.value = false
    await load()
  } catch (err: any) {
    const errorMsg = err.data?.detail || err.data?.message || 'Erro ao aprovar solicitação.'
    toast.add({ title: 'Erro ao aprovar', description: errorMsg, color: 'error' })
  } finally {
    submitting.value = false
  }
}

async function submitReject() {
  if (!selected.value) return
  submitting.value = true
  try {
    await $fetch(`${apiBase}/v1/link-requests/${selected.value.id}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: {
        status: 'rejected',
        adminNote: rejectNote.value.trim() || undefined
      }
    })
    toast.add({ title: 'Solicitação rejeitada.', color: 'error' })
    showRejectModal.value = false
    await load()
  } catch (err: any) {
    const errorMsg = err.data?.detail || err.data?.message || 'Erro ao rejeitar solicitação.'
    toast.add({ title: 'Erro ao rejeitar', description: errorMsg, color: 'error' })
  } finally {
    submitting.value = false
  }
}

function copyToClipboard(url: string) {
  navigator.clipboard.writeText(url)
  toast.add({ title: 'Link copiado!', color: 'success' })
}

async function fetchHouses() {
  try {
    const res = await $fetch<{ data: { slug: string, name: string }[] }>(`${apiBase}/v1/link-requests/houses`, {
      headers: authHeaders()
    })
    houses.value = res.data
  } catch { /* silent */ }
}

onMounted(() => {
  fetchHouses()
  load()
})
</script>

<template>
  <div class="page-wrap fade-up">
    <!-- Filter card -->
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
          v-model="search"
          class="vex-input"
          placeholder="Buscar por nome ou e-mail..."
          style="padding-left: 36px"
        >
      </div>
      <div
        class="flex gap-1"
        style="background: var(--color-surface-2); border: 1px solid var(--color-border); padding: 3px; border-radius: 10px; overflow-x: auto; flex-shrink: 0; max-width: 100%"
      >
        <button
          v-for="opt in statusOptions"
          :key="opt.value"
          class="font-semibold transition-colors shrink-0"
          :style="{
            padding: '6px 12px',
            fontSize: '12px',
            borderRadius: '7px',
            background: status === opt.value ? 'var(--color-surface-elevated)' : 'transparent',
            color: status === opt.value ? '#fff' : 'var(--color-text-secondary)'
          }"
          @click="status = opt.value"
        >
          {{ opt.label }}
        </button>
      </div>
      <USelect
        v-model="houseFilter"
        :items="houseSelectItems"
        value-key="value"
        class="w-40 shrink-0"
        style="min-width: 160px"
      />
      <!-- Commission filter -->
      <div
        class="flex gap-1 shrink-0"
        style="background: var(--color-surface-2); border: 1px solid var(--color-border); padding: 3px; border-radius: 10px"
      >
        <button
          v-for="opt in [{ label: 'Com/Sem CPA', value: 'all' }, { label: 'Com CPA', value: 'yes' }, { label: 'Sem CPA', value: 'no' }]"
          :key="opt.value"
          class="font-semibold transition-colors shrink-0"
          :style="{
            padding: '6px 10px',
            fontSize: '12px',
            borderRadius: '7px',
            background: hasCommissionFilter === opt.value ? 'var(--color-surface-elevated)' : 'transparent',
            color: hasCommissionFilter === opt.value ? '#fff' : 'var(--color-text-secondary)'
          }"
          @click="hasCommissionFilter = opt.value"
        >
          {{ opt.label }}
        </button>
      </div>
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
    </div>

    <!-- Table -->
    <div
      class="card-vex"
      style="overflow: hidden"
    >
      <!-- Desktop table (md+) -->
      <div class="table-scroll desk-only">
        <table class="tbl">
          <thead>
            <tr>
              <th>Afiliado</th>
              <th>Indicador</th>
              <th>Casa</th>
              <th>Status</th>
              <th>CPA / Regra</th>
              <th>Links</th>
              <th>Data</th>
              <th style="text-align: right">
                Ações
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading && !items.length">
              <td
                colspan="8"
                style="text-align: center; padding: 32px; color: var(--color-text-muted)"
              >
                Carregando solicitações...
              </td>
            </tr>
            <tr v-else-if="!items.length">
              <td
                colspan="8"
                style="text-align: center; padding: 56px"
              >
                <div class="flex flex-col items-center gap-2">
                  <UIcon
                    name="i-lucide-link"
                    class="size-10"
                    style="color: var(--color-text-muted); opacity: 0.4"
                  />
                  <p style="color: var(--color-text-secondary); font-size: 13px; font-weight: 600">
                    Nenhuma solicitação encontrada
                  </p>
                  <p style="color: var(--color-text-muted); font-size: 12px">
                    Ajuste os filtros para ver mais resultados.
                  </p>
                </div>
              </td>
            </tr>
            <tr
              v-for="item in items"
              v-else
              :key="item.id"
            >
              <td>
                <div class="flex items-center gap-2.5">
                  <Avatar
                    :name="item.userName"
                    :size="28"
                  />
                  <div>
                    <div style="font-weight: 700; font-size: 13px">
                      {{ item.userName }}
                    </div>
                    <div style="font-size: 11px; color: var(--color-text-muted)">
                      {{ item.userEmail }}
                    </div>
                    <div
                      v-if="item.dealName"
                      style="font-size: 11px; color: var(--color-text-muted); margin-top: 2px"
                    >
                      Deal: {{ item.dealName }}
                    </div>
                  </div>
                </div>
              </td>
              <td style="font-size: 12px; color: var(--color-text-secondary)">
                <NuxtLink
                  v-if="item.referredBy"
                  :to="`/affiliates/${item.referredBy.id}?tab=origin`"
                  class="hover:underline"
                  style="color: var(--color-text-secondary)"
                >
                  {{ item.referredBy.name }}
                </NuxtLink>
                <span
                  v-else
                  style="color: var(--color-text-muted)"
                >Direto do painel</span>
              </td>
              <td>
                <HouseBadge :slug="item.bettingHouseSlug" />
              </td>
              <td>
                <StatusBadge
                  :status="item.status === 'FULFILLED' ? 'APPROVED' : item.status"
                  :label="statusLabel(item.status)"
                />
                <p
                  v-if="item.fulfilledByName && item.status !== 'PENDING'"
                  style="margin-top: 4px; font-size: 11px; color: var(--color-text-muted)"
                >
                  por {{ item.fulfilledByName }}
                </p>
              </td>
              <td style="font-size: 11.5px">
                <div v-if="item.resolvedCpa != null" style="font-weight: 700">
                  CPA {{ item.resolvedCpa }}
                </div>
                <div v-if="item.resolvedRuleApplied" style="color: var(--color-text-muted)">
                  {{ item.resolvedRuleApplied }}
                </div>
                <div
                  v-if="item.inviterCpa != null"
                  style="color: var(--color-text-muted)"
                >
                  conv.: {{ item.inviterCpa }}
                </div>
                <div
                  v-if="item.missingHouseSlugs && item.missingHouseSlugs.length"
                  style="color: var(--color-danger, #c0392b)"
                >
                  falta: {{ item.missingHouseSlugs.join(', ') }}
                </div>
                <div
                  v-if="item.blockedReason"
                  style="color: var(--color-text-muted)"
                  :title="item.blockedReason"
                >
                  ⚠ bloqueio
                </div>
                <span
                  v-if="item.resolvedCpa == null && !item.blockedReason"
                  style="color: var(--color-text-muted)"
                >—</span>
              </td>
              <td>
                <div
                  v-if="item.links && item.links.length"
                  class="space-y-1"
                >
                  <div
                    v-for="(lk, idx) in item.links"
                    :key="idx"
                    class="flex items-center gap-1"
                  >
                    <a
                      :href="lk.url"
                      target="_blank"
                      rel="noopener"
                      class="mono truncate hover:underline"
                      style="font-size: 11px; color: var(--color-gold); max-width: 200px"
                    >
                      {{ lk.label || lk.url }}
                    </a>
                    <IconBtn
                      title="Copiar"
                      color="gray"
                      icon="i-lucide-copy"
                      @click="copyToClipboard(lk.url)"
                    />
                  </div>
                </div>
                <span
                  v-else
                  style="color: var(--color-text-muted); font-size: 12px"
                >—</span>
              </td>
              <td
                class="mono"
                style="font-size: 11.5px; color: var(--color-text-muted); white-space: nowrap"
              >
                {{ fmtDate(item.createdAt) }}
              </td>
              <td style="text-align: right">
                <div
                  class="inline-flex"
                  style="gap: 4px"
                >
                  <IconBtn
                    v-if="item.status === 'PENDING'"
                    title="Aprovar"
                    color="green"
                    icon="i-lucide-check"
                    @click="openApproveModal(item)"
                  />
                  <IconBtn
                    v-if="item.status === 'PENDING'"
                    title="Rejeitar"
                    color="red"
                    icon="i-lucide-x"
                    @click="openRejectModal(item)"
                  />
                  <IconBtn
                    v-if="item.status !== 'FULFILLED'"
                    title="Reprocessar"
                    color="gray"
                    icon="i-lucide-refresh-cw"
                    @click="reprocessItem(item)"
                  />
                </div>
                <p
                  v-if="item.adminNote"
                  style="margin-top: 4px; font-size: 11px; color: var(--color-text-muted); text-align: right"
                >
                  <strong>Nota:</strong> {{ item.adminNote }}
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Mobile card list -->
      <div class="mob-only">
        <div
          v-if="loading && !items.length"
          style="text-align: center; padding: 32px; color: var(--color-text-muted); font-size: 13px"
        >
          Carregando solicitações...
        </div>
        <div
          v-else-if="!items.length"
          class="flex flex-col items-center gap-2"
          style="padding: 40px 16px"
        >
          <UIcon
            name="i-lucide-link"
            class="size-10"
            style="color: var(--color-text-muted); opacity: 0.4"
          />
          <p style="color: var(--color-text-secondary); font-size: 13px; font-weight: 600">
            Nenhuma solicitação encontrada
          </p>
        </div>
        <div
          v-for="item in items"
          v-else
          :key="item.id + '-mob'"
          class="mob-card"
        >
          <div class="mob-card-row mb-2">
            <div class="flex items-center gap-2.5 min-w-0">
              <Avatar
                :name="item.userName"
                :size="28"
              />
              <div class="min-w-0">
                <div style="font-weight: 700; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
                  {{ item.userName }}
                </div>
                <div style="font-size: 11px; color: var(--color-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
                  {{ item.userEmail }}
                </div>
              </div>
            </div>
            <StatusBadge
              :status="item.status === 'FULFILLED' ? 'APPROVED' : item.status"
              :label="statusLabel(item.status)"
            />
          </div>
          <div class="mob-card-row mb-2">
            <div>
              <div class="mob-card-label">Casa</div>
              <HouseBadge :slug="item.bettingHouseSlug" />
            </div>
            <div style="text-align: right; font-size: 11px; color: var(--color-text-muted)">
              {{ fmtDate(item.createdAt) }}
            </div>
          </div>
          <div class="mob-card-row mb-2">
            <div>
              <div class="mob-card-label">Indicador</div>
              <div style="font-size: 12px; color: var(--color-text-secondary)">
                {{ item.referredBy?.name || 'Direto do painel' }}
              </div>
            </div>
          </div>
          <div
            v-if="item.links && item.links.length"
            class="mb-2"
          >
            <div class="mob-card-label">
              Links
            </div>
            <div
              v-for="(lk, idx) in item.links"
              :key="idx"
              class="flex items-center gap-1 mt-1"
            >
              <a
                :href="lk.url"
                target="_blank"
                rel="noopener"
                class="mono truncate hover:underline"
                style="font-size: 11px; color: var(--color-gold); max-width: 200px"
              >
                {{ lk.label || lk.url }}
              </a>
              <IconBtn
                title="Copiar"
                color="gray"
                icon="i-lucide-copy"
                @click="copyToClipboard(lk.url)"
              />
            </div>
          </div>
          <div
            v-if="item.status === 'PENDING'"
            class="mob-card-actions"
          >
            <IconBtn
              title="Aprovar"
              color="green"
              icon="i-lucide-check"
              @click="openApproveModal(item)"
            />
            <IconBtn
              title="Rejeitar"
              color="red"
              icon="i-lucide-x"
              @click="openRejectModal(item)"
            />
          </div>
        </div>
      </div>

      <div
        class="flex items-center justify-between flex-wrap gap-2"
        style="padding: 14px 18px; border-top: 1px solid var(--color-border); font-size: 12px; color: var(--color-text-muted)"
      >
        <div>Mostrando {{ items.length }} de {{ total }} solicitações</div>
        <UPagination
          v-model:page="page"
          :total="total"
          :items-per-page="limit"
          @update:page="load($event)"
        />
      </div>
    </div>

    <!-- Approve Modal -->
    <UModal
      v-model:open="showApproveModal"
      title="Aprovar Solicitacao de Link"
    >
      <template #body>
        <div class="space-y-4">
          <div class="rounded-lg border border-muted p-3">
            <p class="font-bold">
              {{ selected?.userName }}
            </p>
            <p class="text-sm text-muted">
              {{ selected?.userEmail }}
            </p>
            <div class="mt-2 flex items-center gap-2">
              <UBadge
                color="neutral"
                variant="outline"
              >
                {{ selected?.bettingHouseSlug }}
              </UBadge>
              <span
                v-if="selected?.dealName"
                class="text-sm text-muted"
              >{{ selected.dealName }}</span>
            </div>
            <p
              v-if="selected?.message"
              class="mt-2 text-sm text-muted italic"
            >
              "{{ selected.message }}"
            </p>
          </div>

          <!-- Deal FORM: respostas do formulário do afiliado (senha decifrada) -->
          <div
            v-if="isFormRequest && formEntries.length"
            class="rounded-lg border border-muted p-3 space-y-2"
          >
            <label class="text-sm font-semibold text-highlighted">Formulário enviado</label>
            <dl class="divide-y divide-[var(--ui-border)]">
              <div
                v-for="entry in formEntries"
                :key="entry.key"
                class="flex items-start justify-between gap-3 py-1.5"
              >
                <dt class="text-xs text-muted shrink-0">{{ entry.label }}</dt>
                <dd class="text-sm text-highlighted text-right break-all font-mono">{{ entry.value || '—' }}</dd>
              </div>
            </dl>
          </div>

          <div v-if="!isManualApprove" class="space-y-2">
            <label class="text-sm font-semibold text-highlighted">Links de Divulgacao</label>
            <div
              v-for="(lk, idx) in approveLinks"
              :key="idx"
              class="flex items-center gap-2"
            >
              <UInput
                v-model="lk.label"
                placeholder="Nome (ex: Instagram)"
                class="w-36"
              />
              <UInput
                v-model="lk.url"
                placeholder="https://..."
                class="flex-1"
              />
              <UButton
                v-if="approveLinks.length > 1"
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="xs"
                @click="removeLink(idx)"
              />
            </div>
            <UButton
              icon="i-lucide-plus"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="addLink"
            >
              Adicionar link
            </UButton>
          </div>

          <UFormField label="Observacao (opcional)">
            <UTextarea
              v-model="approveNote"
              :rows="3"
              :maxlength="1000"
              placeholder="Mensagem visivel ao afiliado"
            />
          </UFormField>

          <UFormField
            v-if="!isManualApprove || isFormRequest"
            :label="isFormRequest ? 'ID de afiliado (para o cron)' : 'Campaign ID manual (opcional)'"
          >
            <UInput
              v-model="approveManualCampaignId"
              :placeholder="isFormRequest ? 'ID de afiliado no provedor' : 'ID da campanha'"
            />
          </UFormField>

          <!-- CPA / RevShare -->
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField :label="ceiling?.hasCeiling ? `CPA (R$) — máx R$${ceiling.maxCpa}` : 'CPA (R$)'">
              <UInput
                v-model.number="approveCpa"
                type="number"
                :step="0.01"
                :min="0"
                :max="ceiling?.maxCpa ?? undefined"
                placeholder="0.00"
              />
            </UFormField>
            <UFormField :label="ceiling?.hasCeiling ? `RevShare (%) — máx ${ceiling.maxRevshare}%` : 'RevShare (%)'">
              <UInput
                v-model.number="approveRevshare"
                type="number"
                :step="0.01"
                :min="0"
                :max="ceiling?.maxRevshare ?? 100"
                placeholder="0.00"
              />
            </UFormField>
          </div>
          <p
            v-if="ceiling?.hasCeiling"
            class="text-xs"
            style="color: var(--color-text-muted)"
          >
            Teto definido pelo acordo de {{ ceiling.referrerName }} nesta casa.
          </p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="showApproveModal = false"
          >
            Cancelar
          </UButton>
          <UButton
            color="success"
            :loading="submitting"
            @click="submitApprove"
          >
            Aprovar e Enviar
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Reject Modal -->
    <UModal
      v-model:open="showRejectModal"
      title="Rejeitar Solicitacao"
    >
      <template #body>
        <div class="space-y-4">
          <div class="rounded-lg border border-muted p-3">
            <p class="font-bold">
              {{ selected?.userName }}
            </p>
            <p class="text-sm text-muted">
              {{ selected?.userEmail }}
            </p>
            <div class="mt-2 flex items-center gap-2">
              <UBadge
                color="neutral"
                variant="outline"
              >
                {{ selected?.bettingHouseSlug }}
              </UBadge>
              <span
                v-if="selected?.dealName"
                class="text-sm text-muted"
              >{{ selected.dealName }}</span>
            </div>
          </div>

          <UFormField label="Motivo da rejeicao (opcional)">
            <UTextarea
              v-model="rejectNote"
              :rows="3"
              :maxlength="1000"
              placeholder="Explique o motivo da rejeicao"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="showRejectModal = false"
          >
            Cancelar
          </UButton>
          <UButton
            color="error"
            :loading="submitting"
            @click="submitReject"
          >
            Rejeitar
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>

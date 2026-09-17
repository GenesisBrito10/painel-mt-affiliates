<script setup lang="ts">
definePageMeta({ layout: 'default' })

interface BettingHouse {
  id: string
  name: string
  slug: string
}

interface Deal {
  id: string
  bettingHouseSlug: string
  bettingHouse: { name: string; slug: string }
  name: string
  cpa: number
  revshare: number
  baseline: number
  minAvgDepositPerFtd: number
  minQualifiedFtd: number
  exclusive: boolean
  featured: boolean
  newArrival: boolean
  sortOrder: number
  paymentCpaLabel: string
  paymentRevshareLabel: string
  revenueType: string
  revNegativeAccumulates: boolean
  revNegativeOffsetsCpa: boolean
  withdrawalIndicators: string[]
  trafficSources: string[]
  conditionsText: string
  paymentNotes: string
  logoUrl: string
  active: boolean
  legacyKey: string | null
  createdAt: string
  kind?: 'LINK' | 'FORM'
  formSchema?: FormField[] | null
}

// Campo dinâmico de um deal kind=FORM. Editável no construtor (FormSchemaBuilder).
interface FormFieldOption {
  value: string
  label?: string
  cpa?: number
  revshare?: number
}
interface FormField {
  key: string
  label?: string
  type: string
  required?: boolean
  readonly?: boolean
  secret?: boolean
  prefill?: string
  group?: string
  options?: Array<string | FormFieldOption>
  default?: unknown
}

const { token } = useAuth()
const toast = useToast()
const config = useRuntimeConfig()
const apiBase = config.public.apiUrl

function authHeaders() {
  return { Authorization: `Bearer ${token.value}` }
}

const deals = ref<Deal[]>([])
const houses = ref<BettingHouse[]>([])
const loading = ref(false)
const submitting = ref(false)

const filterSearch = ref('')
const filterHouse = ref('all')
const filterActive = ref<string>('all')

const showFormModal = ref(false)
const showDeleteModal = ref(false)
const editing = ref<Deal | null>(null)
const deleting = ref<Deal | null>(null)

function emptyForm() {
  return {
    bettingHouseSlug: '',
    name: '',
    cpa: 0,
    revshare: 0,
    baseline: 0,
    minAvgDepositPerFtd: 80,
    minQualifiedFtd: 15,
    exclusive: false,
    featured: false,
    newArrival: false,
    sortOrder: 0,
    paymentCpaLabel: '',
    paymentRevshareLabel: '',
    revenueType: '',
    revNegativeAccumulates: false,
    revNegativeOffsetsCpa: false,
    withdrawalIndicatorsRaw: '',
    trafficSourcesRaw: '',
    conditionsText: '',
    paymentNotes: '',
    logoUrl: '',
    active: true,
    legacyKey: '',
    kind: 'LINK' as 'LINK' | 'FORM',
    formSchema: [] as FormField[],
  }
}

const form = ref(emptyForm())

async function loadDeals() {
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (filterHouse.value && filterHouse.value !== 'all') params.set('house', filterHouse.value)
    if (filterActive.value !== 'all') params.set('active', filterActive.value)
    if (filterSearch.value) params.set('search', filterSearch.value)
    const qs = params.toString()
    const res = await $fetch<{ data: Deal[] }>(`${apiBase}/admin/deals${qs ? `?${qs}` : ''}`, {
      headers: authHeaders(),
    })
    deals.value = res.data
  } catch {
    toast.add({ title: 'Erro ao carregar deals', color: 'error' })
  } finally {
    loading.value = false
  }
}

async function loadHouses() {
  try {
    const res = await $fetch<{ data: BettingHouse[] }>(`${apiBase}/admin/houses`, {
      headers: authHeaders(),
    })
    houses.value = res.data
  } catch {
    // houses used only for dropdown — silent fail acceptable
  }
}

function openCreate() {
  editing.value = null
  form.value = emptyForm()
  showFormModal.value = true
}

function openEdit(deal: Deal) {
  editing.value = deal
  form.value = {
    bettingHouseSlug: deal.bettingHouseSlug,
    name: deal.name,
    cpa: Number(deal.cpa),
    revshare: Number(deal.revshare),
    baseline: Number(deal.baseline),
    minAvgDepositPerFtd: Number(deal.minAvgDepositPerFtd),
    minQualifiedFtd: Number(deal.minQualifiedFtd),
    exclusive: deal.exclusive,
    featured: deal.featured,
    newArrival: deal.newArrival,
    sortOrder: deal.sortOrder,
    paymentCpaLabel: deal.paymentCpaLabel,
    paymentRevshareLabel: deal.paymentRevshareLabel,
    revenueType: deal.revenueType,
    revNegativeAccumulates: deal.revNegativeAccumulates,
    revNegativeOffsetsCpa: deal.revNegativeOffsetsCpa,
    withdrawalIndicatorsRaw: deal.withdrawalIndicators.join(', '),
    trafficSourcesRaw: deal.trafficSources.join(', '),
    conditionsText: deal.conditionsText,
    paymentNotes: deal.paymentNotes,
    logoUrl: deal.logoUrl,
    active: deal.active,
    legacyKey: deal.legacyKey ?? '',
    kind: deal.kind ?? 'LINK',
    formSchema: Array.isArray(deal.formSchema) ? deal.formSchema : [],
  }
  showFormModal.value = true
}

function onHouseSelected(slug: string) {
  if (!slug) return
  const house = houses.value.find(h => h.slug === slug)
  if (house) {
    if (!form.value.name) {
      form.value.name = `${house.name}`
    }
  }
}

function parseTagList(raw: string): string[] {
  return raw.split(',').map(s => s.trim()).filter(Boolean)
}

async function submitForm() {
  if (!form.value.bettingHouseSlug || !form.value.name) {
    toast.add({ title: 'Casa e Nome são obrigatórios', color: 'error' })
    return
  }
  submitting.value = true
  try {
    const payload = {
      bettingHouseSlug: form.value.bettingHouseSlug,
      name: form.value.name,
      cpa: form.value.cpa,
      revshare: form.value.revshare,
      baseline: form.value.baseline,
      minAvgDepositPerFtd: form.value.minAvgDepositPerFtd,
      minQualifiedFtd: form.value.minQualifiedFtd,
      exclusive: form.value.exclusive,
      featured: form.value.featured,
      newArrival: form.value.newArrival,
      sortOrder: form.value.sortOrder,
      paymentCpaLabel: form.value.paymentCpaLabel,
      paymentRevshareLabel: form.value.paymentRevshareLabel,
      revenueType: form.value.revenueType,
      revNegativeAccumulates: form.value.revNegativeAccumulates,
      revNegativeOffsetsCpa: form.value.revNegativeOffsetsCpa,
      withdrawalIndicators: parseTagList(form.value.withdrawalIndicatorsRaw),
      trafficSources: parseTagList(form.value.trafficSourcesRaw),
      conditionsText: form.value.conditionsText,
      paymentNotes: form.value.paymentNotes,
      logoUrl: form.value.logoUrl,
      active: form.value.active,
      legacyKey: form.value.legacyKey || '',
      kind: form.value.kind,
      // Só envia formSchema quando é FORM (evita sobrescrever com [] em deals LINK).
      formSchema: form.value.kind === 'FORM' ? form.value.formSchema : undefined,
    }

    if (form.value.kind === 'FORM' && (!form.value.formSchema || form.value.formSchema.length === 0)) {
      toast.add({ title: 'Adicione ao menos um campo ao formulário', color: 'error' })
      submitting.value = false
      return
    }

    if (editing.value) {
      await $fetch(`${apiBase}/admin/deals/${editing.value.id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: payload,
      })
      toast.add({ title: 'Deal atualizado', color: 'success' })
    } else {
      await $fetch(`${apiBase}/admin/deals`, {
        method: 'POST',
        headers: authHeaders(),
        body: payload,
      })
      toast.add({ title: 'Deal criado', color: 'success' })
    }

    showFormModal.value = false
    await loadDeals()
  } catch (err: unknown) {
    const e = err as { data?: { detail?: string; message?: string }; message?: string }
    const msg = e.data?.detail || e.data?.message || e.message || 'Erro ao salvar deal'
    toast.add({ title: 'Erro ao salvar deal', description: msg, color: 'error' })
  } finally {
    submitting.value = false
  }
}

function openDelete(deal: Deal) {
  deleting.value = deal
  showDeleteModal.value = true
}

async function confirmDelete() {
  if (!deleting.value) return
  submitting.value = true
  try {
    await $fetch(`${apiBase}/admin/deals/${deleting.value.id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    })
    toast.add({ title: 'Deal removido', color: 'success' })
    showDeleteModal.value = false
    deleting.value = null
    await loadDeals()
  } catch (err: unknown) {
    const e = err as { data?: { detail?: string; message?: string }; message?: string }
    const msg = e.data?.detail || e.data?.message || e.message || 'Erro ao remover deal'
    toast.add({ title: 'Erro ao remover deal', description: msg, color: 'error' })
  } finally {
    submitting.value = false
  }
}

const houseOptions = computed(() => [
  { label: 'Todas as casas', value: 'all' },
  ...houses.value.map(h => ({ label: h.name, value: h.slug })),
])

const houseSelectOptions = computed(() =>
  houses.value.map(h => ({ label: h.name, value: h.slug })),
)

const activeOptions = [
  { label: 'Todos', value: 'all' },
  { label: 'Ativos', value: 'true' },
  { label: 'Inativos', value: 'false' },
]

const columns = [
  { key: 'name', id: 'name', accessorKey: 'name', label: 'Nome', header: 'Nome' },
  { key: 'house', id: 'house', accessorKey: 'house', label: 'Casa', header: 'Casa' },
  { key: 'cpa', id: 'cpa', accessorKey: 'cpa', label: 'CPA', header: 'CPA' },
  { key: 'revshare', id: 'revshare', accessorKey: 'revshare', label: 'RevShare', header: 'RevShare' },
  { key: 'sortOrder', id: 'sortOrder', accessorKey: 'sortOrder', label: 'Ordem', header: 'Ordem' },
  { key: 'flags', id: 'flags', accessorKey: 'flags', label: 'Flags', header: 'Flags' },
  { key: 'active', id: 'active', accessorKey: 'active', label: 'Status', header: 'Status' },
  { key: 'actions', id: 'actions', accessorKey: 'actions', label: 'Ações', header: 'Ações' },
]

onMounted(() => {
  loadDeals()
  loadHouses()
})
</script>

<template>
  <div class="admin-page space-y-5">
    <!-- Header -->
    <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <h1 class="text-2xl font-black text-highlighted">
          Deals
        </h1>
        <p class="text-sm text-muted">
          Criação e gestão de deals disponíveis por casa de apostas.
        </p>
      </div>
      <div class="flex flex-col gap-2 sm:flex-row">
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="soft"
          :loading="loading"
          @click="loadDeals()"
        >
          Atualizar
        </UButton>
        <UButton
          icon="i-lucide-plus"
          @click="openCreate"
        >
          Novo Deal
        </UButton>
      </div>
    </div>

    <!-- Filters -->
    <div class="flex flex-wrap gap-3">
      <UInput
        v-model="filterSearch"
        icon="i-lucide-search"
        placeholder="Buscar por nome..."
        class="w-56"
        @keyup.enter="loadDeals()"
      />
      <USelect
        v-model="filterHouse"
        :items="houseOptions"
        label-key="label"
        value-key="value"
        class="w-48"
        @change="loadDeals()"
      />
      <USelect
        v-model="filterActive"
        :items="activeOptions"
        label-key="label"
        value-key="value"
        class="w-36"
        @change="loadDeals()"
      />
    </div>

    <!-- Table -->
    <div class="table-scroll">
      <UTable
        :data="deals"
        :columns="columns"
        :loading="loading"
      >
        <template #house-cell="{ row }">
          <span class="text-sm">{{ row.original.bettingHouse?.name ?? row.original.bettingHouseSlug }}</span>
        </template>

        <template #cpa-cell="{ row }">
          <span class="font-mono text-sm">R$ {{ Number(row.original.cpa).toFixed(2) }}</span>
        </template>

        <template #revshare-cell="{ row }">
          <span class="font-mono text-sm">{{ Number(row.original.revshare).toFixed(2) }}%</span>
        </template>

        <template #flags-cell="{ row }">
          <div class="flex flex-wrap gap-1">
            <UBadge
              v-if="row.original.featured"
              color="warning"
              variant="soft"
              size="xs"
            >
              Destaque
            </UBadge>
            <UBadge
              v-if="row.original.newArrival"
              color="info"
              variant="soft"
              size="xs"
            >
              Novidade
            </UBadge>
            <UBadge
              v-if="row.original.exclusive"
              color="secondary"
              variant="soft"
              size="xs"
            >
              Exclusivo
            </UBadge>
          </div>
        </template>

        <template #active-cell="{ row }">
          <UBadge
            :color="row.original.active ? 'success' : 'neutral'"
            variant="soft"
            size="xs"
          >
            {{ row.original.active ? 'Ativo' : 'Inativo' }}
          </UBadge>
        </template>

        <template #actions-cell="{ row }">
          <div class="flex gap-1 justify-end">
            <UButton
              icon="i-lucide-pencil"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="openEdit(row.original)"
            />
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="ghost"
              size="xs"
              @click="openDelete(row.original)"
            />
          </div>
        </template>
      </UTable>
    </div>

    <!-- Create / Edit Modal -->
    <UModal
      v-model:open="showFormModal"
      :title="editing ? 'Editar Deal' : 'Novo Deal'"
    >
      <template #body>
        <div class="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <!-- Basic -->
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <UFormField
              label="Casa de Apostas *"
              class="sm:col-span-2"
            >
              <USelect
                v-model="form.bettingHouseSlug"
                :items="houseSelectOptions"
                label-key="label"
                value-key="value"
                placeholder="Selecione a casa"
                class="w-full"
                @update:model-value="onHouseSelected"
              />
            </UFormField>

            <UFormField
              label="Nome do Deal *"
              class="sm:col-span-2"
            >
              <UInput
                v-model="form.name"
                placeholder="Ex: CPA Padrão Betano"
                class="w-full"
              />
            </UFormField>

            <UFormField
              label="Tipo do Deal"
              class="sm:col-span-2"
              help="LINK: afiliado solicita link. FORM: afiliado preenche um formulário e o admin libera o acesso."
            >
              <USelect
                v-model="form.kind"
                :items="[{ label: 'Link (padrão)', value: 'LINK' }, { label: 'Formulário', value: 'FORM' }]"
                label-key="label"
                value-key="value"
                class="w-full"
              />
            </UFormField>
          </div>

          <!-- Construtor do formulário (deals kind=FORM) -->
          <FormSchemaBuilder
            v-if="form.kind === 'FORM'"
            v-model="form.formSchema"
          />

          <!-- Financials -->
          <p class="text-xs font-semibold text-muted uppercase tracking-wide pt-1">
            Financeiro
          </p>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <UFormField label="CPA (R$)">
              <UInput
                v-model.number="form.cpa"
                type="number"
                step="0.01"
                min="0"
              />
            </UFormField>
            <UFormField label="RevShare (%)">
              <UInput
                v-model.number="form.revshare"
                type="number"
                step="0.01"
                min="0"
              />
            </UFormField>
            <UFormField label="Baseline (R$)">
              <UInput
                v-model.number="form.baseline"
                type="number"
                step="0.01"
                min="0"
              />
            </UFormField>
            <UFormField label="Dep. mín/FTD (R$)">
              <UInput
                v-model.number="form.minAvgDepositPerFtd"
                type="number"
                step="0.01"
                min="0"
              />
            </UFormField>
            <UFormField label="QFTD mínimo">
              <UInput
                v-model.number="form.minQualifiedFtd"
                type="number"
                step="1"
                min="0"
              />
            </UFormField>
          </div>

          <!-- Labels -->
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <UFormField label="Label CPA">
              <UInput
                v-model="form.paymentCpaLabel"
                placeholder="Ex: CPA R$120"
              />
            </UFormField>
            <UFormField label="Label RevShare">
              <UInput
                v-model="form.paymentRevshareLabel"
                placeholder="Ex: RevShare 35%"
              />
            </UFormField>
            <UFormField label="Tipo de receita">
              <UInput
                v-model="form.revenueType"
                placeholder="Ex: NET"
              />
            </UFormField>
          </div>

          <!-- Arrays -->
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <UFormField
              label="Indicadores de saque"
              description="Separados por vírgula"
            >
              <UInput
                v-model="form.withdrawalIndicatorsRaw"
                placeholder="Ex: depósitos, registros"
              />
            </UFormField>
            <UFormField
              label="Fontes de tráfego"
              description="Separados por vírgula"
            >
              <UInput
                v-model="form.trafficSourcesRaw"
                placeholder="Ex: orgânico, pago"
              />
            </UFormField>
          </div>

          <!-- Texts -->
          <UFormField label="Indicadores Mínimos (KPIs)" description="Texto exibido na seção 'Indicadores Mínimos' do modal do deal para o afiliado">
            <UTextarea
              v-model="form.conditionsText"
              :rows="3"
              placeholder="Ex: Depósito médio > R$ 50,00&#10;Taxa de redepósito > 50%&#10;Rollover: R$ 40,00"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Regras de Pagamento" description="Texto exibido na seção 'Regras de Pagamento' do modal do deal para o afiliado">
            <UTextarea
              v-model="form.paymentNotes"
              :rows="3"
              placeholder="Ex: - Rollover de R$ 40,00 e 10 jogadas mínimas.&#10;- Limite de 5 dias após o CPA para bater os KPIs."
              class="w-full"
            />
          </UFormField>

          <!-- Meta -->
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <UFormField label="Logo URL">
              <UInput
                v-model="form.logoUrl"
                placeholder="https://..."
              />
            </UFormField>
            <UFormField label="Legacy Key">
              <UInput
                v-model="form.legacyKey"
                placeholder="Chave legada (opcional)"
              />
            </UFormField>
          </div>

          <UFormField label="Ordem de exibição">
            <UInput
              v-model.number="form.sortOrder"
              type="number"
              class="w-32"
            />
          </UFormField>

          <!-- Flags -->
          <p class="text-xs font-semibold text-muted uppercase tracking-wide pt-1">
            Flags
          </p>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <UCheckbox
              v-model="form.active"
              label="Ativo"
            />
            <UCheckbox
              v-model="form.featured"
              label="Destaque"
            />
            <UCheckbox
              v-model="form.newArrival"
              label="Novidade"
            />
            <UCheckbox
              v-model="form.exclusive"
              label="Exclusivo"
            />
            <UCheckbox
              v-model="form.revNegativeAccumulates"
              label="Rev neg. acumula"
            />
            <UCheckbox
              v-model="form.revNegativeOffsetsCpa"
              label="Rev neg. abate CPA"
            />
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
            :loading="submitting"
            @click="submitForm"
          >
            {{ editing ? 'Salvar' : 'Criar' }}
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Delete Confirmation Modal -->
    <UModal
      v-model:open="showDeleteModal"
      title="Confirmar Exclusão"
    >
      <template #body>
        <div class="space-y-3">
          <p>
            Excluir o deal <strong class="text-highlighted">{{ deleting?.name }}</strong>?
          </p>
          <p class="text-sm text-muted">
            Esta ação não pode ser desfeita. Solicitações de link vinculadas perderão a referência ao deal.
          </p>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="showDeleteModal = false"
          >
            Cancelar
          </UButton>
          <UButton
            color="error"
            :loading="submitting"
            @click="confirmDelete"
          >
            Excluir
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>

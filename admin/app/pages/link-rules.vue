<script setup lang="ts">
import type { HouseLinkRule, RangeTier, BackfillSummary, RuleChangeLog } from '~/composables/useLinkRules'

definePageMeta({ layout: 'default' })

const { listRules, getHistory, saveRule, runBackfill, reprocess } = useLinkRules()
const toast = useToast()

const loading = ref(false)
const rules = ref<HouseLinkRule[]>([])
const editing = ref<HouseLinkRule | null>(null)
const submitting = ref(false)
const changeReason = ref('')

// Backfill state
const backfillBusy = ref(false)
const backfillPreview = ref<BackfillSummary | null>(null)
const backfillReason = ref('')
const forceRecalculate = ref(false)

// Reprocess
const reprocessId = ref('')
const reprocessReason = ref('')
const recalcSnapshot = ref(true)
const reprocessBusy = ref(false)

const history = ref<RuleChangeLog[]>([])

const allSlugs = computed(() => rules.value.map((r) => r.houseSlug))
const ruleTypeOptions = [
  { label: 'CPA do convidante − desconto', value: 'INVITER_DISCOUNT' },
  { label: 'Faixa (RANGE)', value: 'RANGE' },
  { label: 'Espelho da casa de referência (MIRROR)', value: 'MIRROR' },
]

async function load() {
  loading.value = true
  try {
    rules.value = await listRules()
  } catch (err) {
    toast.add({ title: 'Erro ao carregar regras', description: String(err), color: 'error' })
  } finally {
    loading.value = false
  }
}

function num(v: string | number | null): number | null {
  if (v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function openEdit(rule: HouseLinkRule) {
  // clone para edição
  editing.value = JSON.parse(JSON.stringify(rule))
  if (!Array.isArray(editing.value!.rangeTiers)) editing.value!.rangeTiers = []
  changeReason.value = ''
  void loadHistory(rule.houseSlug)
}

function addTier() {
  editing.value?.rangeTiers.push({ min: null, max: null, cpa: 0 })
}
function removeTier(i: number) {
  editing.value?.rangeTiers.splice(i, 1)
}

async function loadHistory(slug: string) {
  try {
    history.value = await getHistory(slug)
  } catch {
    history.value = []
  }
}

async function submit() {
  if (!editing.value) return
  const r = editing.value
  submitting.value = true
  try {
    const body: Partial<HouseLinkRule> & { changeReason?: string } = {
      requestEnabled: r.requestEnabled,
      autoAssignEnabled: r.autoAssignEnabled,
      ruleType: r.ruleType,
      defaultCpa: num(r.defaultCpa) ?? 0,
      fallbackCpa: num(r.fallbackCpa) ?? 0,
      inviterCpaThreshold: num(r.inviterCpaThreshold),
      inviterCpaDiscount: num(r.inviterCpaDiscount) ?? 0,
      defaultRevshare: num(r.defaultRevshare) ?? 0,
      rangeReferenceHouse: r.rangeReferenceHouse || null,
      rangeTiers: r.rangeTiers.map((t: RangeTier) => ({
        min: num(t.min),
        max: num(t.max),
        cpa: num(t.cpa) ?? 0,
      })),
      checkExistingLink: r.checkExistingLink,
      checkPendingRequest: r.checkPendingRequest,
      useInviterCpa: r.useInviterCpa,
      applyFallbackNoInviterCpa: r.applyFallbackNoInviterCpa,
      applyDefaultNoInviter: r.applyDefaultNoInviter,
      blockOnRequiredFail: r.blockOnRequiredFail,
      processOldRequests: r.processOldRequests,
      requireActiveLinkInHouses: r.requireActiveLinkInHouses,
      requiredHouseSlugs: r.requiredHouseSlugs,
      blockMessage: r.blockMessage,
      changeReason: changeReason.value || undefined,
    }
    await saveRule(r.houseSlug, body)
    toast.add({ title: 'Regra salva', color: 'success' })
    await load()
    await loadHistory(r.houseSlug)
  } catch (err: unknown) {
    const e = err as { data?: { message?: string; issues?: Array<{ message: string }> } }
    const issues = e.data?.issues?.map((i) => i.message).join(' | ')
    toast.add({
      title: 'Não foi possível salvar',
      description: issues || e.data?.message || String(err),
      color: 'error',
    })
  } finally {
    submitting.value = false
  }
}

async function doBackfill(dryRun: boolean) {
  if (!editing.value) return
  backfillBusy.value = true
  try {
    const summary = await runBackfill(editing.value.houseSlug, {
      dryRun,
      forceRecalculate: forceRecalculate.value,
      reason: backfillReason.value || undefined,
    })
    backfillPreview.value = summary
    toast.add({
      title: dryRun ? 'Prévia gerada' : 'Backfill executado',
      description: `avaliadas=${summary.evaluated} processadas=${summary.processed} bloqueadas=${summary.blocked} aguardando-pool=${summary.waitingPool}`,
      color: 'success',
    })
  } catch (err: unknown) {
    const e = err as { data?: { message?: string } }
    toast.add({ title: 'Backfill falhou', description: e.data?.message || String(err), color: 'error' })
  } finally {
    backfillBusy.value = false
  }
}

async function doReprocess() {
  if (!reprocessId.value || !reprocessReason.value) {
    toast.add({ title: 'Informe ID e motivo', color: 'warning' })
    return
  }
  reprocessBusy.value = true
  try {
    const res = await reprocess(reprocessId.value, {
      reason: reprocessReason.value,
      recalculateSnapshot: recalcSnapshot.value,
    })
    toast.add({ title: `Reprocessado: ${res.status} / ${res.outcome}`, color: 'success' })
  } catch (err: unknown) {
    const e = err as { data?: { message?: string } }
    toast.add({ title: 'Reprocesso falhou', description: e.data?.message || String(err), color: 'error' })
  } finally {
    reprocessBusy.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="p-4 space-y-4">
    <div class="flex items-center justify-between">
      <h1 class="text-xl font-semibold">Regras de Solicitação/Atribuição de Links</h1>
      <UButton icon="i-lucide-refresh-cw" variant="ghost" :loading="loading" @click="load">Recarregar</UButton>
    </div>

    <!-- Lista de regras -->
    <div class="grid gap-2">
      <UCard v-for="r in rules" :key="r.houseSlug">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="font-medium">{{ r.houseSlug }}</div>
            <div class="text-xs text-gray-500">
              {{ r.ruleType }} · padrão {{ r.defaultCpa }} · fallback {{ r.fallbackCpa }}
              <span v-if="r.requireActiveLinkInHouses"> · exige: {{ r.requiredHouseSlugs.join(', ') }}</span>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <UBadge :color="r.requestEnabled ? 'success' : 'neutral'">{{ r.requestEnabled ? 'ativa' : 'inativa' }}</UBadge>
            <UBadge :color="r.autoAssignEnabled ? 'primary' : 'neutral'">auto {{ r.autoAssignEnabled ? 'on' : 'off' }}</UBadge>
            <UButton size="xs" icon="i-lucide-pencil" @click="openEdit(r)">Editar</UButton>
          </div>
        </div>
      </UCard>
    </div>

    <!-- Editor -->
    <UModal
      :open="!!editing"
      :title="`Regra — ${editing?.houseSlug}`"
      :ui="{ content: 'max-w-3xl' }"
      @update:open="(v: boolean) => { if (!v) editing = null }"
    >
      <template #body>
        <div v-if="editing" class="space-y-4">
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Solicitação ativa"><USwitch v-model="editing.requestEnabled" /></UFormField>
            <UFormField label="Atribuição automática"><USwitch v-model="editing.autoAssignEnabled" /></UFormField>
          </div>

          <UFormField label="Tipo de regra">
            <USelectMenu v-model="editing.ruleType" :items="ruleTypeOptions" value-key="value" />
          </UFormField>

          <div class="grid grid-cols-2 gap-3">
            <UFormField label="CPA padrão"><UInput v-model="editing.defaultCpa" type="number" /></UFormField>
            <UFormField label="CPA fallback"><UInput v-model="editing.fallbackCpa" type="number" /></UFormField>
            <UFormField label="Limite CPA convidante (threshold)"><UInput v-model="editing.inviterCpaThreshold" type="number" /></UFormField>
            <UFormField label="Desconto sobre CPA convidante"><UInput v-model="editing.inviterCpaDiscount" type="number" /></UFormField>
          </div>

          <!-- Espelho (MIRROR): CPA = CPA do usuário na casa de referência -->
          <div v-if="editing.ruleType === 'MIRROR'" class="space-y-2 border rounded p-3">
            <p class="text-sm text-gray-500">
              O CPA será igual ao CPA do próprio usuário na casa de referência.
              Sem CPA na referência → usa o CPA fallback.
            </p>
            <UFormField label="Casa de referência (slug)">
              <USelectMenu v-model="editing.rangeReferenceHouse" :items="allSlugs" />
            </UFormField>
          </div>

          <!-- Faixas (RANGE) -->
          <div v-if="editing.ruleType === 'RANGE'" class="space-y-2 border rounded p-3">
            <div class="flex items-center justify-between">
              <span class="font-medium text-sm">Faixas de CPA</span>
              <UButton size="xs" icon="i-lucide-plus" @click="addTier">Faixa</UButton>
            </div>
            <UFormField label="Casa de referência (slug)">
              <USelectMenu v-model="editing.rangeReferenceHouse" :items="allSlugs" />
            </UFormField>
            <div v-for="(t, i) in editing.rangeTiers" :key="i" class="grid grid-cols-4 gap-2 items-end">
              <UFormField label="Min"><UInput v-model="t.min" type="number" placeholder="∞" /></UFormField>
              <UFormField label="Max"><UInput v-model="t.max" type="number" placeholder="∞" /></UFormField>
              <UFormField label="CPA"><UInput v-model="t.cpa" type="number" /></UFormField>
              <UButton size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="removeTier(i)" />
            </div>
          </div>

          <!-- Toggles de validação -->
          <div class="grid grid-cols-2 gap-2 border rounded p-3">
            <UFormField label="Verificar link existente"><USwitch v-model="editing.checkExistingLink" /></UFormField>
            <UFormField label="Verificar solicitação pendente"><USwitch v-model="editing.checkPendingRequest" /></UFormField>
            <UFormField label="Usar CPA do convidante"><USwitch v-model="editing.useInviterCpa" /></UFormField>
            <UFormField label="Fallback se convidante sem CPA"><USwitch v-model="editing.applyFallbackNoInviterCpa" /></UFormField>
            <UFormField label="CPA padrão se sem convidante"><USwitch v-model="editing.applyDefaultNoInviter" /></UFormField>
            <UFormField label="Bloquear se validação falhar"><USwitch v-model="editing.blockOnRequiredFail" /></UFormField>
            <UFormField label="Reprocessar antigas (backfill)"><USwitch v-model="editing.processOldRequests" /></UFormField>
          </div>

          <!-- Dependência entre casas -->
          <div class="space-y-2 border rounded p-3">
            <UFormField label="Exigir link ativo em outra(s) casa(s)"><USwitch v-model="editing.requireActiveLinkInHouses" /></UFormField>
            <UFormField v-if="editing.requireActiveLinkInHouses" label="Casas exigidas">
              <USelectMenu v-model="editing.requiredHouseSlugs" :items="allSlugs" multiple />
            </UFormField>
            <UFormField label="Mensagem de bloqueio">
              <UTextarea v-model="editing.blockMessage" :rows="2" />
            </UFormField>
          </div>

          <UFormField label="Motivo da alteração (obrigatório p/ valores financeiros)">
            <UInput v-model="changeReason" placeholder="Ex: ajuste de desconto" />
          </UFormField>

          <div class="flex justify-end gap-2">
            <UButton :loading="submitting" @click="submit">Salvar</UButton>
          </div>

          <!-- Backfill -->
          <div class="space-y-2 border rounded p-3">
            <div class="font-medium text-sm">Reprocessar solicitações antigas</div>
            <UFormField label="Motivo (obrigatório se forçar recálculo)">
              <UInput v-model="backfillReason" />
            </UFormField>
            <UFormField label="Forçar recálculo (sobrescreve snapshot, só PENDING)">
              <USwitch v-model="forceRecalculate" />
            </UFormField>
            <div class="flex gap-2">
              <UButton variant="outline" :loading="backfillBusy" @click="doBackfill(true)">Prévia (dry-run)</UButton>
              <UButton color="warning" :loading="backfillBusy" @click="doBackfill(false)">Executar</UButton>
            </div>
            <div v-if="backfillPreview" class="text-xs text-gray-600">
              avaliadas={{ backfillPreview.evaluated }} · processadas={{ backfillPreview.processed }} ·
              puladas={{ backfillPreview.skipped }} · bloqueadas={{ backfillPreview.blocked }} ·
              aguardando-pool={{ backfillPreview.waitingPool }} · erros={{ backfillPreview.errors }}
            </div>
          </div>

          <!-- Histórico -->
          <div v-if="history.length" class="space-y-1 border rounded p-3">
            <div class="font-medium text-sm">Histórico de alterações</div>
            <div v-for="h in history" :key="h.id" class="text-xs text-gray-600">
              {{ new Date(h.createdAt).toLocaleString() }} — {{ h.adminName }}
              <span v-if="h.changeReason">: {{ h.changeReason }}</span>
            </div>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Reprocesso por solicitação -->
    <UCard>
      <div class="space-y-2">
        <div class="font-medium text-sm">Reprocessar solicitação específica</div>
        <div class="grid grid-cols-3 gap-2 items-end">
          <UFormField label="ID da solicitação"><UInput v-model="reprocessId" /></UFormField>
          <UFormField label="Motivo"><UInput v-model="reprocessReason" /></UFormField>
          <UFormField label="Recalcular CPA"><USwitch v-model="recalcSnapshot" /></UFormField>
        </div>
        <UButton :loading="reprocessBusy" @click="doReprocess">Reprocessar</UButton>
      </div>
    </UCard>
  </div>
</template>

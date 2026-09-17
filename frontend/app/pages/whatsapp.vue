<script setup lang="ts">
import {
  useWhatsapp,
  type WhatsappGroup,
  type WhatsappMetrics,
  type WhatsappSendLog,
  type WhatsappSettings,
  type WhatsappStatus,
} from '~/composables/useWhatsapp'

definePageMeta({ layout: 'default' })

const wa = useWhatsapp()
const toast = useToast()

// ─── State ────────────────────────────────────────────────────────────────
const status = ref<WhatsappStatus | null>(null)
const qrcode = ref<string | null>(null)
const settings = ref<WhatsappSettings | null>(null)
const groups = ref<WhatsappGroup[]>([])
const metrics = ref<WhatsappMetrics | null>(null)
const previewText = ref('')

const loadingStatus = ref(false)
const connecting = ref(false)
const loadingGroups = ref(false)
const savingSettings = ref(false)
const testing = ref(false)
const resettingCircuit = ref(false)
const refreshingInstance = ref(false)

let pollTimer: ReturnType<typeof setInterval> | null = null

// ─── History ──────────────────────────────────────────────────────────────
const history = ref<WhatsappSendLog[]>([])
const page = ref(1)
const totalPages = ref(1)
const filterStatus = ref('all')
const filterSearch = ref('')
const filterFrom = ref('')
const filterTo = ref('')
const loadingHistory = ref(false)

const detailOpen = ref(false)
const detail = ref<WhatsappSendLog | null>(null)

const STATUS_OPTIONS = [
  { label: 'Todos', value: 'all' },
  { label: 'Enviado', value: 'SENT' },
  { label: 'Falhou', value: 'FAILED' },
  { label: 'Pendente', value: 'PENDING' },
  { label: 'Processando', value: 'PROCESSING' },
  { label: 'Aguardando conexão', value: 'WAITING_CONNECTION' },
  { label: 'Pausado', value: 'PAUSED' },
  { label: 'Cancelado', value: 'CANCELLED' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────
const statusMeta = computed(() => {
  switch (status.value?.status) {
    case 'open':
      return { label: 'Conectado', color: 'success' as const, icon: 'i-lucide-check-circle' }
    case 'connecting':
      return { label: 'Conectando', color: 'warning' as const, icon: 'i-lucide-loader' }
    case 'error':
      return { label: 'Erro', color: 'error' as const, icon: 'i-lucide-alert-triangle' }
    default:
      return { label: 'Desconectado', color: 'error' as const, icon: 'i-lucide-x-circle' }
  }
})

const circuitOpen = computed(() => {
  const until = status.value?.circuitOpenUntil ?? metrics.value?.circuitOpenUntil
  return until ? new Date(until).getTime() > Date.now() : false
})

const groupSelectItems = computed(() =>
  groups.value.map((g) => ({ label: g.name || g.id, value: g.id })),
)

// Proxy null↔undefined para o USelectMenu (que espera string | undefined).
const selectedGroup = computed<string | undefined>({
  get: () => settings.value?.selectedGroupId ?? undefined,
  set: (v) => {
    if (settings.value) settings.value.selectedGroupId = v ?? null
  },
})

// Grupo persistido no banco. O teste lê o grupo do banco, não o estado local —
// então bloqueamos o envio de teste enquanto a seleção não foi salva.
const savedGroupId = ref<string | null>(null)
const groupUnsaved = computed(
  () => (settings.value?.selectedGroupId ?? null) !== savedGroupId.value,
)

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

function badgeColor(s: string): 'success' | 'error' | 'warning' | 'neutral' | 'info' {
  if (s === 'SENT') return 'success'
  if (s === 'FAILED') return 'error'
  if (s === 'PAUSED' || s === 'WAITING_CONNECTION') return 'warning'
  if (s === 'CANCELLED') return 'neutral'
  return 'info'
}

// ─── Actions ──────────────────────────────────────────────────────────────
async function refreshStatus() {
  loadingStatus.value = true
  try {
    status.value = await wa.fetchStatus()
  } catch {
    toast.add({ title: 'Erro ao buscar status', color: 'error', icon: 'i-lucide-x-circle' })
  } finally {
    loadingStatus.value = false
  }
}

async function doConnect() {
  connecting.value = true
  qrcode.value = null
  try {
    const res = await wa.connect()
    qrcode.value = res.qrcode ?? null
    if (status.value) status.value.status = res.status as WhatsappStatus['status']
    startQrPolling()
    toast.add({ title: 'Escaneie o QR Code', color: 'info', icon: 'i-lucide-qr-code' })
  } catch {
    toast.add({ title: 'Erro ao conectar', color: 'error', icon: 'i-lucide-x-circle' })
  } finally {
    connecting.value = false
  }
}

async function doReconnect() {
  try {
    await wa.reconnect()
    await refreshStatus()
    toast.add({ title: 'Reconectando…', color: 'info' })
  } catch {
    toast.add({ title: 'Erro ao reconectar', color: 'error' })
  }
}

async function doDisconnect() {
  try {
    await wa.disconnect()
    await refreshStatus()
  } catch {
    toast.add({ title: 'Erro ao desconectar', color: 'error' })
  }
}

function startQrPolling() {
  stopPolling()
  pollTimer = setInterval(async () => {
    await refreshStatus()
    if (status.value?.status === 'open') {
      qrcode.value = null
      stopPolling()
      toast.add({ title: 'WhatsApp conectado!', color: 'success', icon: 'i-lucide-check-circle' })
    } else {
      try {
        const qr = await wa.fetchQrCode()
        if (qr.qrcode) qrcode.value = qr.qrcode
      } catch { /* ignore */ }
    }
  }, 5000)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

async function loadGroups() {
  loadingGroups.value = true
  try {
    groups.value = await wa.fetchGroups()
    toast.add({ title: `${groups.value.length} grupo(s) carregado(s)`, color: 'success' })
  } catch {
    toast.add({ title: 'Erro ao carregar grupos (conecte o WhatsApp primeiro)', color: 'error' })
  } finally {
    loadingGroups.value = false
  }
}

async function loadSettings() {
  settings.value = await wa.fetchSettings()
  savedGroupId.value = settings.value?.selectedGroupId ?? null
  await doPreview()
}

async function saveSettings() {
  if (!settings.value) return
  savingSettings.value = true
  try {
    const group = groups.value.find((g) => g.id === settings.value!.selectedGroupId)
    const updated = await wa.saveSettings({
      selectedGroupId: settings.value.selectedGroupId,
      selectedGroupName: group?.name ?? settings.value.selectedGroupName,
      messageTemplate: settings.value.messageTemplate,
      sendMedia: settings.value.sendMedia,
      delayMinSeconds: settings.value.delayMinSeconds,
      delayMaxSeconds: settings.value.delayMaxSeconds,
      maxAttempts: settings.value.maxAttempts,
      maxWaitConnectionMinutes: settings.value.maxWaitConnectionMinutes,
      failureCooldownSeconds: settings.value.failureCooldownSeconds,
      enabled: settings.value.enabled,
    })
    settings.value = updated
    savedGroupId.value = updated.selectedGroupId ?? null
    toast.add({ title: 'Configuração salva!', color: 'success', icon: 'i-lucide-check-circle' })
    await doPreview()
  } catch (e) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Erro ao salvar'
    toast.add({ title: msg, color: 'error', icon: 'i-lucide-x-circle' })
  } finally {
    savingSettings.value = false
  }
}

async function doPreview() {
  try {
    const res = await wa.preview(settings.value?.messageTemplate)
    previewText.value = res.preview
  } catch {
    previewText.value = ''
  }
}

async function doTestSend() {
  testing.value = true
  try {
    await wa.testSend()
    toast.add({ title: 'Teste enfileirado — verifique o grupo', color: 'success', icon: 'i-lucide-send' })
    await loadMetrics()
    await loadHistory()
  } catch (e) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Erro no envio de teste'
    toast.add({ title: msg, color: 'error' })
  } finally {
    testing.value = false
  }
}

async function doResetCircuit() {
  resettingCircuit.value = true
  try {
    status.value = await wa.resetCircuit()
    toast.add({ title: 'Circuit breaker resetado — envios retomados', color: 'success', icon: 'i-lucide-play-circle' })
    await loadMetrics()
  } catch (e) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Erro ao resetar circuit'
    toast.add({ title: msg, color: 'error' })
  } finally {
    resettingCircuit.value = false
  }
}

async function doRefreshInstance() {
  refreshingInstance.value = true
  try {
    const res = await wa.refreshInstance()
    status.value = res
    if (res.tokenResolved) {
      toast.add({ title: 'Cache limpo — instância re-sincronizada', color: 'success', icon: 'i-lucide-check-circle' })
    } else {
      toast.add({ title: 'Cache limpo, mas o token não foi re-resolvido. Verifique se a instância existe na Evolution.', color: 'warning', icon: 'i-lucide-alert-triangle' })
    }
  } catch (e) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Erro ao limpar cache da instância'
    toast.add({ title: msg, color: 'error' })
  } finally {
    refreshingInstance.value = false
  }
}

async function loadMetrics() {
  try {
    metrics.value = await wa.fetchMetrics()
  } catch { /* ignore */ }
}

async function loadHistory() {
  loadingHistory.value = true
  try {
    const res = await wa.fetchHistory({
      status: filterStatus.value === 'all' ? undefined : filterStatus.value,
      search: filterSearch.value || undefined,
      from: filterFrom.value || undefined,
      to: filterTo.value || undefined,
      page: page.value,
      limit: 20,
    })
    history.value = res.data
    totalPages.value = res.totalPages
  } catch {
    toast.add({ title: 'Erro ao carregar histórico', color: 'error' })
  } finally {
    loadingHistory.value = false
  }
}

async function openDetail(id: string) {
  try {
    detail.value = await wa.fetchDetail(id)
    detailOpen.value = true
  } catch {
    toast.add({ title: 'Erro ao carregar detalhe', color: 'error' })
  }
}

async function doRetry(id: string) {
  try {
    await wa.retry(id)
    toast.add({ title: 'Reenvio enfileirado', color: 'success', icon: 'i-lucide-refresh-cw' })
    await loadHistory()
    await loadMetrics()
  } catch (e) {
    const msg = (e as { data?: { message?: string } })?.data?.message ?? 'Erro ao reenviar'
    toast.add({ title: msg, color: 'error' })
  }
}

function copyMessage(msg: string) {
  navigator.clipboard?.writeText(msg)
  toast.add({ title: 'Mensagem copiada', color: 'success', icon: 'i-lucide-copy' })
}

function applyFilters() {
  page.value = 1
  loadHistory()
}

watch(page, loadHistory)

onMounted(async () => {
  await Promise.all([refreshStatus(), loadSettings(), loadMetrics(), loadHistory()])
})
onBeforeUnmount(stopPolling)
</script>

<template>
  <div class="p-4 sm:p-6 space-y-6 max-w-6xl mx-auto">
    <div class="flex items-center gap-3">
      <UIcon name="i-lucide-message-circle" class="size-7 text-primary" />
      <h1 class="text-2xl font-bold">WhatsApp — Comprovantes</h1>
    </div>

    <!-- Circuit breaker alert -->
    <div
      v-if="circuitOpen"
      class="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300 flex items-center gap-2"
    >
      <UIcon name="i-lucide-pause-circle" class="size-5 shrink-0" />
      <span class="flex-1">Envios automáticos PAUSADOS (circuit breaker) após falhas consecutivas. Verifique a conexão.</span>
      <UButton size="xs" color="warning" variant="solid" icon="i-lucide-play-circle" :loading="resettingCircuit" @click="doResetCircuit">Resetar agora</UButton>
    </div>

    <!-- ─── Connection card ─── -->
    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <h2 class="font-semibold">Conexão</h2>
          <UBadge :color="statusMeta.color" variant="subtle" :icon="statusMeta.icon">
            {{ statusMeta.label }}
          </UBadge>
        </div>
      </template>

      <div class="grid sm:grid-cols-2 gap-4">
        <div class="space-y-1 text-sm">
          <p><span class="text-gray-500">Instância:</span> {{ status?.instanceName || '—' }}</p>
          <p><span class="text-gray-500">Número:</span> {{ status?.phoneNumber || '—' }}</p>
          <p><span class="text-gray-500">Última conexão:</span> {{ fmtDate(status?.lastConnectedAt) }}</p>
          <p><span class="text-gray-500">Última desconexão:</span> {{ fmtDate(status?.lastDisconnectedAt) }}</p>
          <div class="flex flex-wrap gap-2 pt-3">
            <UButton :loading="connecting" icon="i-lucide-qr-code" size="sm" @click="doConnect">Conectar</UButton>
            <UButton color="neutral" variant="soft" icon="i-lucide-refresh-cw" size="sm" @click="doReconnect">Reconectar</UButton>
            <UButton color="neutral" variant="ghost" icon="i-lucide-rotate-cw" size="sm" :loading="loadingStatus" @click="refreshStatus">Atualizar status</UButton>
            <UButton color="warning" variant="soft" icon="i-lucide-database-zap" size="sm" :loading="refreshingInstance" title="Limpa o token de instância salvo e re-resolve. Use após reconectar a instância na Evolution." @click="doRefreshInstance">Limpar cache da instância</UButton>
            <UButton color="error" variant="ghost" icon="i-lucide-power" size="sm" @click="doDisconnect">Desconectar</UButton>
          </div>
        </div>
        <div v-if="qrcode" class="flex flex-col items-center justify-center">
          <img
            :src="qrcode.startsWith('data:') ? qrcode : `data:image/png;base64,${qrcode}`"
            alt="QR Code"
            class="w-48 h-48 rounded-lg border"
          />
          <p class="text-xs text-gray-500 mt-2">Escaneie no WhatsApp → Aparelhos conectados</p>
        </div>
      </div>
    </UCard>

    <!-- ─── Group + test ─── -->
    <UCard>
      <template #header><h2 class="font-semibold">Grupo de destino</h2></template>
      <div class="flex flex-col sm:flex-row gap-3 sm:items-end">
        <div class="flex-1">
          <label class="text-sm text-gray-500">Grupo / comunidade</label>
          <USelectMenu
            v-if="settings"
            v-model="selectedGroup"
            :items="groupSelectItems"
            value-key="value"
            label-key="label"
            placeholder="Selecione um grupo"
            class="w-full"
          />
        </div>
        <UButton color="neutral" variant="soft" icon="i-lucide-refresh-cw" :loading="loadingGroups" @click="loadGroups">Recarregar grupos</UButton>
        <UButton icon="i-lucide-send" :loading="testing" :disabled="!settings?.selectedGroupId || groupUnsaved" :title="groupUnsaved ? 'Salve a configuração antes de testar' : undefined" @click="doTestSend">Enviar teste</UButton>
      </div>
      <p v-if="groupUnsaved" class="text-xs text-amber-600 mt-2">
        Seleção de grupo não salva — clique em "Salvar" antes de enviar o teste.
      </p>
    </UCard>

    <!-- ─── Template + preview ─── -->
    <UCard v-if="settings">
      <template #header><h2 class="font-semibold">Template da mensagem</h2></template>
      <div class="grid md:grid-cols-2 gap-4">
        <div>
          <UTextarea v-model="settings.messageTemplate" :rows="8" class="w-full font-mono text-sm" @blur="doPreview" />
          <p class="text-xs text-gray-500 mt-2">
            Variáveis: <code v-pre>{{userName}}</code> <code v-pre>{{userEmail}}</code>
            <code v-pre>{{amount}}</code> <code v-pre>{{date}}</code> <code v-pre>{{time}}</code>
            <code v-pre>{{withdrawalId}}</code> <code v-pre>{{status}}</code>
          </p>
        </div>
        <div>
          <label class="text-sm text-gray-500">Pré-visualização</label>
          <pre class="whitespace-pre-wrap rounded-lg border bg-gray-50 dark:bg-gray-900 p-3 text-sm min-h-[8rem]">{{ previewText }}</pre>
        </div>
      </div>
    </UCard>

    <!-- ─── Timing config ─── -->
    <UCard v-if="settings">
      <template #header><h2 class="font-semibold">Timing & segurança</h2></template>
      <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div>
          <label class="text-sm text-gray-500">Delay mín (s)</label>
          <UInput v-model.number="settings.delayMinSeconds" type="number" />
        </div>
        <div>
          <label class="text-sm text-gray-500">Delay máx (s)</label>
          <UInput v-model.number="settings.delayMaxSeconds" type="number" />
        </div>
        <div>
          <label class="text-sm text-gray-500">Máx tentativas</label>
          <UInput v-model.number="settings.maxAttempts" type="number" />
        </div>
        <div>
          <label class="text-sm text-gray-500">Espera máx conexão (min)</label>
          <UInput v-model.number="settings.maxWaitConnectionMinutes" type="number" />
        </div>
        <div>
          <label class="text-sm text-gray-500">Cooldown falhas (s)</label>
          <UInput v-model.number="settings.failureCooldownSeconds" type="number" />
        </div>
        <div class="flex items-end gap-4">
          <USwitch v-model="settings.enabled" label="Ativo" />
          <USwitch v-model="settings.sendMedia" label="Enviar imagem" />
        </div>
      </div>
      <template #footer>
        <UButton :loading="savingSettings" icon="i-lucide-save" @click="saveSettings">Salvar configuração</UButton>
      </template>
    </UCard>

    <!-- ─── Metrics ─── -->
    <div v-if="metrics" class="grid grid-cols-2 md:grid-cols-4 gap-3">
      <UCard><div class="text-center"><p class="text-2xl font-bold">{{ metrics.total }}</p><p class="text-xs text-gray-500">Total</p></div></UCard>
      <UCard><div class="text-center"><p class="text-2xl font-bold text-green-600">{{ metrics.sent }}</p><p class="text-xs text-gray-500">Enviados</p></div></UCard>
      <UCard><div class="text-center"><p class="text-2xl font-bold text-red-600">{{ metrics.failed }}</p><p class="text-xs text-gray-500">Falhas</p></div></UCard>
      <UCard><div class="text-center"><p class="text-2xl font-bold">{{ metrics.successRate }}%</p><p class="text-xs text-gray-500">Taxa sucesso</p></div></UCard>
      <UCard><div class="text-center"><p class="text-2xl font-bold text-amber-600">{{ metrics.pending + metrics.waitingConnection + metrics.paused }}</p><p class="text-xs text-gray-500">Pendentes/espera</p></div></UCard>
      <UCard class="col-span-2 md:col-span-1"><div class="text-center"><p class="text-sm font-medium">{{ fmtDate(metrics.lastSentAt) }}</p><p class="text-xs text-gray-500">Último envio</p></div></UCard>
      <UCard class="col-span-2 md:col-span-2"><div class="text-center"><p class="text-sm font-medium">{{ fmtDate(metrics.lastFailureAt) }}</p><p class="text-xs text-gray-500">Última falha</p></div></UCard>
    </div>

    <!-- ─── History ─── -->
    <UCard>
      <template #header>
        <div class="flex flex-col sm:flex-row gap-2 sm:items-center justify-between">
          <h2 class="font-semibold">Histórico de envios</h2>
          <div class="flex flex-wrap gap-2">
            <USelect v-model="filterStatus" :items="STATUS_OPTIONS" value-key="value" label-key="label" size="sm" class="w-40" @change="applyFilters" />
            <UInput v-model="filterSearch" placeholder="Nome / email" size="sm" @keyup.enter="applyFilters" />
            <UInput v-model="filterFrom" type="date" size="sm" @change="applyFilters" />
            <UInput v-model="filterTo" type="date" size="sm" @change="applyFilters" />
            <UButton size="sm" icon="i-lucide-search" :loading="loadingHistory" @click="applyFilters">Filtrar</UButton>
          </div>
        </div>
      </template>

      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-left text-gray-500 border-b">
            <tr>
              <th class="py-2 pr-3">Data</th>
              <th class="py-2 pr-3">Usuário</th>
              <th class="py-2 pr-3">Valor</th>
              <th class="py-2 pr-3">Grupo</th>
              <th class="py-2 pr-3">Status</th>
              <th class="py-2 pr-3">Tent.</th>
              <th class="py-2 pr-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in history" :key="row.id" class="border-b last:border-0">
              <td class="py-2 pr-3 whitespace-nowrap">{{ fmtDate(row.createdAt) }}</td>
              <td class="py-2 pr-3">
                <div>{{ row.userName }}<UBadge v-if="row.isTest" size="xs" color="neutral" variant="subtle" class="ml-1">teste</UBadge></div>
                <div class="text-xs text-gray-500">{{ row.userEmail }}</div>
              </td>
              <td class="py-2 pr-3 whitespace-nowrap">{{ row.amount ? `R$ ${Number(row.amount).toFixed(2)}` : '—' }}</td>
              <td class="py-2 pr-3">{{ row.groupName || '—' }}</td>
              <td class="py-2 pr-3"><UBadge :color="badgeColor(row.status)" variant="subtle">{{ row.status }}</UBadge></td>
              <td class="py-2 pr-3">{{ row.attempts }}</td>
              <td class="py-2 pr-3">
                <div class="flex gap-1">
                  <UButton icon="i-lucide-eye" size="xs" color="neutral" variant="ghost" @click="openDetail(row.id)" />
                  <UButton icon="i-lucide-copy" size="xs" color="neutral" variant="ghost" @click="copyMessage(row.message)" />
                  <UButton
                    v-if="['FAILED','CANCELLED','WAITING_CONNECTION','PAUSED'].includes(row.status)"
                    icon="i-lucide-refresh-cw" size="xs" color="primary" variant="ghost"
                    @click="doRetry(row.id)"
                  />
                </div>
              </td>
            </tr>
            <tr v-if="!history.length">
              <td colspan="7" class="py-6 text-center text-gray-500">Nenhum envio registrado</td>
            </tr>
          </tbody>
        </table>
      </div>

      <template #footer>
        <div class="flex items-center justify-between">
          <span class="text-xs text-gray-500">Página {{ page }} de {{ totalPages }}</span>
          <div class="flex gap-2">
            <UButton size="xs" color="neutral" variant="soft" :disabled="page <= 1" @click="page--">Anterior</UButton>
            <UButton size="xs" color="neutral" variant="soft" :disabled="page >= totalPages" @click="page++">Próxima</UButton>
          </div>
        </div>
      </template>
    </UCard>

    <!-- ─── Detail modal ─── -->
    <UModal v-model:open="detailOpen" title="Detalhe do envio">
      <template #body>
        <div v-if="detail" class="space-y-2 text-sm">
          <p><span class="text-gray-500">Usuário:</span> {{ detail.userName }} ({{ detail.userEmail }})</p>
          <p><span class="text-gray-500">Valor:</span> {{ detail.amount ? `R$ ${Number(detail.amount).toFixed(2)}` : '—' }}</p>
          <p><span class="text-gray-500">Status:</span> <UBadge :color="badgeColor(detail.status)" variant="subtle">{{ detail.status }}</UBadge></p>
          <p><span class="text-gray-500">Tentativas:</span> {{ detail.attempts }}</p>
          <p><span class="text-gray-500">Enviado em:</span> {{ fmtDate(detail.sentAt) }}</p>
          <p v-if="detail.lastError" class="text-red-600"><span class="text-gray-500">Erro:</span> {{ detail.lastError }}</p>
          <div>
            <span class="text-gray-500">Mensagem:</span>
            <pre class="whitespace-pre-wrap rounded-lg border bg-gray-50 dark:bg-gray-900 p-3 mt-1">{{ detail.message }}</pre>
          </div>
          <p v-if="detail.evolutionResponse" class="text-xs text-gray-500">
            Auditoria: {{ JSON.stringify(detail.evolutionResponse) }}
          </p>
        </div>
      </template>
    </UModal>
  </div>
</template>

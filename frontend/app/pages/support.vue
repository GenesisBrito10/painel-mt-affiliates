<script setup lang="ts">
import * as XLSX from 'xlsx'
import type { SupportConversation, SupportMessage } from '~/stores/chat'
import type { SupportDailyReport } from '~/composables/useChat'

definePageMeta({ layout: 'default' })

const chat = useChat()
const { store } = chat
const queue = ref<SupportConversation[]>([])
const loading = ref(false)
const error = ref('')
let queueTimer: ReturnType<typeof setInterval> | null = null
let offQueueEvents: (() => void) | null = null
let offVisibilityRefresh: (() => void) | null = null

// Encerrar todas
const showCloseAllModal = ref(false)
const closingAll = ref(false)
const report = ref<SupportDailyReport | null>(null)
const showReport = ref(false)
const loadingReport = ref(false)

const activeConversation = computed(() => store.conversation)
const activeQueue = computed(() => queue.value.filter(c => c.status !== 'CLOSED'))
const unreadCount = computed(() => activeQueue.value.filter(c => (c.unreadCount ?? 0) > 0).length)

type Tab = 'all' | 'unread' | 'open' | 'waiting'
const activeTab = ref<Tab>('all')

const tabCounts = computed(() => ({
  all: activeQueue.value.length,
  unread: activeQueue.value.filter(c => (c.unreadCount ?? 0) > 0).length,
  open: queue.value.filter(c => c.status === 'OPEN').length,
  waiting: queue.value.filter(c => c.status === 'WAITING_USER').length,
}))

const filteredQueue = computed(() => {
  if (activeTab.value === 'unread') return activeQueue.value.filter(c => (c.unreadCount ?? 0) > 0)
  if (activeTab.value === 'open') return queue.value.filter(c => c.status === 'OPEN')
  if (activeTab.value === 'waiting') return queue.value.filter(c => c.status === 'WAITING_USER')
  return activeQueue.value
})

function queueStatus(item: SupportConversation) {
  if (item.status === 'CLOSED') return 'Encerrado'
  if ((item.unreadCount ?? 0) > 0) return 'Novo'
  if (item.status === 'WAITING') return 'Na fila'
  if (item.status === 'OPEN') return 'Aguardando suporte'
  if (item.status === 'WAITING_USER') return 'Aguardando afiliado'
  return 'Aberto'
}

function queueStatusStyle(item: SupportConversation) {
  if ((item.unreadCount ?? 0) > 0) return 'background: var(--vex-danger-soft-bg); color: var(--vex-danger)'
  if (item.status === 'CLOSED') return 'background: var(--vex-surface-strong); color: var(--vex-text-muted)'
  if (item.status === 'OPEN') return 'background: var(--vex-warning-light); color: var(--vex-warning)'
  if (item.status === 'WAITING_USER') return 'background: var(--vex-brand-light); color: var(--vex-brand)'
  return 'background: var(--vex-brand-light); color: var(--vex-brand)'
}

function lastMessagePreview(item: SupportConversation) {
  if (!item.lastMessage) return item.subject || item.affiliateEmail
  const sender = item.lastMessage.senderRole === 'AGENT' ? 'Suporte' : 'Afiliado'
  return `${sender}: ${item.lastMessage.content}`
}

function updatedTime(item: SupportConversation) {
  const value = item.status === 'CLOSED'
    ? item.closedAt || item.lastMessage?.createdAt || item.updatedAt
    : item.lastMessage?.createdAt || item.updatedAt
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function reportTime(value: string | null) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function truncateText(value: string | null | undefined, max = 120) {
  const normalized = (value || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return '-'
  return normalized.length > max ? `${normalized.slice(0, max - 1)}...` : normalized
}

function closedByLabel(value: string | null) {
  if (value === 'agent') return 'Atendente'
  if (value === 'affiliate') return 'Afiliado'
  if (value === 'system') return 'Sistema'
  return value || '-'
}

function visibleTags(tags: string[]) {
  return tags.slice(0, 3)
}

function remainingTags(tags: string[]) {
  return Math.max(tags.length - 3, 0)
}

async function refreshQueue() {
  loading.value = true
  error.value = ''
  try {
    const activeResult = await chat.listSupportQueue()
    queue.value = activeResult.data
    const preferredConversation = activeQueue.value[0] || queue.value[0]
    if (!activeConversation.value && preferredConversation) {
      await selectConversation(preferredConversation.id)
    }
  } catch (err) {
    error.value = (err as Error).message || 'Não foi possível carregar a fila.'
  } finally {
    loading.value = false
  }
}

async function selectConversation(id: string) {
  await chat.loadSupportConversation(id)
}

async function sendMessage(payload: { content: string; attachment?: import('~/composables/useChat').ChatAttachment }) {
  await chat.sendMessage(payload.content, payload.attachment)
  setTimeout(refreshQueue, 150)
}

async function closeConversation() {
  await chat.closeConversation()
  setTimeout(refreshQueue, 300)
}

async function openDailyReport() {
  loadingReport.value = true
  error.value = ''
  try {
    report.value = await chat.getDailyReport()
    showReport.value = true
  } catch (err) {
    error.value = (err as Error).message || 'Erro ao gerar relatório.'
  } finally {
    loadingReport.value = false
  }
}

function exportReportXlsx() {
  if (!import.meta.client || !report.value) return
  const rows = report.value.closedConversations.map((item) => ({
    Data: report.value?.date ?? '',
    Afiliado: item.affiliateName,
    Email: item.affiliateEmail,
    Assunto: item.subject ?? '',
    'Mensagem inicial': item.firstMessagePreview ?? '',
    Tags: item.tags.join(', '),
    'Encerrado em': reportTime(item.closedAt),
    'Encerrado por': closedByLabel(item.closedByRole),
  }))
  const worksheet = XLSX.utils.json_to_sheet(rows)
  worksheet['!cols'] = [
    { wch: 12 },
    { wch: 24 },
    { wch: 32 },
    { wch: 24 },
    { wch: 70 },
    { wch: 26 },
    { wch: 18 },
    { wch: 16 },
  ]
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Relatorio do dia')
  XLSX.writeFile(workbook, `relatorio-suporte-${report.value.date.replace(/\D/g, '-')}.xlsx`)
}

async function confirmCloseAll() {
  closingAll.value = true
  try {
    await chat.closeAllConversations()
    const dailyReport = await chat.getDailyReport()
    report.value = dailyReport
    store.reset()
    await refreshQueue()
    showCloseAllModal.value = false
    showReport.value = true
  } catch (err) {
    error.value = (err as Error).message || 'Erro ao encerrar conversas.'
    showCloseAllModal.value = false
  } finally {
    closingAll.value = false
  }
}

function playIncomingAlert() {
  if (!import.meta.client) return
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return
    const audioContext = new AudioContextClass()
    const oscillator = audioContext.createOscillator()
    const gain = audioContext.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.28)
    oscillator.connect(gain)
    gain.connect(audioContext.destination)
    oscillator.start()
    oscillator.stop(audioContext.currentTime + 0.3)
    window.setTimeout(() => audioContext.close().catch(() => {}), 450)
  } catch {}
}

function handleNewMessage(message: SupportMessage) {
  refreshQueue()
  if (message.senderRole === 'AFFILIATE' && message.conversationId !== activeConversation.value?.id) {
    playIncomingAlert()
  }
}

onMounted(async () => {
  chat.connect()
  await chat.setAgentAvailability(true).catch(() => {})
  const socket = chat.socket.value
  const refreshFromSocket = () => refreshQueue()
  const handleNewMessageFromSocket = (message: SupportMessage) => handleNewMessage(message)
  socket?.on('message:new', handleNewMessageFromSocket)
  socket?.on('conversation:assigned', refreshFromSocket)
  socket?.on('conversation:updated', refreshFromSocket)
  socket?.on('conversation:reopened', refreshFromSocket)
  socket?.on('conversation:closed', refreshFromSocket)
  offQueueEvents = () => {
    socket?.off('message:new', handleNewMessageFromSocket)
    socket?.off('conversation:assigned', refreshFromSocket)
    socket?.off('conversation:updated', refreshFromSocket)
    socket?.off('conversation:reopened', refreshFromSocket)
    socket?.off('conversation:closed', refreshFromSocket)
  }
  await refreshQueue()
  queueTimer = setInterval(refreshQueue, 30000)
  const refreshWhenVisible = () => {
    if (document.visibilityState === 'visible') {
      if (store.conversation?.id) chat.refreshActiveConversation().catch(() => {})
      refreshQueue().catch(() => {})
    }
  }
  document.addEventListener('visibilitychange', refreshWhenVisible)
  window.addEventListener('focus', refreshWhenVisible)
  offVisibilityRefresh = () => {
    document.removeEventListener('visibilitychange', refreshWhenVisible)
    window.removeEventListener('focus', refreshWhenVisible)
  }
})

onUnmounted(() => {
  if (queueTimer) clearInterval(queueTimer)
  offQueueEvents?.()
  offVisibilityRefresh?.()
  chat.setAgentAvailability(false).catch(() => {})
  chat.disconnect()
})
</script>

<template>
  <div class="flex min-h-full flex-col">
    <header class="vex-page-header">
      <div>
        <h1 class="text-base font-bold vex-title">Fila de suporte</h1>
        <p class="mt-1 text-xs" style="color: var(--vex-text-muted)">
          Chamados atribuídos individualmente para o seu usuário de suporte.
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button
          class="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold"
          style="background: var(--vex-brand-light); color: var(--vex-brand)"
          :disabled="loadingReport"
          @click="openDailyReport"
        >
          <UIcon name="i-lucide-bar-chart-2" class="size-4" :class="loadingReport ? 'animate-pulse' : ''" />
          Relatório do dia
        </button>
        <button
          class="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold"
          style="background: var(--vex-danger-soft-bg); color: var(--vex-danger)"
          @click="showCloseAllModal = true"
        >
          <UIcon name="i-lucide-x-circle" class="size-4" />
          Encerrar todas
          <span
            v-if="activeQueue.length > 0"
            class="rounded-full px-1.5 py-0.5 text-[10px]"
            style="background: var(--vex-danger); color: white"
          >
            {{ activeQueue.length }}
          </span>
        </button>
      </div>
    </header>

    <main class="grid min-h-0 flex-1 gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <aside class="min-h-0 overflow-hidden rounded-lg" style="background: var(--vex-surface); border: 1px solid var(--vex-border-subtle)">
        <div class="flex items-center justify-between border-b px-4 py-3" style="border-color: var(--vex-border-subtle)">
          <div>
            <p class="text-[11px] font-bold uppercase tracking-wide" style="color: var(--vex-text-faint)">Minha fila</p>
            <p class="text-sm font-extrabold" style="color: var(--vex-text)">
              {{ activeQueue.length }} ativa{{ activeQueue.length !== 1 ? 's' : '' }}
              <span v-if="unreadCount > 0" class="ml-1 text-xs font-bold" style="color: var(--vex-danger)">
                · {{ unreadCount }} nova{{ unreadCount !== 1 ? 's' : '' }}
              </span>
            </p>
          </div>
          <button class="flex size-9 items-center justify-center rounded-lg" style="background: var(--vex-surface-strong); color: var(--vex-text)" @click="refreshQueue">
            <UIcon name="i-lucide-refresh-cw" class="size-4" :class="loading ? 'animate-spin' : ''" />
          </button>
        </div>

        <!-- Abas de filtro -->
        <div class="flex gap-1 border-b px-2 pt-2 pb-0" style="border-color: var(--vex-border-subtle)">
          <button
            v-for="tab in ([
              { key: 'all', label: 'Todas' },
              { key: 'open', label: 'Em aberto' },
              { key: 'unread', label: 'Não lidas' },
              { key: 'waiting', label: 'Aguardando' },
            ] as const)"
            :key="tab.key"
            class="relative flex items-center gap-1.5 rounded-t-md px-2.5 py-2 text-[11px] font-bold transition-colors"
            :style="activeTab === tab.key
              ? 'color: var(--vex-brand); border-bottom: 2px solid var(--vex-brand); margin-bottom: -1px'
              : 'color: var(--vex-text-muted); border-bottom: 2px solid transparent; margin-bottom: -1px'"
            @click="activeTab = tab.key"
          >
            {{ tab.label }}
            <span
              v-if="tabCounts[tab.key] > 0"
              class="rounded-full px-1.5 py-0.5 text-[9px] font-extrabold"
              :style="tab.key === 'unread' && tabCounts.unread > 0
                ? 'background: var(--vex-danger); color: white'
                : activeTab === tab.key
                  ? 'background: var(--vex-brand-light); color: var(--vex-brand)'
                  : 'background: var(--vex-surface-strong); color: var(--vex-text-muted)'"
            >
              {{ tabCounts[tab.key] }}
            </span>
          </button>
        </div>

        <div v-if="error" class="m-3 rounded-lg p-3 text-sm" style="background: var(--vex-danger-soft-bg); color: var(--vex-danger)">
          {{ error }}
        </div>

        <div class="max-h-[calc(100vh-15rem)] overflow-y-auto p-2">
          <button
            v-for="item in filteredQueue"
            :key="item.id"
            class="w-full rounded-lg p-3 text-left transition-all"
            :style="item.id === activeConversation?.id
              ? 'background: var(--vex-surface-strong); color: var(--vex-text); border: 1px solid var(--vex-brand)'
              : 'color: var(--vex-text); border: 1px solid transparent'"
            @click="selectConversation(item.id)"
          >
            <div class="flex items-center justify-between gap-2">
              <p class="truncate text-sm font-extrabold">{{ item.affiliateName }}</p>
              <span
                class="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold"
                :style="queueStatusStyle(item)"
              >
                {{ queueStatus(item) }}
              </span>
            </div>
            <div class="mt-1 flex items-center justify-between gap-2">
              <p class="truncate text-xs opacity-75">{{ item.subject || item.affiliateEmail }}</p>
              <span class="shrink-0 text-[10px] opacity-60">{{ updatedTime(item) }}</span>
            </div>
            <div class="mt-2 flex items-center gap-2">
              <span
                v-if="(item.unreadCount ?? 0) > 0"
                class="grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-extrabold text-white"
                style="background: var(--vex-danger)"
              >
                {{ item.unreadCount }}
              </span>
              <p class="truncate text-xs" :class="(item.unreadCount ?? 0) > 0 ? 'font-bold' : 'opacity-70'">
                {{ lastMessagePreview(item) }}
              </p>
            </div>
          </button>

          <div v-if="!loading && filteredQueue.length === 0" class="p-6 text-center text-sm" style="color: var(--vex-text-muted)">
            {{ activeTab === 'unread' ? 'Nenhuma mensagem não lida.' : activeTab === 'open' ? 'Nenhum chamado em aberto.' : activeTab === 'waiting' ? 'Nenhum aguardando resposta.' : 'Nenhum chamado na fila.' }}
          </div>
        </div>
      </aside>

      <div class="min-h-[32rem]">
        <ChatWindow
          :conversation="activeConversation"
          :messages="store.messages"
          is-support
          :is-typing="chat.isTyping.value"
          @send="sendMessage"
          @close="closeConversation"
          @typing="chat.typing"
        />
      </div>
    </main>

    <!-- Modal: Encerrar todas as conversas -->
    <div
      v-if="showCloseAllModal"
      class="fixed inset-0 z-50 flex items-center justify-center"
      style="background: rgba(0,0,0,0.5)"
      @click.self="showCloseAllModal = false"
    >
      <div class="w-full max-w-sm rounded-xl p-6 shadow-xl" style="background: var(--vex-surface)">
        <h2 class="text-base font-extrabold" style="color: var(--vex-text)">Encerrar todas as conversas?</h2>
        <p class="mt-2 text-sm" style="color: var(--vex-text-muted)">
          Quantidade de conversas: <strong>{{ activeQueue.length }}</strong>.<br>
          Esta ação vai encerrar todas as conversas ativas e gerar o relatório do dia.
        </p>
        <div class="mt-5 flex justify-end gap-3">
          <button
            class="rounded-lg px-4 py-2 text-sm font-bold"
            style="background: var(--vex-surface-strong); color: var(--vex-text)"
            :disabled="closingAll"
            @click="showCloseAllModal = false"
          >
            Cancelar
          </button>
          <button
            class="rounded-lg px-4 py-2 text-sm font-bold"
            style="background: var(--vex-danger); color: white"
            :disabled="closingAll"
            @click="confirmCloseAll"
          >
            <span v-if="closingAll">Encerrando...</span>
            <span v-else>Sim, encerrar tudo</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Modal: Relatório do dia -->
    <div
      v-if="showReport && report"
      class="fixed inset-0 z-50 flex items-center justify-center"
      style="background: rgba(0,0,0,0.5)"
      @click.self="showReport = false"
    >
      <div class="max-h-[88vh] w-full max-w-4xl overflow-hidden rounded-xl shadow-xl" style="background: var(--vex-surface)">
        <div class="flex items-center justify-between gap-3 border-b p-5" style="border-color: var(--vex-border-subtle)">
          <div class="flex items-center gap-3">
            <div class="flex size-10 items-center justify-center rounded-full" style="background: var(--vex-brand-light)">
              <UIcon name="i-lucide-bar-chart-2" class="size-5" style="color: var(--vex-brand)" />
            </div>
            <div>
              <h2 class="text-base font-extrabold" style="color: var(--vex-text)">Relatório do dia</h2>
              <p class="text-xs" style="color: var(--vex-text-muted)">{{ report.date }}</p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button
              class="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold"
              style="background: var(--vex-surface-strong); color: var(--vex-text)"
              :disabled="report.closedConversations.length === 0"
              @click="exportReportXlsx"
            >
              <UIcon name="i-lucide-download" class="size-4" />
              Exportar XLSX
            </button>
            <button
              class="flex size-9 items-center justify-center rounded-lg"
              style="background: var(--vex-surface-strong); color: var(--vex-text)"
              @click="showReport = false"
            >
              <UIcon name="i-lucide-x" class="size-4" />
            </button>
          </div>
        </div>

        <div class="max-h-[calc(88vh-5rem)] overflow-y-auto p-5">
          <div class="grid grid-cols-2 gap-3">
            <div class="rounded-lg p-4 text-center" style="background: var(--vex-surface-strong)">
              <p class="text-2xl font-extrabold" style="color: var(--vex-text)">{{ report.totalCreated }}</p>
              <p class="mt-1 text-xs" style="color: var(--vex-text-muted)">Conversas abertas</p>
            </div>
            <div class="rounded-lg p-4 text-center" style="background: var(--vex-surface-strong)">
              <p class="text-2xl font-extrabold" style="color: var(--vex-brand)">{{ report.totalClosed }}</p>
              <p class="mt-1 text-xs" style="color: var(--vex-text-muted)">Conversas encerradas</p>
            </div>
          </div>

          <div class="mt-5 overflow-hidden rounded-lg border" style="border-color: var(--vex-border-subtle)">
            <div class="grid grid-cols-[1.2fr_1.4fr_1fr_6rem] gap-3 px-3 py-2 text-[11px] font-bold uppercase tracking-wide" style="background: var(--vex-surface-strong); color: var(--vex-text-muted)">
              <span>Afiliado</span>
              <span>Mensagem inicial</span>
              <span>Tags</span>
              <span>Encerrado</span>
            </div>
            <div
              v-for="item in report.closedConversations"
              :key="item.id"
              class="grid grid-cols-[1.2fr_1.4fr_1fr_6rem] gap-3 border-t px-3 py-3 text-xs"
              style="border-color: var(--vex-border-subtle); color: var(--vex-text)"
            >
              <div class="min-w-0">
                <p class="truncate font-extrabold">{{ item.affiliateName }}</p>
                <p class="truncate opacity-70">{{ item.affiliateEmail }}</p>
                <p v-if="item.subject" class="mt-1 truncate opacity-70">{{ item.subject }}</p>
              </div>
              <p class="min-w-0 leading-relaxed opacity-90">{{ truncateText(item.firstMessagePreview) }}</p>
              <div class="flex min-w-0 flex-wrap items-center gap-1">
                <span
                  v-for="tag in visibleTags(item.tags)"
                  :key="`${item.id}-${tag}`"
                  class="inline-flex h-4 max-w-full items-center truncate rounded border px-1.5 text-[8px] font-bold leading-none"
                  style="background: var(--vex-surface-strong); border-color: var(--vex-border-subtle); color: var(--vex-text-muted)"
                >
                  {{ tag }}
                </span>
                <span
                  v-if="remainingTags(item.tags) > 0"
                  class="inline-flex h-4 items-center rounded border px-1.5 text-[8px] font-bold leading-none"
                  style="background: var(--vex-surface-strong); border-color: var(--vex-border-subtle); color: var(--vex-text-muted)"
                >
                  +{{ remainingTags(item.tags) }}
                </span>
                <span
                  v-if="item.tags.length === 0"
                  class="inline-flex h-4 items-center rounded border px-1.5 text-[8px] font-bold leading-none"
                  style="background: var(--vex-surface-strong); border-color: var(--vex-border-subtle); color: var(--vex-text-muted)"
                >
                  Sem tags
                </span>
              </div>
              <div>
                <p class="font-bold">{{ reportTime(item.closedAt) }}</p>
                <p class="mt-1 opacity-60">{{ closedByLabel(item.closedByRole) }}</p>
              </div>
            </div>
            <div v-if="report.closedConversations.length === 0" class="border-t p-6 text-center text-sm" style="border-color: var(--vex-border-subtle); color: var(--vex-text-muted)">
              Nenhum atendimento encerrado hoje.
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
